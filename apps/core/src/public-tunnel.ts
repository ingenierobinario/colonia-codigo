// Public ingress infrastructure: Tailscale Funnel, ngrok, an owner's HTTPS proxy or a temporary Cloudflare Quick Tunnel
// (ENLACE-TEMPORAL-1) targets the restricted listener, never the private daemon. The existing webhooks.* contract and saved setting select this shared tunnel.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { type HookError, type HookMode, tailscaleDnsName, type WebhooksState } from "@colonia/protocol";
import { findTailscale, type TailscaleRun, tailscaleRunner } from "./access.ts";
import { cloudflaredLine, ensureCloudflared } from "./cloudflared.ts";
import type { Store } from "./domain/store.ts";
import { CallError } from "./errors.ts";
import type { Log } from "./log.ts";

/** Funnel's own HTTPS port for webhooks: 443 stays what `colonia tailscale connect` serves to the tailnet. */
const FUNNEL_PORT = 8443;
/** How long ngrok may take to say its address before the owner is told it failed. */
export const NGROK_WAIT_MS = 15_000;
/** How long cloudflared may take to say its trycloudflare address (it asks Cloudflare's service for one). */
export const CLOUDFLARE_WAIT_MS = 45_000;
/** How long what this computer has (Tailscale connected, ngrok installed) is trusted: the panel asks every 10 s. */
const PROBE_TTL_MS = 30_000;
/** A tunnel that died is started again after 2 s, then 4, 8… up to a minute between tries. */
const retryAfter = (attempt: number) => Math.min(60_000, 2_000 * 2 ** attempt);

/** A running ngrok: its log lines as they come, its end, and a way to stop it. */
export type NgrokProcess = {
  onLine(fn: (line: string) => void): void;
  onExit(fn: (code: number | null) => void): void;
  stop(): void;
};
export type NgrokStart = (args: string[]) => NgrokProcess;

export function findNgrok(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const name = process.platform === "win32" ? "ngrok.exe" : "ngrok";
  const dirs = [...(env.PATH ?? "").split(path.delimiter), "/opt/homebrew/bin", "/usr/local/bin"].filter(Boolean);
  for (const dir of dirs) if (fs.existsSync(path.join(dir, name))) return path.join(dir, name);
  return undefined;
}

const ngrokSpawner =
  (bin: string): NgrokStart =>
  (args) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    return {
      onLine: (fn) => {
        for (const stream of [child.stdout, child.stderr]) createInterface({ input: stream }).on("line", fn);
      },
      onExit: (fn) => child.on("exit", fn),
      stop: () => child.kill(),
    };
  };

function publicOrigin(value: string): string | undefined {
  try {
    const base = new URL(value);
    if (
      base.protocol === "https:" &&
      !base.username &&
      !base.password &&
      !base.search &&
      !base.hash &&
      base.pathname === "/"
    )
      return base.origin;
  } catch {}
  return;
}

/** What one ngrok log line (JSON, `--log-format json`) says: its public URL, or why it failed. */
export function ngrokLine(line: string): { url?: string; error?: string } {
  let j: { msg?: string; url?: string; lvl?: string; err?: string };
  try {
    j = JSON.parse(line);
  } catch {
    return {};
  }
  if (!j || typeof j !== "object") return {};
  const origin = typeof j.url === "string" ? publicOrigin(j.url) : undefined;
  if (j.msg === "started tunnel" && origin) return { url: origin };
  if (j.lvl === "eror" || j.lvl === "crit")
    return {
      error: (typeof j.err === "string" ? j.err : typeof j.msg === "string" ? j.msg : "ngrok failed").slice(0, 300),
    };
  return {};
}

type TunnelChoice = { mode: HookMode; url?: string | undefined; domain?: string | undefined };
const tailscaleDns = async (run: TailscaleRun | undefined) => {
  const st = await run?.(["status", "--json"]);
  return st?.ok ? tailscaleDnsName(st.out) : undefined;
};

