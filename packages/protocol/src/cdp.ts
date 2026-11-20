// Driving one page over the Chrome DevTools Protocol, the same way wherever the page lives: the desktop app's tabs
// (Electron's debugger) or the core's own headless Chrome. Refs are backendNodeIds from the accessibility tree
// (stable while the document lives, DOM untouched).
import { captureDocument, evaluatePage } from "./cdp-evaluate.ts";
import { ColoniaError } from "./client.ts";

type AXNode = {
  nodeId: string;
  ignored?: boolean;
  role?: { value?: string };
  name?: { value?: string };
  value?: { value?: string | number };
  backendDOMNodeId?: number;
  childIds?: string[];
  parentId?: string;
};

/** Sends one CDP command to the page and returns its result. */
export type CdpSend = <T = unknown>(method: string, params?: object) => Promise<T>;

const SKIP_ROLES =
  /^(generic|none|presentation|StaticText|InlineTextBox|LineBreak|RootWebArea|paragraph|group|Section)$/;
const INTERACTIVE =
  /^(link|button|textbox|searchbox|combobox|checkbox|radio|switch|tab|menuitem|option|slider|spinbutton|listbox)$/;
// Fields the agent must never fill: the human does it through "take control" / handoff.
const CREDENTIAL_AUTOCOMPLETE = /\b(current-password|new-password|one-time-code|cc-[a-z-]+)\b/;

/** Widest tab picture taken, in pixels: what a model reads well, a retina tab would be twice its viewport. */
const SHOT_WIDTH = 1280;

/** NAVEGADOR-AGIL-1: how long a page must stay the same to count as settled, and the most an action waits for it. */
const QUIET_MS = 200;
const SETTLE_MS = 3_000;
/** A request older than this (a long poll, an analytics beacon that never ends) no longer holds the page busy. */
const INFLIGHT_STALE_MS = 2_500;
const WAIT_POLL_MS = 250;
const LOG_KEPT = 50;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const KEYS: Record<string, { key: string; code: string; keyCode: number; text?: string }> = {
  enter: { key: "Enter", code: "Enter", keyCode: 13, text: "\r" },
  escape: { key: "Escape", code: "Escape", keyCode: 27 },
  tab: { key: "Tab", code: "Tab", keyCode: 9 },
  backspace: { key: "Backspace", code: "Backspace", keyCode: 8 },
  delete: { key: "Delete", code: "Delete", keyCode: 46 },
  space: { key: " ", code: "Space", keyCode: 32, text: " " },
  arrowup: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  arrowdown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  arrowleft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  arrowright: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  pageup: { key: "PageUp", code: "PageUp", keyCode: 33 },
  pagedown: { key: "PageDown", code: "PageDown", keyCode: 34 },
  home: { key: "Home", code: "Home", keyCode: 36 },
  end: { key: "End", code: "End", keyCode: 35 },
};

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "0.0.0.0"]);

/**
 * Where a tab may go: http(s) only, no credentials in the address, never Colonia itself (a driven tab would hold the
 * owner's controls) nor link-local or cloud-metadata addresses.
 */
export function assertNavigable(url: string, blockedPorts: ReadonlySet<string>): void {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new ColoniaError({ code: "bad_request", message: `not a URL: ${url}` });
  }
  if (u.protocol !== "http:" && u.protocol !== "https:")
    throw new ColoniaError({ code: "bad_request", message: `navigation blocked: only http(s), got ${u.protocol}` });
  if (u.username || u.password)
    throw new ColoniaError({ code: "bad_request", message: "navigation blocked: credentials in URL" });
  if (LOOPBACK.has(u.hostname) && blockedPorts.has(u.port || "80"))
    throw new ColoniaError({ code: "bad_request", message: "navigation blocked: that is Colonia itself" });
  if (/^169\.254\./.test(u.hostname) || u.hostname === "metadata.google.internal")
    throw new ColoniaError({ code: "bad_request", message: "navigation blocked: link-local/metadata address" });
}

