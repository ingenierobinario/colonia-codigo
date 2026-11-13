// Owns the tabs. Executes browser.* for the core and for the user's own chrome (URL bar, take control).
// The node re-checks control on every agent call: it never trusts that the core already did.
import { EventEmitter } from "node:events";
import {
  BROWSER_HOLD,
  type BrowserProfile,
  browserMethods,
  createTabHolds,
  type TabControl,
  type TabInfo,
} from "@colonia/protocol";
import { assertNavigable as checkNavigable } from "@colonia/protocol/cdp";
import { ColoniaError } from "@colonia/protocol/client";
import { app, type DownloadItem, type Session, session, type WebContents, WebContentsView } from "electron";
import type { ProcessOwner } from "../memory.ts";
import { CdpTab } from "./cdp.ts";
import { discoverSources, importCookies, listDomains } from "./cookies.ts";
import { idleTabs } from "./idle.ts";
import { nextZoom, originOf, permissionPolicy, shortcut, type TabAction } from "./policy.ts";

type Tab = {
  id: string;
  profile: BrowserProfile;
  view: WebContentsView;
  wc: WebContents;
  session: Session;
  cleanup?: Promise<void>;
  cdp: CdpTab;
  control: TabControl;
  /** Last time an agent or the owner did something with it (idle tabs close: see idle.ts). */
  used: number;
  /** CHROME-1: the last load of the page failed (no network, no such site): what Chromium said and the address. */
  failed?: { error: string; url: string };
  /** CHROME-1: the tab whose page opened this one (a link in a new tab, a sign-in window). */
  opener?: string;
  /** CHROME-1: the page is in full screen (a video). */
  full?: boolean;
};

// NAVFIX-1: el tope de 8 protege de un agente que abre pestañas sin parar, y solo cuenta las que llevan los agentes.
// A la persona no la frena: abre las que quiera (las que deja de usar ya se cierran solas, closeIdle); el segundo
// tope es solo un seguro de memoria.
const MAX_AGENT_TABS = 8;
const MAX_TABS = 50;
const NAV_TIMEOUT_MS = 8_000;

/** The honest Chromium UA: no "Electron/x" or app token. Client hints stay untouched (removing them breaks Google login). */
function cleanUserAgent(): string {
  return app.userAgentFallback.replace(/\sElectron\/\S+/, "").replace(/\s@?colonia[^\s]*\/\S+/i, "");
}

function partitionFor(profile: BrowserProfile, seq: number): string {
  if (profile === "shared") return "persist:colonia-shared";
  if (profile === "incognito") return `colonia-incog-${seq}`; // no "persist:" → memory only
  if (profile.startsWith("app:")) return `persist:colonia-app-${profile.slice("app:".length)}`; // WEBAPP-1
  if (profile.startsWith("nav:")) return `persist:colonia-nav-${profile.slice("nav:".length)}`; // NAVEGADORES-1
  return `persist:colonia-agent-${profile.slice("agent:".length)}`;
}

/** NAVEGADORES-2: cookie domains → the sites, without the leading dot or "www.", most cookies first, at most 40. */
export function signedInSites(cookies: ReadonlyArray<{ domain?: string | undefined }>): string[] {
  const counts = new Map<string, number>();
  for (const c of cookies) {
    const site = (c.domain ?? "")
      .replace(/^\./, "")
      .replace(/^www\./, "")
      .toLowerCase();
    if (site) counts.set(site, (counts.get(site) ?? 0) + 1);
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 40)
    .map(([site]) => site);
}

let blockedPorts = new Set<string>();

/** Colonia's own core and panel must never load inside a tab: a driven tab would hold the owner's controls. */
export function blockAppOrigins(urls: string[]): void {
  blockedPorts = new Set(urls.map((u) => new URL(u).port || "80"));
}

export const assertNavigable = (url: string): void => checkNavigable(url, blockedPorts);

