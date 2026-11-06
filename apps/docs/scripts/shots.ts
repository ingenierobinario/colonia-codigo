#!/usr/bin/env node
// Retakes the docs' screenshots: a core of its own (temp home and HOME, port 7480, file secrets, a scripted model),
// the demo office from demo-seed.ts, and the panel in both themes, once in English (src/assets/shots/name.webp and
// name-dark.webp) and once in Spanish (name.es.webp and name.es-dark.webp), each with the office's texts in that language.
// Nothing here touches ~/.colonia, the Keychain or a real service. Needs `pnpm build:web` at the repo root first.
//   node --no-warnings scripts/shots.ts [name…]     (no names: every shot; no SHOTS_LANG: English, then Spanish)
//   SHOTS_LANG=es node --no-warnings scripts/shots.ts  (one language only)
//   SHOTS_SERVE=1 node --no-warnings scripts/shots.ts  (only the demo core, to pair the phone app with)
import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, type Page } from "@playwright/test";
import sharp from "sharp";
import { fakeTelegram } from "../../../apps/core/src/channels/fake-telegram.test-support.ts";
import { demoLlm } from "./demo-llm.ts";
import {
  drawerTask,
  type Lang,
  ordersTitle,
  seed,
  telegramText,
  writeDemoWorld,
  writeHomeSkills,
} from "./demo-seed.ts";

const root = path.resolve(import.meta.dirname, "../../..");
const out = path.resolve(import.meta.dirname, "../src/assets/shots");
const port = Number(process.env.SHOTS_PORT ?? 7480);
const core = `http://127.0.0.1:${port}`;
const only = new Set(process.argv.slice(2));
const log = (s: string) => console.log(s);

if (!fs.existsSync(path.join(root, "apps/web/dist/index.html"))) {
  console.error("Build the panel first: pnpm build:web (at the repo root).");
  process.exit(1);
}

// No language given: one run per language, each with its own core and office.
if (!process.env.SHOTS_LANG && !process.env.SHOTS_SERVE) {
  let code = 0;
  for (const l of ["en", "es"]) {
    const r = spawnSync(process.execPath, process.execArgv.concat(process.argv.slice(1)), {
      stdio: "inherit",
      env: { ...process.env, SHOTS_LANG: l },
      // A whole language never takes more than 40 minutes (78 shots of 60 s at worst, most take a few seconds).
      timeout: 40 * 60_000,
    });
    if (r.error) console.error(`${l}: ${r.error.message}`);
    code ||= r.status ?? 1;
  }
  process.exit(code);
}
const lang: Lang = process.env.SHOTS_LANG === "es" ? "es" : "en";
/** The Spanish set carries ".es" before the theme: name.es.webp, name.es-dark.webp. */
const suffix = lang === "es" ? ".es" : "";