function createProbe(tailscale: () => TailscaleRun | undefined, ngrok: () => NgrokStart | undefined) {
  type Probe = { tailscale: { installed: boolean; connected: boolean }; ngrok: { installed: boolean } };
  let probed: { at: number; found: Promise<Probe> } | undefined;
  return {
    clear: () => {
      probed = undefined;
    },
    read(): Promise<Probe> {
      if (probed && Date.now() - probed.at < PROBE_TTL_MS) return probed.found;
      const run = tailscale();
      const found = tailscaleDns(run).then((dns) => ({
        tailscale: { installed: Boolean(run), connected: Boolean(dns) },
        ngrok: { installed: Boolean(ngrok()) },
      }));
      probed = { at: Date.now(), found };
      return found;
    },
  };
}

/** Whether Tailscale still serves Colonia's Funnel port; when it cannot even say, assume it does. */
async function funnelStillOn(run: TailscaleRun): Promise<boolean> {
  const st = await run(["funnel", "status", "--json"]);
  if (!st.ok) return true;
  try {
    const cfg = JSON.parse(st.out || "{}") as { AllowFunnel?: Record<string, boolean>; Web?: Record<string, unknown> };
    const on = (keys: Record<string, unknown> | undefined) =>
      Object.keys(keys ?? {}).some((k) => k.endsWith(`:${FUNNEL_PORT}`));
    return on(cfg.AllowFunnel) || on(cfg.Web);
  } catch {
    return true;
  }
}