export class BrowserHost extends EventEmitter<{ changed: [] }> {
  #tabs = new Map<string, Tab>();
  #active: string | undefined;
  #seq = 0;
  #configured = new WeakSet<Session>();
  #handoffs = new Map<string, (ok: boolean) => void>();
  /** Calls running on each tab. */
  #busy = new Map<string, number>();
  /** The tabs the core's running turns hold (browser.hold); a tab whose agent's turn ended is free again. */
  #holds = createTabHolds((id) => {
    const tab = this.#tabs.get(id);
    if (tab?.control.kind !== "agent") return;
    tab.control = { kind: "idle" };
    this.emit("changed");
  });
  /** Called when a tab needs the human (handoff): the window should come forward and notify. */
  onAttention: (message: string) => void = () => {};
  /** Called whenever the visible tab changes, so the window can lay it out. */
  onShow: (view: WebContentsView | undefined) => void = () => {};
  /** Preload of the web apps (saved passwords); never given to shared, agent or incognito tabs. */
  appPreload: string | undefined;
  /** Called with each web app's id and its page, so the shell can tell which app a message comes from. */
  onAppView: (appId: string, wc: WebContents) => void = () => {};
  /** CHROME-1: a page went into or out of full screen (a video player), so the window can give it the whole area. */
  onFullScreen: (view: WebContentsView, on: boolean) => void = () => {};
  /** CHROME-1: the owner pressed Ctrl/Cmd+F on a page: the panel shows its search bar. */
  onFind: (tab: string) => void = () => {};
  /** CHROME-1: how many matches the search found and which one is selected. */
  onFound: (tab: string, active: number, total: number) => void = () => {};
  /** CHROME-1: a page asks for the microphone, the camera, the location…: the owner answers. Unset → refused. */
  onPermission: ((tab: string, permission: string, origin: string, media: string[]) => Promise<boolean>) | undefined;
  /** CHROME-1: a page of the owner's started a download. Unset → downloads are cancelled, as before. */
  onDownload: ((item: DownloadItem, tab: string) => void) | undefined;

  get active(): string | undefined {
    return this.#active;
  }

  info(tab: Tab): TabInfo {
    const wc = tab.wc;
    const zoom = Math.round(wc.getZoomFactor() * 100) / 100;
    return {
      tab: tab.id,
      // A failed load leaves Chromium's own error document: the address the owner asked for is the one to show.
      url: tab.failed ? tab.failed.url : wc.getURL(),
      title: wc.getTitle(),
      profile: tab.profile,
      control: tab.control,
      consent_epoch: tab.cdp.consentEpoch,
      ...(wc.isLoading() ? { loading: true } : {}),
      ...(wc.isCurrentlyAudible() ? { audible: true } : {}),
      ...(tab.failed ? { error: tab.failed.error.slice(0, 200) } : {}),
      ...(zoom !== 1 ? { zoom } : {}),
      ...(tab.opener ? { opener: tab.opener } : {}),
    };
  }

  list(): TabInfo[] {
    return [...this.#tabs.values()].filter((t) => !t.wc.isDestroyed()).map((t) => this.info(t));
  }

  /** Executes a browser.* request coming from the core. Params are re-validated: the node trusts nobody. */
  async handle(method: string, raw: unknown): Promise<unknown> {
    if (method === BROWSER_HOLD) return this.#holds.set(raw);
    const id = (raw as { tab?: unknown } | null)?.tab;
    if (typeof id !== "string") return this.#run(method, raw);
    // The tab is locked while the call runs: closing it for being idle would pull the page from under the agent.
    this.#busy.set(id, (this.#busy.get(id) ?? 0) + 1);
    try {
      return await this.#run(method, raw);
    } finally {
      const left = (this.#busy.get(id) ?? 1) - 1;
      if (left > 0) this.#busy.set(id, left);
      else this.#busy.delete(id);
      const tab = this.#tabs.get(id);
      if (tab) tab.used = Date.now();
    }
  }

  async #run(method: string, raw: unknown): Promise<unknown> {
    switch (method) {
      case "browser.tabs":
        return { tabs: this.list() };
      case "browser.open": {
        const p = browserMethods["browser.open"].params.parse(raw);
        // A tab the human opens from the panel is nobody's until an agent picks it up.
        const control: TabControl =
          p.by === "operator" ? { kind: "idle" } : { kind: "agent", by: p.by, since: new Date().toISOString() };
        const tab = await this.open(p.url, p.profile, control);
        return this.info(tab);
      }
      case "browser.navigate": {
        const p = browserMethods["browser.navigate"].params.parse(raw);
        const tab = p.by === "operator" ? this.#get(p.tab) : this.#drive(p.tab, p.by);
        await this.#load(tab, p.url);
        return { url: tab.wc.getURL(), title: tab.wc.getTitle() };
      }
      case "browser.history": {
        const p = browserMethods["browser.history"].params.parse(raw);
        // The human's own toolbar calls as "operator" and must not take the tab over as an agent.
        const tab = p.by === "operator" ? this.#get(p.tab) : this.#drive(p.tab, p.by);
        const nav = tab.wc.navigationHistory;
        if (p.action === "back" && nav.canGoBack()) nav.goBack();
        else if (p.action === "forward" && nav.canGoForward()) nav.goForward();
        else if (p.action === "reload") this.#reload(tab);
        await this.#settle(tab);
        return { url: tab.wc.getURL(), title: tab.wc.getTitle() };
      }
      case "browser.snapshot": {
        const p = browserMethods["browser.snapshot"].params.parse(raw);
        const tab = this.#readable(p.tab);
        const wc = tab.wc;
        const snap = await tab.cdp.snapshot(p.max_chars);
        // Page text is data, never instructions, wherever it ends up (rule 10).
        const tree = `<untrusted_web source="${wc.getURL()}">\n${snap.tree}\n</untrusted_web>`;
        return {
          url: wc.getURL(),
          title: wc.getTitle(),
          tree,
          refs: snap.refs,
          truncated: snap.truncated,
          document: snap.document,
        };
      }
      case "browser.click": {
        const p = browserMethods["browser.click"].params.parse(raw);
        const tab = this.#drive(p.tab, p.by);
        await tab.cdp.click(p.ref);
        await this.#settle(tab);
        return { ok: true, url: tab.wc.getURL() };
      }
      case "browser.type": {
        const p = browserMethods["browser.type"].params.parse(raw);
        const tab = this.#drive(p.tab, p.by);
        await tab.cdp.type(p.ref, p.text, p.submit);
        if (p.submit) await this.#settle(tab);
        return { ok: true, url: tab.wc.getURL() };
      }
      case "browser.approval_context": {
        const p = browserMethods["browser.approval_context"].params.parse(raw);
        return this.#readable(p.tab).cdp.approvalContext(p.origin, p.document);
      }
      case "browser.evaluate": {
        const p = browserMethods["browser.evaluate"].params.parse(raw);
        const tab = this.#drive(p.tab, p.by);
        const result = await tab.cdp.evaluate(p.script, p.origin, p.document, p.epoch);
        return { url: tab.wc.getURL(), ...result };
      }
      case "browser.screenshot": {
        const p = browserMethods["browser.screenshot"].params.parse(raw);
        const jpeg = await this.#get(p.tab).cdp.screenshot();
        return { mime: "image/jpeg", data: jpeg.toString("base64"), bytes: jpeg.length };
      }
      case "browser.text": {
        const p = browserMethods["browser.text"].params.parse(raw);
        const wc = this.#readable(p.tab).wc;
        // Isolated world: the page's scripts cannot see or patch this read.
        // Resolves to the script's value (a string), not to an array of results.
        const full = (await wc.executeJavaScriptInIsolatedWorld(999, [
          { code: "document.body ? document.body.innerText : ''" },
        ])) as unknown;
        const text = String(full ?? "").replace(/\n{3,}/g, "\n\n");
        const slice = text.slice(p.offset, p.offset + p.max_chars);
        return { url: wc.getURL(), text: slice, total: text.length, truncated: p.offset + p.max_chars < text.length };
      }
      case "browser.control": {
        const p = browserMethods["browser.control"].params.parse(raw);
        if (p.mode === "user") this.takeControl(p.tab);
        else this.giveBack(p.tab, p.mode === "done");
        // Let a resumed handoff settle its new control state before reporting it.
        await new Promise((r) => setImmediate(r));
        return this.info(this.#get(p.tab));
      }
      case "browser.handoff": {
        const p = browserMethods["browser.handoff"].params.parse(raw);
        const tab = this.#get(p.tab);
        if (tab.control.kind === "handoff" || this.#handoffs.has(tab.id)) {
          throw new ColoniaError({ code: "paused_by_user", message: "this tab is already waiting for the human" });
        }
        tab.control = { kind: "handoff", by: p.by, reason: p.reason, since: new Date().toISOString() };
        this.select(tab.id);
        this.onAttention(`${p.by} necesita que ${p.reason}`);
        this.emit("changed");
        const resolved = await new Promise<boolean>((resolve) => {
          const waiter = (ok: boolean) => {
            clearTimeout(timer);
            if (this.#handoffs.get(tab.id) === waiter) this.#handoffs.delete(tab.id);
            resolve(ok);
          };
          const timer = setTimeout(() => waiter(false), p.timeout_s * 1000);
          this.#handoffs.set(tab.id, waiter);
        });
        if (!this.#tabs.has(tab.id)) return { resolved: false, url: "", title: "" };
        tab.control = resolved ? { kind: "agent", by: p.by, since: new Date().toISOString() } : { kind: "idle" };
        this.emit("changed");
        return { resolved, url: tab.wc.getURL(), title: tab.wc.getTitle() };
      }
      case "browser.signed_in": {
        // NAVEGADORES-2: which sites this profile's jar keeps cookies for — host names only, never a value.
        const p = browserMethods["browser.signed_in"].params.parse(raw);
        const ses = session.fromPartition(partitionFor(p.profile, 0));
        return { sites: signedInSites(await ses.cookies.get({})) };
      }
      case "browser.cookie_sources":
        return {
          sources: discoverSources().map(({ id, browser, profile, family }) => ({ id, browser, profile, family })),
        };
      case "browser.cookie_domains": {
        const p = browserMethods["browser.cookie_domains"].params.parse(raw);
        return { domains: (await listDomains(this.#source(p.source), p.filter)).slice(0, 200) };
      }
      case "browser.import_cookies": {
        const p = browserMethods["browser.import_cookies"].params.parse(raw);
        const ses = session.fromPartition(partitionFor(p.profile, 0));
        this.#configure(ses);
        return importCookies(this.#source(p.source), p.domains, ses);
      }
      case "browser.close": {
        const p = browserMethods["browser.close"].params.parse(raw);
        await this.close(p.tab);
        return { ok: true };
      }
      default:
        throw new ColoniaError({ code: "unknown_method", message: `browser node does not serve ${method}` });
    }
  }

  async open(url: string, profile: BrowserProfile, control: TabControl, opener?: string): Promise<Tab> {
    assertNavigable(url);
    const live = [...this.#tabs.values()];
    const agents = live.filter((t) => t.control.kind === "agent" || t.control.kind === "handoff").length;
    if (control.kind === "agent" && agents >= MAX_AGENT_TABS)
      throw new ColoniaError({ code: "unavailable", message: `tab limit (${MAX_AGENT_TABS}) reached` });
    if (live.length >= MAX_TABS)
      throw new ColoniaError({ code: "unavailable", message: `tab limit (${MAX_TABS}) reached` });
    const id = `t${++this.#seq}`;
    const ses = session.fromPartition(partitionFor(profile, this.#seq));
    this.#configure(ses, profile.startsWith("app:"));
    const view = new WebContentsView({
      webPreferences: {
        session: ses,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
        // CHROME-1: Chromium's own PDF viewer is a plugin; without it a PDF link shows nothing.
        plugins: true,
        ...(profile.startsWith("app:") && this.appPreload ? { preload: this.appPreload } : {}),
      },
    });
    if (profile.startsWith("app:")) this.onAppView(profile.slice("app:".length), view.webContents);
    const tab = this.#mount(id, view, profile, control, opener);
    this.select(id);
    await this.#load(tab, url);
    // CDP domains only answer once the tab has a renderer. See HISTORY.md#cdp-attach-after-load
    await tab.cdp.attach();
    return tab;
  }

  /** Wires a page as a tab: one the host created, or one a page opened (a link in a new tab, a sign-in window). */
  #mount(id: string, view: WebContentsView, profile: BrowserProfile, control: TabControl, opener?: string): Tab {
    const wc = view.webContents;
    // CHROME-1: a page that opens a window gets a new tab, as in any browser (a sign-in window has to stay a
    // separate page that can talk to the one that opened it). An agent's tab and a pinned web app keep everything
    // in the page they are: the agent must find the result in the tab it drives.
    wc.setWindowOpenHandler(({ url: next, disposition }) => {
      const blank = next === "" || next === "about:blank";
      try {
        if (!blank) assertNavigable(next);
      } catch {
        return { action: "deny" };
      }
      const from = this.#tabs.get(id);
      const same =
        !from ||
        from.control.kind === "agent" ||
        from.control.kind === "handoff" ||
        profile.startsWith("app:") ||
        this.#tabs.size >= MAX_TABS;
      if (same) {
        if (!blank) void wc.loadURL(next).catch(() => {});
        return { action: "deny" };
      }
      return {
        action: "allow",
        createWindow: (options) => {
          const child = new WebContentsView({
            webContents: (options as { webContents?: WebContents }).webContents,
            webPreferences: options.webPreferences,
          } as ConstructorParameters<typeof WebContentsView>[0]);
          const born = this.#mount(`t${++this.#seq}`, child, profile, { kind: "idle" }, id);
          if (disposition === "background-tab") this.emit("changed");
          else this.select(born.id);
          return child.webContents;
        },
      };
    });
    // Same guard for clicks, redirects and subframes: a redirect must not reach what a direct load cannot.
    const guard = (e: { preventDefault(): void }, next: string) => {
      try {
        assertNavigable(next);
      } catch {
        e.preventDefault();
      }
    };
    wc.on("will-navigate", (e) => guard(e, e.url));
    wc.on("will-redirect", (e) => guard(e, e.url));
    wc.on("will-frame-navigate", (e) => guard(e, e.url));
    // The owner clicking or typing in a page an agent drives takes it over; the agent's own calls (busy) do not.
    const touched = () => {
      if (this.#tabs.get(id)?.control.kind === "agent" && !this.#busy.has(id)) this.takeControl(id);
    };
    wc.on("before-input-event", (e, input) => {
      if (input.type !== "keyDown") return;
      touched();
      // Esc leaves full screen even when the page keeps the key for itself.
      if (input.key === "Escape" && tab.full) this.#exitFull(tab);
      // CHROME-1: the browser's own shortcuts (find, zoom, print, reload, back). Never for an agent's key presses.
      if (this.#busy.has(id)) return;
      const action = shortcut(input, process.platform === "darwin");
      // A pinned web app is not shown inside the browser panel, which is where the search bar lives.
      if (!action || (action === "find" && profile.startsWith("app:"))) return;
      e.preventDefault();
      this.act(id, action);
    });
    wc.on("before-mouse-event", (_e, mouse) => mouse.type === "mouseDown" && touched());
    const cdp = new CdpTab(wc);
    const tab: Tab = {
      id,
      profile,
      view,
      wc,
      session: wc.session,
      cdp,
      control,
      used: Date.now(),
      ...(opener ? { opener } : {}),
    };
    const changed = () => {
      if (this.#tabs.get(id) !== tab) return;
      if (wc.isDestroyed()) this.#remove(tab);
      else this.emit("changed");
    };
    // CHROME-1: the panel hears a load the moment it starts and each address it reaches, not only its end: until
    // then a slow page looked like a dead click (no spinner, the old address still in the bar).
    for (const ev of [
      "page-title-updated",
      "did-start-loading",
      "did-stop-loading",
      "did-navigate",
      "did-navigate-in-page",
      "audio-state-changed",
    ] as const) {
      wc.on(ev as "did-stop-loading", changed);
    }
    // CHROME-1: a load that fails (no such site, connection refused, offline) used to leave a blank page.
    wc.on("did-fail-load", (_e, code, description, failedUrl, isMainFrame) => {
      // -3 is ERR_ABORTED: the owner went elsewhere or a download took the request; nothing failed.
      if (!isMainFrame || code === -3) return;
      tab.failed = { error: description || `ERR ${code}`, url: failedUrl };
      changed();
    });
    wc.on("did-start-navigation", (details) => {
      if (!details.isMainFrame || details.isSameDocument || details.url.startsWith("chrome-error://")) return;
      if (!tab.failed) return;
      delete tab.failed;
      changed();
    });
    wc.on("enter-html-full-screen", () => {
      tab.full = true;
      this.onFullScreen(view, true);
    });
    wc.on("leave-html-full-screen", () => {
      tab.full = false;
      this.onFullScreen(view, false);
    });
    wc.on("found-in-page", (_e, result) => {
      if (result.finalUpdate) this.onFound(id, result.activeMatchOrdinal, result.matches);
    });
    // Ctrl/Cmd + wheel.
    wc.on("zoom-changed", (_e, direction) => this.act(id, direction === "in" ? "zoom-in" : "zoom-out"));
    cdp.onInvalidate = changed;
    wc.once("destroyed", () => this.#remove(tab));
    this.#tabs.set(id, tab);
    return tab;
  }

  /** CHROME-1: what a browser shortcut, the toolbar or the page's menu does to a tab. */
  act(id: string, action: TabAction): void {
    const tab = this.#get(id);
    const wc = tab.wc;
    const nav = wc.navigationHistory;
    switch (action) {
      case "find":
        return this.onFind(id);
      case "zoom-in":
      case "zoom-out":
      case "zoom-reset":
        wc.setZoomFactor(nextZoom(wc.getZoomFactor(), action));
        this.emit("changed");
        return;
      case "print":
        return wc.print();
      case "reload":
        return this.#reload(tab);
      case "stop":
        return wc.stop();
      case "back":
        if (nav.canGoBack()) nav.goBack();
        return;
      case "forward":
        if (nav.canGoForward()) nav.goForward();
        return;
      case "devtools":
        return wc.openDevTools({ mode: "detach" });
    }
  }

  /** Takes a page out of full screen (the owner pressed Esc, changed tab or left the window's full screen). */
  exitFullScreen(view: WebContentsView): void {
    for (const t of this.#tabs.values()) if (t.view === view) this.#exitFull(t);
  }

  #exitFull(tab: Tab): void {
    if (tab.wc.isDestroyed()) return;
    void tab.wc
      .executeJavaScript("document.fullscreenElement ? document.exitFullscreen() : undefined", true)
      .catch(() => {});
  }

  /** CHROME-1: a link or an image of a page, opened in a new tab next to it. */
  async openFrom(id: string, url: string): Promise<void> {
    const from = this.#get(id);
    // A pinned web app stays the one page it is.
    if (from.profile.startsWith("app:")) return this.#load(from, url);
    await this.open(url, from.profile, { kind: "idle" }, id);
  }

  /** Reloading a page that failed asks for its address again, not for Chromium's error document. */
  #reload(tab: Tab): void {
    if (tab.failed) void tab.wc.loadURL(tab.failed.url).catch(() => {});
    else tab.wc.reload();
  }

  /** CHROME-1: searches the page; `next` moves to the following (or previous) match of the same text. */
  find(id: string, text: string, forward = true, next = false): void {
    const wc = this.#get(id).wc;
    if (text) wc.findInPage(text, { forward, findNext: !next });
    else wc.stopFindInPage("clearSelection");
  }

  stopFind(id: string): void {
    const tab = this.#tabs.get(id);
    if (tab && !tab.wc.isDestroyed()) tab.wc.stopFindInPage("clearSelection");
  }

  /** The tab a page belongs to. */
  tabOf(wc: WebContents): string | undefined {
    for (const t of this.#tabs.values()) if (t.wc === wc) return t.id;
    return undefined;
  }

  select(id: string): void {
    const tab = this.#get(id);
    this.#active = id;
    this.onShow(tab.view);
    this.emit("changed");
  }

  async close(id: string): Promise<void> {
    const tab = this.#get(id);
    // Detach the tab before native close can synchronously invalidate CDP or reenter layout.
    this.#remove(tab);
    if (!tab.wc.isDestroyed()) tab.wc.close();
    await tab.cleanup;
  }

  #remove(tab: Tab): void {
    if (this.#tabs.get(tab.id) !== tab) return;
    this.#tabs.delete(tab.id);
    // A page a private tab opened shares its session: the data goes with the last of them.
    const shared = [...this.#tabs.values()].some((t) => t.session === tab.session);
    if (tab.profile === "incognito" && !shared) {
      // In-memory partitions outlive destroyed contents; all retirement paths share one cleanup.
      tab.cleanup = Promise.resolve().then(async () => {
        await Promise.all([tab.session.clearStorageData(), tab.session.clearCache()]);
      });
      void tab.cleanup.catch((error: unknown) => console.warn("Could not clear private browsing data", error));
    }
    const active = this.#active === tab.id;
    if (active) this.#active = [...this.#tabs.values()].filter((t) => !t.wc.isDestroyed()).at(-1)?.id;
    this.#handoffs.get(tab.id)?.(false);
    if (active) this.onShow(this.#active ? this.#tabs.get(this.#active)?.view : undefined);
    this.emit("changed");
  }

  /** The human takes the wheel: every agent call on this tab now fails with paused_by_user. */
  takeControl(id: string): void {
    this.#get(id).control = { kind: "user", since: new Date().toISOString() };
    this.emit("changed");
  }

  /** `done` finishes a pending handoff (the agent resumes); `idle` ends it as not done. */
  giveBack(id: string, done = false): void {
    const tab = this.#get(id);
    const waiter = this.#handoffs.get(id);
    if (waiter) {
      waiter(done);
      return;
    }
    tab.control = { kind: "idle" };
    this.emit("changed");
  }

  async userNavigate(id: string, url: string): Promise<void> {
    const tab = this.#get(id);
    await this.#load(tab, /^https?:\/\//.test(url) ? url : `https://${url}`);
  }

  #source(id: string) {
    const src = discoverSources().find((s) => s.id === id);
    if (!src) throw new ColoniaError({ code: "bad_request", message: `unknown cookie source ${id}` });
    return src;
  }

  /** Reading page content while the human has the tab could expose what they type (codes, card data). */
  #readable(id: string): Tab {
    const tab = this.#get(id);
    if (tab.control.kind === "user" || tab.control.kind === "handoff") {
      throw new ColoniaError({ code: "paused_by_user", message: "the human has this tab right now; wait for them" });
    }
    return tab;
  }

  #get(id: string): Tab {
    const tab = this.#tabs.get(id);
    if (!tab || tab.wc.isDestroyed()) throw new ColoniaError({ code: "bad_request", message: `unknown tab ${id}` });
    tab.used = Date.now();
    return tab;
  }

  /** Closes the tabs off screen that nobody used for a while and that are not locked; returns how many. */
  async closeIdle(onScreen: (view: WebContentsView) => boolean, now = Date.now()): Promise<number> {
    // The time off screen counts from when the page left it.
    for (const t of this.#tabs.values()) if (onScreen(t.view)) t.used = now;
    const ids = idleTabs(
      [...this.#tabs.values()].map((t) => ({
        id: t.id,
        used: t.used,
        locked:
          this.#busy.has(t.id) ||
          t.profile.startsWith("app:") || // ACCESOS-1: el correo y el chat siguen vivos para contar no leídos y avisar
          this.#holds.held(t.id) ||
          t.control.kind === "user" ||
          t.control.kind === "handoff" ||
          this.#handoffs.has(t.id),
      })),
      now,
      (id) => {
        const t = this.#tabs.get(id);
        return Boolean(t && onScreen(t.view));
      },
    );
    for (const id of ids) await this.close(id).catch(() => {});
    return ids.length;
  }

  /** The link to the core dropped: its turns' holds go too (a core that comes back tells them again). */
  dropHolds(): void {
    this.#holds.clear();
  }

  /** Each tab's renderer process and its site, for the memory report. */
  processOwners(): Map<number, ProcessOwner> {
    const out = new Map<number, ProcessOwner>();
    for (const t of this.#tabs.values()) {
      const wc = t.wc;
      if (wc.isDestroyed()) continue;
      let site = "";
      try {
        site = new URL(wc.getURL()).hostname;
      } catch {}
      out.set(wc.getOSProcessId(), { kind: "tab", ...(site ? { site } : {}) });
    }
    return out;
  }

  #drive(id: string, by: string): Tab {
    const tab = this.#get(id);
    if (tab.control.kind === "user" || tab.control.kind === "handoff") {
      throw new ColoniaError({ code: "paused_by_user", message: "the human has this tab right now; wait or ask them" });
    }
    if (tab.control.kind !== "agent" || tab.control.by !== by) {
      tab.control = { kind: "agent", by, since: new Date().toISOString() };
      this.emit("changed");
    }
    return tab;
  }

  /** Resolves at dom-ready (usable page), not at full load: ads and trackers must not hold the agent hostage. */
  async #load(tab: Tab, url: string): Promise<void> {
    assertNavigable(url);
    const wc = tab.wc;
    const ready = new Promise<void>((resolve) => {
      const done = () => {
        wc.off("dom-ready", done);
        wc.off("did-fail-load", done);
        resolve();
      };
      wc.on("dom-ready", done);
      wc.on("did-fail-load", done);
    });
    // Redirects reject loadURL with ERR_ABORTED although the page loads: not an error for us.
    wc.loadURL(url).catch(() => {});
    await Promise.race([ready, new Promise<void>((resolve) => setTimeout(resolve, NAV_TIMEOUT_MS))]);
  }

  /** After an action that may navigate: give it a beat, then wait for loading to stop (bounded). */
  async #settle(tab: Tab): Promise<void> {
    await new Promise((r) => setTimeout(r, 250));
    const wc = tab.wc;
    if (!wc.isLoading()) return;
    await Promise.race([
      new Promise<void>((resolve) => wc.once("did-stop-loading", () => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, NAV_TIMEOUT_MS)),
    ]);
  }

  #configure(ses: Session, notifications = false): void {
    if (this.#configured.has(ses)) return;
    this.#configured.add(ses);
    ses.setUserAgent(cleanUserAgent());
    // Camera, mic, geolocation, notifications, clipboard-read: denied unless a later UI grants them.
    // ACCESOS-1: la excepción son los avisos de las aplicaciones web fijadas (Gmail, Outlook, Slack…).
    const allow = (perm: string) => notifications && perm === "notifications";
    // CHROME-1: refusing everything also refused what a page does on a plain click: "fullscreen" (a video never
    // went full screen) and writing to the clipboard (the "Copy" buttons did nothing). Those are granted; a device
    // or the owner's attention is asked for, once per site while the app runs; an agent's tab never asks.
    const granted = new Set<string>();
    const keys = (perm: string, origin: string, media: readonly string[]) =>
      perm === "media" && media.length ? media.map((m) => `media:${m} ${origin}`) : [`${perm} ${origin}`];
    ses.setPermissionRequestHandler((wc, perm, cb, details) => {
      if (allow(perm)) return cb(true);
      const policy = permissionPolicy(perm);
      if (policy === "allow") return cb(true);
      const id = wc ? this.tabOf(wc) : undefined;
      const tab = id ? this.#tabs.get(id) : undefined;
      const origin = originOf(details.requestingUrl);
      if (policy === "deny" || !tab || !origin || !this.onPermission) return cb(false);
      if (tab.control.kind === "agent" || this.#busy.has(tab.id)) return cb(false);
      const media = [...((details as { mediaTypes?: string[] }).mediaTypes ?? [])].sort();
      const wanted = keys(perm, origin, media);
      if (wanted.every((k) => granted.has(k))) return cb(true);
      this.onPermission(tab.id, perm, origin, media).then(
        (ok) => {
          if (ok) for (const k of wanted) granted.add(k);
          cb(ok);
        },
        () => cb(false),
      );
    });
    ses.setPermissionCheckHandler((_wc, perm, requestingOrigin, details) => {
      if (allow(perm) || permissionPolicy(perm) === "allow") return true;
      const origin = originOf(requestingOrigin);
      if (!origin) return false;
      const type = (details as { mediaType?: string }).mediaType;
      // Before anything was asked, "media" is checked without a device: any device granted to the site answers yes.
      if (perm === "media" && (!type || type === "unknown"))
        return granted.has(`media:audio ${origin}`) || granted.has(`media:video ${origin}`);
      return granted.has(perm === "media" ? `media:${type} ${origin}` : `${perm} ${origin}`);
    });
    // CHROME-1: the owner's downloads go to the downloads folder; a page an agent drives still downloads nothing.
    ses.on("will-download", (e, item, wc) => {
      const id = wc ? this.tabOf(wc) : undefined;
      const tab = id ? this.#tabs.get(id) : undefined;
      if (!tab || !this.onDownload || tab.control.kind === "agent" || this.#busy.has(tab.id)) return e.preventDefault();
      this.onDownload(item, tab.id);
      // A tab a page opened only to hand over a file has nothing to show.
      if (tab.opener && !wc?.getURL()) setImmediate(() => void this.close(tab.id).catch(() => {}));
    });
  }
}