export class CdpPage {
  readonly #send: CdpSend;
  readonly #selectAll: number;
  #refs = new Map<string, number>();
  /** Requests on the way, by id, with when they started. */
  #inflight = new Map<string, number>();
  #logs: string[] = [];
  #epoch = crypto.randomUUID();
  #review: { document: string; epoch: string } | undefined;

  /** `selectAllModifiers`: the modifier bits for "select all" on the machine the page runs on (Meta=4 on a Mac). */
  constructor(send: CdpSend, opts: { selectAllModifiers: number }) {
    this.#send = send;
    this.#selectAll = opts.selectAllModifiers;
  }

  get consentEpoch(): string {
    return this.#epoch;
  }

  /** A new document: the refs of the last snapshot point at nothing now. */
  forget(): void {
    this.#refs.clear();
    this.#review = undefined;
    this.#epoch = crypto.randomUUID();
  }

  async approvalContext(origin: string, document: string): Promise<{ epoch: string }> {
    const epoch = this.#epoch;
    if (this.#review?.document !== document || this.#review.epoch !== epoch)
      throw new ColoniaError({ code: "bad_request", message: "Page review changed; take a new snapshot" });
    await withTimeout(evaluatePage(this.#send, "null", origin, document), 7_000);
    this.#assertEpoch(epoch);
    return { epoch };
  }

  #assertEpoch(epoch: string): void {
    if (epoch !== this.#epoch)
      throw new ColoniaError({ code: "bad_request", message: "Browser permission expired; inspect and approve again" });
  }

  async snapshot(maxChars: number): Promise<{ tree: string; refs: number; truncated: boolean; document: string }> {
    const epoch = this.#epoch;
    const document = await captureDocument(this.#send);
    this.#review = { document, epoch };
    await this.#send("DOM.getDocument", { depth: 0 });
    const { nodes } = await this.#send<{ nodes: AXNode[] }>("Accessibility.getFullAXTree");
    const byId = new Map(nodes.map((n) => [n.nodeId, n]));
    const root = nodes.find((n) => !n.parentId) ?? nodes[0];
    this.#refs.clear();
    const lines: string[] = [];
    let i = 0;
    let size = 0;
    let truncated = false;

    const visit = (node: AXNode, depth: number) => {
      if (truncated) return;
      const role = node.role?.value ?? "";
      const name = String(node.name?.value ?? "").trim();
      const shown = !node.ignored && !SKIP_ROLES.test(role) && (name !== "" || INTERACTIVE.test(role));
      if (shown) {
        let line = `${"  ".repeat(depth)}- ${role}${name ? ` "${name.slice(0, 100)}"` : ""}`;
        if (node.backendDOMNodeId && (INTERACTIVE.test(role) || role === "heading" || role === "img")) {
          const ref = `e${++i}`;
          this.#refs.set(ref, node.backendDOMNodeId);
          line += ` [${ref}]`;
        }
        const value = node.value?.value;
        if (value !== undefined && value !== "") line += ` = "${String(value).slice(0, 60)}"`;
        size += line.length + 1;
        if (size > maxChars) {
          truncated = true;
          return;
        }
        lines.push(line);
      }
      for (const id of node.childIds ?? []) {
        const child = byId.get(id);
        if (child) visit(child, shown ? depth + 1 : depth);
      }
    };
    if (root) visit(root, 0);
    return { tree: lines.join("\n"), refs: i, truncated, document };
  }

  evaluate(script: string, origin: string, document: string, epoch?: string) {
    if (epoch !== undefined) {
      this.#assertEpoch(epoch);
      if (this.#review?.document !== document || this.#review.epoch !== epoch)
        throw new ColoniaError({ code: "bad_request", message: "Page review changed; take a new snapshot" });
    }
    return withTimeout(evaluatePage(this.#send, script, origin, document), 7_000);
  }

  async click(ref: string): Promise<void> {
    const { x, y } = await this.#center(ref);
    await this.#send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await this.#send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await this.#send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  }

  // NAVEGADOR-AGIL-1: lo que hace ágil a un agente en el navegador: actuar y saber cuándo la página ya respondió sin
  // dormir a ciegas, rellenar un formulario en una llamada y ver qué falló en la red sin abrir DevTools.

  /** CDP events of the page, forwarded by the node: requests in flight (for settle) and what went wrong (for logs). */
  event(method: string, params: unknown): void {
    const p = (params ?? {}) as Record<string, unknown>;
    const id = String(p.requestId ?? "");
    if (method === "Network.requestWillBeSent") {
      const type = String(p.type ?? "");
      // A stream (an event source, a long poll) never ends: only what a page loads to show itself counts.
      if (type !== "EventSource" && type !== "WebSocket" && type !== "Ping") this.#inflight.set(id, Date.now());
    } else if (method === "Network.loadingFinished") this.#inflight.delete(id);
    else if (method === "Network.loadingFailed") {
      this.#inflight.delete(id);
      if (!p.canceled) this.#note(`network ${String(p.errorText ?? "failed")} ${String(p.type ?? "")}`.trim());
    } else if (method === "Network.responseReceived") {
      const r = (p.response ?? {}) as { status?: number; url?: string };
      if ((r.status ?? 0) >= 400) this.#note(`network ${r.status} ${String(r.url ?? "").slice(0, 200)}`);
    } else if (method === "Log.entryAdded") {
      const e = (p.entry ?? {}) as { level?: string; text?: string; url?: string };
      if (e.level === "error" || e.level === "warning")
        this.#note(
          `${e.level} ${String(e.text ?? "").slice(0, 300)}${e.url ? ` (${String(e.url).slice(0, 120)})` : ""}`,
        );
    }
  }

  #note(line: string): void {
    this.#logs.push(line);
    if (this.#logs.length > LOG_KEPT) this.#logs.splice(0, this.#logs.length - LOG_KEPT);
  }

  /** Network failures, HTTP errors and the browser's own errors and warnings since the tab opened, newest last. */
  logs(clear = false): string[] {
    const out = [...this.#logs];
    if (clear) this.#logs.length = 0;
    return out;
  }

  /** Visible text of the page, read in an isolated world: the page's scripts cannot see or patch this read. */
  async text(): Promise<string> {
    const contextId = await this.#world();
    const r = await this.#send<{ result: { value?: unknown } }>("Runtime.evaluate", {
      expression: "document.body ? document.body.innerText : ''",
      contextId,
      returnByValue: true,
    });
    return String(r.result.value ?? "");
  }

  async #world(): Promise<number> {
    const tree = await this.#send<{ frameTree: { frame: { id: string } } }>("Page.getFrameTree");
    const { executionContextId } = await this.#send<{ executionContextId: number }>("Page.createIsolatedWorld", {
      frameId: tree.frameTree.frame.id,
      worldName: "colonia",
    });
    return executionContextId;
  }

  /**
   * Until the page has answered what was just done: nothing it loads still on the way and its text the same twice
   * in a row, QUIET_MS apart; at most `maxMs`. Never fails: a page that keeps changing is read as it is.
   */
  async settle(maxMs = SETTLE_MS): Promise<void> {
    const end = Date.now() + maxMs;
    let last: string | undefined;
    while (Date.now() < end) {
      await sleep(QUIET_MS);
      const now = Date.now();
      const busy = [...this.#inflight.values()].some((t) => now - t < INFLIGHT_STALE_MS);
      const seen = await withTimeout(this.text(), 1_000).catch(() => undefined);
      if (!busy && seen !== undefined && seen === last) return;
      last = seen;
    }
  }

  /**
   * Until `text` shows on the page (or `gone` leaves it), polling the visible text; false when `timeoutMs` passes.
   * What an agent does instead of sleeping a fixed time.
   */
  async waitFor(want: { text?: string; gone?: string }, timeoutMs: number): Promise<boolean> {
    const end = Date.now() + timeoutMs;
    const norm = (s: string) => s.replace(/\s+/g, " ").toLowerCase();
    for (;;) {
      const seen = norm(await withTimeout(this.text(), 2_000).catch(() => ""));
      const has = want.text === undefined || seen.includes(norm(want.text));
      const left = want.gone === undefined || !seen.includes(norm(want.gone));
      if (has && left) return true;
      if (Date.now() >= end) return false;
      await sleep(WAIT_POLL_MS);
    }
  }

  /** A key on whatever has focus: Enter, Escape, Tab, arrows, Page Up/Down, Home, End, Backspace, Delete, Space. */
  async press(key: string): Promise<void> {
    const k = KEYS[key.toLowerCase()];
    if (!k)
      throw new ColoniaError({
        code: "bad_request",
        message: `unknown key ${key}; one of ${Object.keys(KEYS).join(", ")}`,
      });
    await this.#key(k.key, k.code, k.keyCode, 0, k.text);
  }

  /**
   * Fills a form in one go: a text field gets its text (password, one-time-code and card fields refused, as in
   * type), a drop-down the option whose value or label matches, a checkbox or radio is set to the boolean. Returns
   * one line per field that did not take what it was given; empty = all did.
   */
  async fill(fields: ReadonlyArray<{ ref: string; value: string | boolean }>): Promise<string[]> {
    const problems: string[] = [];
    for (const f of fields) {
      const backendNodeId = this.#backend(f.ref);
      const { node } = await this.#send<{ node: { nodeName: string; attributes?: string[] } }>("DOM.describeNode", {
        backendNodeId,
      });
      const tag = node.nodeName.toLowerCase();
      const attrs = node.attributes ?? [];
      const type = String(attrs[attrs.findIndex((a, i) => i % 2 === 0 && a.toLowerCase() === "type") + 1] ?? "")
        .toLowerCase()
        .trim();
      if (tag === "select") {
        const why = await this.#call<string>(
          backendNodeId,
          `function (want) {
            const norm = (s) => String(s).replace(/\\s+/g, " ").trim().toLowerCase();
            const o = [...this.options].find((o) => o.value === want) ||
              [...this.options].find((o) => norm(o.label) === norm(want) || norm(o.text) === norm(want)) ||
              [...this.options].find((o) => norm(o.label).includes(norm(want)));
            if (!o) return "no option " + JSON.stringify(want) + "; it has: " + [...this.options].map((o) => o.label.trim()).filter(Boolean).slice(0, 30).join(", ");
            this.value = o.value;
            this.dispatchEvent(new Event("input", { bubbles: true }));
            this.dispatchEvent(new Event("change", { bubbles: true }));
            return "";
          }`,
          [String(f.value)],
        );
        if (why) problems.push(`${f.ref}: ${why}`);
      } else if (typeof f.value === "boolean" || type === "checkbox" || type === "radio") {
        const want = f.value === true || f.value === "true" || f.value === "on";
        const checked = await this.#call<boolean | null>(
          backendNodeId,
          "function () { return 'checked' in this ? this.checked : (this.getAttribute('aria-checked') === 'true'); }",
          [],
        );
        if (checked !== want) {
          if (!want && type === "radio") problems.push(`${f.ref}: a radio is unset by choosing another one`);
          else await this.click(f.ref);
        }
      } else {
        await this.type(f.ref, f.value, false);
      }
    }
    return problems;
  }