async function saveChoice(store: Store, tailscale: () => TailscaleRun | undefined, choice: TunnelChoice) {
  if (choice.mode === "custom" && !publicOrigin(choice.url ?? ""))
    throw new CallError({
      code: "bad_request",
      message: "a public address needs an https:// origin without credentials, path or query",
    });
  if (choice.mode === "ngrok" && choice.domain && !/^[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(choice.domain))
    throw new CallError({ code: "bad_request", message: "a reserved domain must be a hostname" });
  const { mode: before, ngrok_last } = store.settings.read("webhooks");
  // Only undo Colonia's public Funnel port; private Serve and other tunnels are not Colonia's.
  // FUNNEL-APAGAR-1 · `funnel … off` fails when there is nothing to turn off (Funnel never came up, Tailscale was
  // removed): that must not keep the owner stuck on Tailscale. Only a Funnel still serving our port is a reason.
  if (before === "tailscale" && choice.mode !== "tailscale") {
    const run = tailscale();
    if (run && !(await run(["funnel", `--https=${FUNNEL_PORT}`, "off"])).ok && (await funnelStillOn(run)))
      throw new CallError({
        code: "unavailable",
        message: "could not disable the public Funnel; check Tailscale before changing providers",
      });
  }
  store.settings.write("webhooks", {
    mode: choice.mode,
    ...(choice.mode === "custom" && choice.url ? { url: choice.url } : {}),
    ...(choice.mode === "ngrok" && choice.domain ? { domain: choice.domain } : {}),
    ...(ngrok_last ? { ngrok_last } : {}),
  });
}

export function createPublicTunnel(deps: {
  workspace?: boolean;
  store: Store;
  /** The webhook listener's port, once it listens. */
  port: () => number;
  log: Log;
  tailscale?: TailscaleRun | undefined;
  ngrok?: NgrokStart | undefined;
  /** Colonia's data folder: where the verified cloudflared is kept. */
  home?: string | undefined;
  /** Starts cloudflared (tests pass a fake); by default the verified binary from `home`. */
  cloudflared?: NgrokStart | undefined;
  /** How long to wait before starting a dead tunnel again, by attempt (tests pass a short one). */
  retryMs?: ((attempt: number) => number) | undefined;
}) {
  const tailscaleRun = (): TailscaleRun | undefined => {
    if (deps.workspace) return undefined;
    if (deps.tailscale) return deps.tailscale;
    const bin = findTailscale();
    return bin ? tailscaleRunner(bin) : undefined;
  };
  const ngrokStart = (): NgrokStart | undefined => {
    if (deps.ngrok) return deps.ngrok;
    const bin = findNgrok();
    return bin ? ngrokSpawner(bin) : undefined;
  };
  const cloudflaredStart = async (): Promise<NgrokStart> => {
    if (deps.cloudflared) return deps.cloudflared;
    if (!deps.home) throw new Error("no data folder for cloudflared");
    return ngrokSpawner(await ensureCloudflared(deps.home));
  };
  const retryMs = deps.retryMs ?? retryAfter;
  /** The temporary link is being prepared: downloading cloudflared or waiting for its address. */
  let starting = false;
  /** Bumped by every apply and by close: a cloudflared start from an older one gives up. */
  let generation = 0;
  let url: string | undefined;
  let error: { code: HookError; detail?: string | undefined } | undefined;
  let tunnel: NgrokProcess | undefined;
  /** ngrok gave an address it had not given before: the first one, or another after it started again. */
  let fresh = false;
  let retry: NodeJS.Timeout | undefined;
  let attempts = 0;
  const probe = createProbe(tailscaleRun, ngrokStart);

  let closed = false;
  let changing: Promise<void> = Promise.resolve();
  const change = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = changing.then(fn);
    changing = next.then(
      () => {},
      () => {},
    );
    return next;
  };
  const saved = () => deps.store.settings.read("webhooks");
  const fail = (code: HookError, detail?: string) => {
    error = { code, ...(detail ? { detail: detail.slice(0, 300) } : {}) };
  };

  function stopNgrok() {
    clearTimeout(retry);
    retry = undefined;
    const t = tunnel;
    tunnel = undefined;
    t?.stop();
  }

  /** A tunnel that died while its provider is still the choice comes back, later each time it dies again. */
  function restartLater(mode: "ngrok" | "cloudflare", domain: string | undefined) {
    const wait = retryMs(attempts++);
    deps.log.info({ wait_ms: wait, attempt: attempts, mode }, "webhooks: tunnel starts again");
    retry = setTimeout(() => {
      retry = undefined;
      if (closed || saved().mode !== mode || tunnel) return;
      if (mode === "ngrok") void startNgrok(domain);
      else void startCloudflare(generation);
    }, wait);
    retry.unref();
  }

  /**
   * Fetches cloudflared if needed and starts a Quick Tunnel to the restricted listener only. Runs in the background
   * (the download can take longer than a call may wait): the panel asks `webhooks.get` until the address or an error.
   */
  async function startCloudflare(gen: number): Promise<void> {
    starting = true;
    let start: NgrokStart;
    try {
      start = await cloudflaredStart();
    } catch (e) {
      if (gen !== generation) return;
      starting = false;
      // What failed goes to the log; the panel says it in the owner's words.
      fail("cloudflare_download");
      deps.log.warn({ error: e instanceof Error ? e.message : String(e) }, "webhooks: cloudflared not available");
      return;
    }
    if (gen !== generation || closed) return;
    const t = start(["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${deps.port()}`]);
    tunnel = t;
    const timer = setTimeout(() => {
      if (tunnel === t && !url) {
        starting = false;
        fail("cloudflare_timeout");
      }
    }, CLOUDFLARE_WAIT_MS);
    timer.unref();
    t.onLine((line) => {
      if (tunnel !== t || url) return;
      const found = cloudflaredLine(line);
      if (!found) return;
      url = found;
      error = undefined;
      starting = false;
      attempts = 0;
      clearTimeout(timer);
      deps.log.info({ url }, "webhooks: temporary link up");
    });
    t.onExit((code) => {
      if (tunnel !== t) return;
      tunnel = undefined;
      url = undefined;
      starting = false;
      if (!error) fail("cloudflare_stopped", `exit ${code ?? "signal"}`);
      deps.log.warn({ error }, "webhooks: cloudflared stopped");
      clearTimeout(timer);
      restartLater("cloudflare", undefined);
    });
  }

  /** Starts ngrok and resolves once it says its address (or failed, or took too long). */
  function startNgrok(domain: string | undefined): Promise<void> {
    const start = ngrokStart();
    if (!start) {
      fail("ngrok_missing");
      return Promise.resolve();
    }
    const args = ["http", `127.0.0.1:${deps.port()}`, "--log", "stdout", "--log-format", "json"];
    const t = start(domain ? [...args, "--url", domain] : args);
    tunnel = t;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (tunnel === t && !url) fail("ngrok_timeout");
        resolve();
      }, NGROK_WAIT_MS);
      timer.unref();
      t.onLine((line) => {
        if (tunnel !== t) return;
        const said = ngrokLine(line);
        if (said.url) {
          url = said.url;
          error = undefined;
          attempts = 0;
          // A free account keeps one address across starts: only a new one has to be pasted into the platform.
          const kept = saved();
          fresh = kept.ngrok_last !== url;
          if (fresh) deps.store.settings.write("webhooks", { ...kept, ngrok_last: url });
          deps.log.info({ url }, "webhooks: ngrok address up");
          clearTimeout(timer);
          resolve();
        } else if (said.error && !url) fail("ngrok_failed");
      });
      t.onExit((code) => {
        if (tunnel !== t) return;
        tunnel = undefined;
        url = undefined;
        fresh = false;
        if (!error) fail("ngrok_stopped", `exit ${code ?? "signal"}`);
        deps.log.warn({ error }, "webhooks: ngrok stopped");
        clearTimeout(timer);
        restartLater("ngrok", domain);
        resolve();
      });
    });
  }

  /** Makes the saved choice true on this computer: the address comes up, or `error` says why not. */
  async function apply(): Promise<void> {
    if (closed) return;
    const { mode, url: own, domain } = saved();
    generation++;
    starting = false;
    stopNgrok();
    url = undefined;
    error = undefined;
    fresh = false;
    attempts = 0;
    probe.clear();
    if (mode === "custom") {
      url = own ? publicOrigin(own) : undefined;
      if (!url) fail("failed");
    }
    if (mode === "ngrok") await startNgrok(domain);
    if (mode === "cloudflare") void startCloudflare(generation);
    if (mode === "tailscale") {
      const run = tailscaleRun();
      const dns = await tailscaleDns(run);
      if (closed) return;
      if (!run) fail("tailscale_missing");
      else if (!dns) fail("tailscale_offline");
      else {
        const r = await run(["funnel", "--bg", `--https=${FUNNEL_PORT}`, `http://127.0.0.1:${deps.port()}`]);
        if (r.ok) url = `https://${dns}:${FUNNEL_PORT}`;
        else fail("funnel_failed");
      }
    }
  }

  async function state(): Promise<WebhooksState> {
    const { mode, domain } = saved();
    return {
      mode,
      ...(url ? { url } : {}),
      url_may_change: (mode === "ngrok" && Boolean(url) && fresh) || (mode === "cloudflare" && Boolean(url)),
      ...(starting ? { starting: true } : {}),
      port: deps.port(),
      ...(domain ? { domain } : {}),
      ...(error ? { error: error.code, ...(error.detail ? { error_detail: error.detail } : {}) } : {}),
      ...(await probe.read()),
    };
  }

  return {
    state,
    /** The base the channels' addresses hang from (`<base>/hooks/<channel id>`), while one is up. */
    base: () => url,
    /** The saved choice, applied at start (a failure only shows in the state). */
    start: () =>
      change(() => {
        // A temporary link is never resumed on its own: it would come back at an address nobody was given.
        const kept = saved();
        if (kept.mode === "cloudflare") deps.store.settings.write("webhooks", { ...kept, mode: "off" });
        return apply().catch(() => {
          fail("failed");
        });
      }),
    set(choice: TunnelChoice): Promise<WebhooksState> {
      return change(async () => {
        if (closed) throw new CallError({ code: "unavailable", message: "public tunnel is closed" });
        if (deps.workspace && choice.mode === "tailscale")
          throw new CallError({
            code: "bad_request",
            message: "Choose a public address for this business; Tailscale is managed in My Colonia",
          });
        await saveChoice(deps.store, tailscaleRun, choice);
        await apply();
        return state();
      });
    },
    close() {
      closed = true;
      generation++;
      url = undefined;
      stopNgrok();
    },
  };
}

export type PublicTunnel = ReturnType<typeof createPublicTunnel>;