// The panel's own strings, read from apps/web/src/i18n (a key missing in Spanish falls back to English, as the panel does).
const i18nDir = path.join(root, "apps/web/src/i18n");
const table = (l: Lang) => {
  const m = new Map<string, string>();
  const mine = (f: string) =>
    f.endsWith(".ts") && !f.includes(".test.") && (l === "en" ? /^en[-.]|-en\.ts$/ : /^es[-.]|-es\.ts$/).test(f);
  for (const f of fs.readdirSync(i18nDir).filter(mine))
    for (const [, k, v] of fs
      .readFileSync(path.join(i18nDir, f), "utf8")
      .matchAll(/^\s*"([\w.-]+)":\s*"((?:[^"\\]|\\.)*)",?\s*$/gm))
      if (!m.has(k)) m.set(k, JSON.parse(`"${v}"`));
  return m;
};
const EN = table("en");
const ES = lang === "es" ? table("es") : EN;
const tr = (key: string, vars: Record<string, string> = {}) => {
  const s = ES.get(key) ?? EN.get(key);
  if (!s) throw new Error(`no string for ${key}`);
  return s.replace(/\{(\w+)\}/g, (_, v) => vars[v] ?? `{${v}}`);
};
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The long form of the temp folder: on Windows it can come as an 8.3 short name (C:UsersALEXAN~1), and watching a
// folder under one aborts the core inside libuv (fs-event.c assertion).
const dir = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), "colonia-shots-"));
// A HOME of its own: no browser profiles, Claude or Codex sessions, v1 or Tailscale of the owner's show up.
const fakeHome = path.join(dir, "home");
// The example extension is copied into that HOME, so the screen shows "~/work/…" and not this checkout's path.
const extension = path.join(fakeHome, "work", "extensions", "daily-brief");
fs.cpSync(path.join(root, "examples/extensions/daily-brief"), extension, { recursive: true });
const world = { ...writeDemoWorld(fakeHome, lang), extension };
writeHomeSkills(path.join(dir, "colonia"), lang);
// A tailscale that is not logged in, ahead of the real one in PATH (the core would show this machine's tailnet name).
const bin = path.join(dir, "bin");
fs.mkdirSync(bin, { recursive: true });
fs.writeFileSync(path.join(bin, "tailscale"), "#!/bin/sh\necho 'Logged out.' >&2\nexit 1\n", { mode: 0o755 });
fs.writeFileSync(path.join(bin, "tailscale.cmd"), "@echo Logged out. 1>&2\r\n@exit /b 1\r\n");
// Windows needs its system variables to run anything (and git from its own PATH); elsewhere the bare minimum.
const win = process.platform === "win32";
const winEnv = win
  ? Object.fromEntries(
      ["SystemRoot", "WINDIR", "TEMP", "TMP", "PATHEXT", "ComSpec"].flatMap((k) =>
        process.env[k] ? [[k, process.env[k] as string]] : [],
      ),
    )
  : {};
const pathDirs = win
  ? // Only Windows itself, git and node: any other tool of this machine (Claude, Codex, Kimi…) would show up as a session.
    [
      bin,
      path.join(process.env.SystemRoot ?? "C:\\Windows", "System32"),
      process.env.SystemRoot ?? "C:\\Windows",
      path.dirname(execFileSync("where", ["git"], { encoding: "utf8" }).split(/\r?\n/)[0] ?? ""),
      path.dirname(process.execPath),
    ]
  : [bin, "/usr/bin", "/bin"];
const models = ["llama-3.3-70b", "qwen-2.5-coder-32b"];
const llm = await demoLlm(models, lang);
const tgToken = "123456789:AAShotsFakeTokenForTheEmulatedBot";
const tg = await fakeTelegram(tgToken);

const child = spawn(process.execPath, ["--no-warnings", path.join(root, "apps/core/src/main.ts")], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...winEnv,
    PATH: pathDirs.join(path.delimiter),
    HOME: fakeHome,
    ...(win ? { USERPROFILE: fakeHome } : {}),
    COLONIA_PUBLIC_URL: "https://colonia.example.com",
    COLONIA_HOME: path.join(dir, "colonia"),
    COLONIA_PORT: String(port),
    COLONIA_SECRETS: "file",
    COLONIA_UPDATES: "off",
    COLONIA_RELEASES: "off",
    COLONIA_AGENT_NAME: "Nova",
    COLONIA_V1_HOME: path.join(dir, "no-v1"),
    COLONIA_V1_URL: "http://127.0.0.1:9",
    COLONIA_IMESSAGE: "off",
    COLONIA_HEADLESS: "off",
    CLAUDE_CONFIG_DIR: world.claude,
    CODEX_HOME: world.codex,
    COLONIA_LLM_BASE_URL: llm.url,
    COLONIA_LLM_KEY: "demo",
    COLONIA_LLM_MODELS: models.join(","),
    COLONIA_TELEGRAM_API: tg.url,
  },
});
const coreLog = fs.createWriteStream(path.join(dir, "core.log"));
child.stdout.pipe(coreLog);
child.stderr.pipe(coreLog);