  /** A fixed function on the element, in the isolated world: the page's own scripts cannot patch it. */
  async #call<T>(backendNodeId: number, fn: string, args: unknown[]): Promise<T> {
    const executionContextId = await this.#world();
    const { object } = await this.#send<{ object: { objectId?: string } }>("DOM.resolveNode", {
      backendNodeId,
      executionContextId,
    });
    if (!object.objectId)
      throw new ColoniaError({ code: "bad_request", message: "element is gone: take a new snapshot" });
    const r = await this.#send<{ result: { value?: unknown } }>("Runtime.callFunctionOn", {
      objectId: object.objectId,
      functionDeclaration: fn,
      arguments: args.map((value) => ({ value })),
      returnByValue: true,
    });
    return r.result.value as T;
  }

  async type(ref: string, text: string, submit: boolean): Promise<void> {
    const backendNodeId = this.#backend(ref);
    await this.#assertNotCredentialField(backendNodeId);
    await this.#send("DOM.scrollIntoViewIfNeeded", { backendNodeId });
    await this.#send("DOM.focus", { backendNodeId });
    // Select existing content so the new text replaces it, like a user would.
    await this.#key("a", "KeyA", 65, this.#selectAll, undefined, ["selectAll"]);
    await this.#send("Input.insertText", { text });
    if (submit) await this.#key("Enter", "Enter", 13, 0, "\r");
  }

  /** A JPEG of what the page shows (base64), at most SHOT_WIDTH pixels wide, bounded in time. */
  async screenshot(timeoutMs = 4_000): Promise<string> {
    const shoot = async () => {
      const clip = await this.#viewportClip().catch(() => undefined);
      return this.#send<{ data: string }>("Page.captureScreenshot", {
        format: "jpeg",
        quality: 70,
        optimizeForSpeed: true,
        ...(clip ? { clip, captureBeyondViewport: false } : {}),
      });
    };
    const { data } = await withTimeout(shoot(), timeoutMs);
    return data;
  }

  /** The visible part of the page, scaled so the picture (in device pixels) fits SHOT_WIDTH. */
  async #viewportClip() {
    type Viewport = { pageX: number; pageY: number; clientWidth: number; clientHeight: number };
    const m = await this.#send<{ cssVisualViewport?: Viewport; visualViewport?: Viewport }>("Page.getLayoutMetrics");
    const css = m.cssVisualViewport;
    if (!css?.clientWidth || !css.clientHeight) return undefined;
    // The device-pixel viewport over the CSS one: 2 on a retina screen, where the picture would be twice as wide.
    const ratio = m.visualViewport?.clientWidth ? m.visualViewport.clientWidth / css.clientWidth : 1;
    const scale = Math.min(1, SHOT_WIDTH / (css.clientWidth * ratio));
    return { x: css.pageX, y: css.pageY, width: css.clientWidth, height: css.clientHeight, scale };
  }

  #backend(ref: string): number {
    const id = this.#refs.get(ref);
    if (!id)
      throw new ColoniaError({ code: "bad_request", message: `ref ${ref} is stale or unknown: take a new snapshot` });
    return id;
  }

  async #center(ref: string): Promise<{ x: number; y: number }> {
    const backendNodeId = this.#backend(ref);
    await this.#send("DOM.scrollIntoViewIfNeeded", { backendNodeId });
    const { quads } = await this.#send<{ quads: number[][] }>("DOM.getContentQuads", { backendNodeId });
    const q = quads[0];
    if (!q || q.length < 8) throw new ColoniaError({ code: "bad_request", message: `ref ${ref} is not visible` });
    const xs = [q[0], q[2], q[4], q[6]] as number[];
    const ys = [q[1], q[3], q[5], q[7]] as number[];
    return { x: xs.reduce((a, b) => a + b) / 4, y: ys.reduce((a, b) => a + b) / 4 };
  }

  async #assertNotCredentialField(backendNodeId: number): Promise<void> {
    const { node } = await this.#send<{ node: { nodeName: string; attributes?: string[] } }>("DOM.describeNode", {
      backendNodeId,
    });
    const attrs = new Map<string, string>();
    const raw = node.attributes ?? [];
    for (let k = 0; k + 1 < raw.length; k += 2)
      attrs.set(String(raw[k]).toLowerCase(), String(raw[k + 1]).toLowerCase());
    const type = attrs.get("type") ?? "";
    const autocomplete = attrs.get("autocomplete") ?? "";
    if (type === "password" || CREDENTIAL_AUTOCOMPLETE.test(autocomplete)) {
      throw new ColoniaError({
        code: "credential_field",
        message: "this field takes a password, one-time code or card data: ask the human to take control",
      });
    }
  }

  async #key(key: string, code: string, keyCode: number, modifiers: number, text?: string, commands?: string[]) {
    const base = { key, code, windowsVirtualKeyCode: keyCode, modifiers };
    // Editing shortcuts (select all…) only run through `commands`; a bare Cmd+A key event does nothing via CDP.
    await this.#send("Input.dispatchKeyEvent", {
      type: text ? "keyDown" : "rawKeyDown",
      ...base,
      ...(text ? { text } : {}),
      ...(commands ? { commands } : {}),
    });
    await this.#send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  }
}

export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new ColoniaError({ code: "timeout", message: `timed out after ${ms}ms` })), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}