let seq = 0;
async function rpc<T = Record<string, unknown>>(method: string, params: unknown = {}): Promise<T> {
  const res = await fetch(`${core}/rpc/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": `shots-${Date.now()}-${seq++}` },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(60_000),
  });
  const body = (await res.json()) as { ok: boolean; result?: T; error?: { message: string } };
  if (!body.ok) throw new Error(`${method}: ${body.error?.message}`);
  return body.result as T;
}

async function stop(code = 0) {
  child.kill("SIGTERM");
  await Promise.all([llm.close(), tg.close()]);
  // On Windows the core holds its files for a moment after it is killed: retry, and never fail the run over it.
  if (!process.env.SHOTS_KEEP)
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    } catch (e) {
      log(`could not remove ${dir}: ${(e as Error).message.split("\n")[0]}`);
    }
  else log(`kept ${dir}`);
  process.exit(code);
}

for (let i = 0; i < 600; i++) {
  try {
    if ((await fetch(`${core}/health`)).ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 100));
}
await rpc("models.set_config", { default: { model: `custom/${models[0]}`, router: false } });
log("seeding the demo office…");
const ids = await seed(rpc, world, log, lang);
try {
  await rpc("channels.set", { id: "telegram", channel: { type: "telegram", agent_id: ids.home }, token: tgToken });
  tg.message({ id: 4242, name: "Carla Ruiz" }, telegramText(lang));
} catch (e) {
  log(`  ✗ telegram: ${(e as Error).message}`);
}
await new Promise((r) => setTimeout(r, 1500));
// SHOTS_SERVE=1 keeps the demo office running for a device to pair with (the phone app's own screenshots).
if (process.env.SHOTS_SERVE) {
  const { code } = await rpc<{ code: string }>("devices.pair_start");
  log(`demo core on ${core}; pair with colonia://pair?c=${code}&u=${encodeURIComponent(core)}  (Ctrl+C stops it)`);
  process.on("SIGINT", () => void stop());
  process.on("SIGTERM", () => void stop());
  await new Promise(() => {});
}

type Shot = { name: string; go: (p: Page) => Promise<void>; phone?: boolean; clip?: "dialog" };
const at = (hash: string) => async (p: Page) => {
  await p.goto(`${core}/#${hash}`);
  await p.getByRole("button", { name: tr("nav.inbox") }).first().waitFor();
};
const settings = (key: string) => async (p: Page) => {
  await at("thread=home")(p);
  await p.keyboard.press("ControlOrMeta+Comma");
  const dialog = p.getByRole("dialog", { name: tr("config.title") });
  // The shortcut may not reach the panel; Settings also opens from the account menu (bottom left).
  if (!(await dialog.waitFor({ timeout: 5_000 }).then(() => true, () => false))) {
    await p
      .getByRole("button", { name: new RegExp(`^${esc(tr("account.menuOf", { name: "" }).trim())}`) })
      .first()
      .click();
    await p.getByText(tr("config.title"), { exact: true }).first().click();
  }
  await dialog.getByRole("navigation").getByRole("button", { name: tr(key), exact: true }).first().click();
};
const project = (tab: string) => at(`project=${ids.shop}&tab=${tab}`);
const resources = (key: string) => async (p: Page) => {
  await at("view=resources")(p);
  await p
    .getByRole("radio", { name: new RegExp(`^${esc(tr(key))}`) })
    .first()
    .click();
};
const firstRun = async (p: Page) => {
  await at("thread=home")(p);
  await p
    .getByRole("button", { name: new RegExp(`^${esc(tr("account.menuOf", { name: "" }).trim())}`) })
    .first()
    .click();
  await p.getByText(tr("setup.menu"), { exact: true }).first().click();
};

const SHOTS: Shot[] = [
  { name: "home-hero", go: at("thread=home") },
  { name: "inbox", go: at(`thread=${ids.luciaChat}`) },
  { name: "chat", go: project(`chats&thread=${ids.luciaChat}`) },
  { name: "chat-panel", go: at(`thread=${ids.luciaChat}&panel=files`) },
  { name: "chat-terminal", go: at(`thread=${ids.luciaChat}&panel=terminal`) },
  {
    name: "slash",
    go: async (p) => {
      await at("thread=home")(p);
      await p.getByRole("textbox").last().click();
      await p.keyboard.type("/");
    },
  },
  {
    name: "command-palette",
    go: async (p) => {
      await at("thread=home")(p);
      await p.keyboard.press("ControlOrMeta+K");
      await p.keyboard.type(lang === "es" ? "lanza" : "launch");
    },
  },
  { name: "project", go: project("overview") },
  { name: "team", go: project("team") },
  {
    name: "org",
    go: async (p) => {
      await project("team")(p);
      await p
        .getByRole("tab", { name: new RegExp(`^${esc(tr("project.tab.org"))}`) })
        .first()
        .click();
    },
  },
  {
    name: "agent-panel",
    go: async (p) => {
      await at(`thread=${ids.luciaChat}`)(p);
      await p
        .getByRole("button", { name: new RegExp(`^${esc(tr("agent.openPanel", { name: "Lucía" }))}`) })
        .first()
        .click();
    },
  },
  { name: "tasks", go: at("view=tasks") },
  {
    name: "task-drawer",
    go: async (p) => {
      await at("view=tasks")(p);
      await p.getByText(drawerTask(lang)).first().click();
    },
  },
  {
    name: "commitments",
    go: async (p) => {
      await at("view=tasks")(p);
      await p
        .getByRole("radio", { name: new RegExp(`^${esc(tr("tasks.kind.commitments"))}`) })
        .first()
        .click();
    },
  },
  { name: "routines", go: project("routines") },
  { name: "memory", go: project("memory") },
  { name: "files", go: project("files") },
  { name: "resources-skills", go: resources("res.tab.skills") },
  { name: "resources-mcp", go: resources("res.tab.mcp") },
  { name: "resources-integrations", go: resources("res.tab.integrations") },
  { name: "resources-variables", go: resources("res.tab.variables") },
  { name: "resources-extensions", go: resources("res.tab.extensions") },
  { name: "settings-engines", go: settings("config.engines") },
  { name: "settings-router", go: settings("config.router") },
  { name: "settings-memory", go: settings("config.memory") },
  { name: "settings-profile", go: settings("config.superagent") },
  { name: "settings-interruptions", go: settings("config.interruptions") },
  { name: "settings-channels", go: settings("config.channels") },
  { name: "settings-devices", go: settings("config.devices") },
  { name: "settings-desktop", go: settings("config.desktop") },
  { name: "settings-appearance", go: settings("config.appearance") },
  { name: "settings-agents", go: settings("config.agents") },
  { name: "settings-tokens", go: settings("clients.title") },
  { name: "channel", go: at("channel=telegram") },
  { name: "external-sessions", go: at("engine=claude") },
  {
    name: "app-widget",
    go: async (p) => {
      await at("thread=home")(p);
      await p.getByRole("complementary").getByRole("button", { name: ordersTitle(lang) }).first().click();
      // The widget draws its figures on load and marks body[data-state] when it's done.
      await p.frameLocator("iframe").first().locator("body[data-state]").waitFor({ timeout: 20_000 });
    },
  },
  {
    name: "phone-pair",
    go: async (p) => {
      await at("thread=home")(p);
      // "Open on your phone" lives in the account menu (bottom left), not in the top bar.
      await p
        .getByRole("button", { name: new RegExp(`^${esc(tr("account.menuOf", { name: "" }).trim())}`) })
        .first()
        .click();
      await p.getByRole("menuitem", { name: tr("phone.open"), exact: true }).first().click();
    },
  },
  { name: "wizard-welcome", go: firstRun },
  {
    name: "wizard-agent",
    go: async (p) => {
      await firstRun(p);
      // With no v1 to import, the welcome step has a single way in: "Start".
      await p.getByRole("button", { name: tr("setup.welcome.start"), exact: true }).first().click();
    },
  },
  { name: "phone-home", go: at("thread=home"), phone: true },
];

const browser = await chromium.launch({ executablePath: process.env.SHOTS_CHROMIUM || undefined });
const prefs = async (p: Page, mode: "light" | "dark") =>
  p.addInitScript(([mode, language]) => {
    try {
      localStorage.setItem("colonia.mode", mode);
      localStorage.setItem("colonia.prefs", JSON.stringify({ language, look: "minimal", displayName: "Marta" }));
      localStorage.setItem("colonia.corner", JSON.stringify({ discord: true, star: true }));
    } catch {}
  }, [mode, lang] as const);
// The demo lives in a temp folder; it shows the way a reader's own one would, under ~ (kept so across re-renders).
const tidyPaths = (p: Page) =>
  p.addInitScript(
    (homes) => {
      const tidy = (t: string) => homes.reduce((s, h) => s.split(h).join("~"), t);
      const fix = (root: Node) => {
        const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let n = walk.nextNode(); n; n = walk.nextNode())
          if (n.nodeValue && homes.some((h) => n.nodeValue?.includes(h))) n.nodeValue = tidy(n.nodeValue);
      };
      new MutationObserver((records) => {
        for (const r of records) fix(r.type === "characterData" ? (r.target.parentNode ?? r.target) : r.target);
      }).observe(document, { subtree: true, childList: true, characterData: true });
    },
    [...new Set([fs.realpathSync(fakeHome), fakeHome].flatMap((h) => [h, h.replaceAll("\\", "/")]))],
  );
fs.mkdirSync(out, { recursive: true });
const skipped: string[] = [];
// No wait longer than 60 s: 20 s per action, 60 s per shot; a shot that fails twice is skipped and listed.
const within = <T>(ms: number, p: Promise<T>) =>
  Promise.race([p, new Promise<never>((_, no) => setTimeout(() => no(new Error(`over ${ms / 1000} s`)), ms))]);
async function take(shot: Shot, theme: "light" | "dark", file: string) {
  const ctx = await browser.newContext({
    viewport: shot.phone ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: theme,
    locale: lang === "es" ? "es-ES" : "en-US",
    timezoneId: "Europe/Madrid",
    isMobile: Boolean(shot.phone),
    hasTouch: Boolean(shot.phone),
  });
  ctx.setDefaultTimeout(20_000);
  ctx.setDefaultNavigationTimeout(20_000);
  try {
    const page = await ctx.newPage();
    await prefs(page, theme);
    await tidyPaths(page);
    await within(
      60_000,
      (async () => {
        await shot.go(page);
        await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
        await page.waitForTimeout(900);
        await page.mouse.move(0, 0);
        const png = await page.screenshot({ animations: "disabled", caret: "hide" });
        await sharp(png)
          .webp({ quality: 82 })
          .toFile(path.join(out, `${file}.webp`));
      })(),
    );
  } finally {
    await within(10_000, ctx.close()).catch(() => {});
  }
}
// Every shot in both themes: the docs show the one that matches the page (name.webp light, name-dark.webp dark;
// the Spanish set as name.es.webp and name.es-dark.webp).
for (const theme of ["light", "dark"] as const)
  for (const shot of SHOTS) {
    if (only.size && !only.has(shot.name)) continue;
    const file = `${shot.name}${suffix}${theme === "dark" ? "-dark" : ""}`;
    for (let attempt = 1; ; attempt++) {
      try {
        await take(shot, theme, file);
        log(`✓ ${file}`);
        break;
      } catch (e) {
        log(`✗ ${file} (attempt ${attempt}): ${(e as Error).message.split("\n")[0]}`);
        if (attempt >= 2) {
          log((e as Error).message.split("\n").slice(1, 12).join("\n"));
          skipped.push(file);
          break;
        }
      }
    }
  }
await within(10_000, browser.close()).catch(() => {});
log(skipped.length ? `skipped: ${skipped.join(" ")}` : "all shots taken");
await stop(skipped.length ? 1 : 0);
