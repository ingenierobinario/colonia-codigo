// One config loader, injected everywhere (no import-time singletons, no process.env reads elsewhere).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CORE_ENV_FILE, coreEnvDefaults, parseCoreEnv, RELEASE_FEED } from "@colonia/protocol";
import { type SecretsBackend, systemBackend } from "./secrets-stores.ts";

/**
 * Where v2 keeps its state: inside the Colonia folder, apart from v1's files (which stay as they are until the owner
 * moves on). See DECISIONS.md#d-024
 */
export const defaultHome = () => path.join(os.homedir(), ".colonia", "v2");
/** Where v2 lived before it moved into ~/.colonia (moved once, at start: see home.ts). */
export const legacyHome = () => path.join(os.homedir(), ".colonia2");

export type ProviderTransport = "openai-chat" | "anthropic-messages" | "chatgpt-responses";

/** A model API. `key` is a reference (secret://name, env:VAR, or oauth:<login> for a sign-in), never the value. */
export type ProviderConfig = {
  id: string;
  transport: ProviderTransport;
  base_url: string;
  key: string;
  /**
   * Fixed list for gateways that cannot list their models (local servers, COLONIA_LLM_MODELS); empty = ask the provider.
   * Which model runs is never decided here: see models/choice.ts.
   */
  models: string[];
  /** The name people read; built-in providers carry their brand's. */
  label?: string | undefined;
};

export type CoreConfig = {
  host: string;
  port: number;
  /**
   * The webhook listener's port, on loopback only (transport/hooks.ts): what a public address publishes. The core's
   * port + 8 by default (COLONIA_HOOKS_PORT); a free one when the core's is 0 (tests).
   */
  hooksPort: number;
  /** State home. v2 lives beside v1 (~/.colonia) until the cut-over. */
  home: string;
  /** Required whenever host is not loopback. */
  token: string | undefined;
  /** Extra origins allowed to call the core (comma separated in COLONIA_ALLOWED_ORIGINS). */
  allowedOrigins: string[];
  /** Built panel to serve; undefined = the workspace build when present. */
  webDist: string | undefined;
  /** Local Colonia v1 daemon, only for the explicit read-only import. */
  v1: { url: string; home: string };
  /** Where Claude Code and Codex keep the owner's own sessions (read-only, to go on with one in Colonia). */
  native: { claude: string; codex: string };
  /**
   * Other agent apps' folders (Claude Code, Codex, Cursor, ~/.agents): their skills are read from there, and Colonia's skills
   * for them written there. `auto`: those kept up to date at every start; only a core on the default home does it
   * (COLONIA_RUNTIME_SKILLS=on|off overrides).
   */
  runtimeSkills: { homes: { home: string; claude: string; codex: string }; auto: boolean };
  /** Telegram's Bot API; a test environment points it at an emulated one (COLONIA_TELEGRAM_API). */
  telegramApi: string | undefined;
  /**
   * Loopback `host:port` servers a test lets Flow HTTP steps reach (COLONIA_FLOW_HTTP_ALLOW, comma-separated); anything
   * else on this computer or a private network stays refused. Empty in a real core.
   */
  flowHttpAllow: string[];
  /** Discord's REST API and Gateway; a test environment points them at an emulated one (COLONIA_DISCORD_API, _GATEWAY). */
  discord: { api: string; gateway: string; cdn: string } | undefined;
  /**
   * The address devices reach this core on from outside (a VPS or a Tailscale name, e.g. https://colonia.example.ts.net):
   * it goes first in a pairing QR.
   */
  publicUrl: string | undefined;
  /** Expo's push service; a test environment points it at a fake one (COLONIA_EXPO_PUSH_URL). */
  expoPushUrl: string;
  /** Slack's Web API; a test environment points it at an emulated one (COLONIA_SLACK_API). */
  slackApi: string | undefined;
  /** Google's sign-in and REST APIs under one address; a test environment points it at a fake one (COLONIA_GOOGLE_API). */
  googleApi: string | undefined;
  /** A Google OAuth client (`client_id:client_secret`) in place of the one this build ships (COLONIA_GOOGLE_CLIENT). */
  googleClient: string | undefined;
  /** iMessage tools on a Mac; COLONIA_IMESSAGE=off hides them (a sandbox must never reach the owner's Messages). */
  imessage: boolean;
  /**
   * The core's own headless Chrome when no desktop app lends a browser: `false` turns it off (COLONIA_HEADLESS=off; a
   * test core never starts one), a path picks the browser (COLONIA_CHROME), true finds one.
   */
  headless: boolean | string;
  /** Ollama on this machine, for memory's embedding models (COLONIA_OLLAMA_URL; a test points it elsewhere). */
  ollamaUrl: string;
  providers: ProviderConfig[];
  secrets: SecretsBackend;
  /** Silence before the first byte of a model answer. */
  llmTimeoutMs: number;
  /** The super-agent's name on a fresh install (COLONIA_AGENT_NAME); none = one picked at random. */
  agentName: string | undefined;
  /** Look for a newer Colonia now and then (COLONIA_UPDATES): on; app = only say so, the desktop app installs it; off. */
  updates: "on" | "app" | "off";
  /** The super-agent tells what an update brought, on the first start of a newer release (COLONIA_WHATS_NEW=off: never). */
  whatsNew: boolean;
  /**
   * The super-agent tells release news that applies to the owner, in its words on their channel (COLONIA_NEWS=off: never;
   * test cores start off, COLONIA_NEWS=on turns it on there).
   */
  news: boolean;
  /** A supervisor starts the core again when it exits to update (`pnpm app` sets COLONIA_SUPERVISED=1). */
  supervised: boolean;
  /** COLONIA_APP: where install.sh/ps1 put this daemon (its bundles and `current`); unset for a checkout or the app. */
  app: string | undefined;
  /** owner/repo whose Releases announce newer bundles (COLONIA_RELEASES; "off" stops it). */
  releases: string | undefined;
  /**
   * Where telemetry goes (COLONIA_TELEMETRY: a sink, or "off"); undefined sends nothing. DO_NOT_TRACK=1 and CI turn it off
   * too. See telemetry-sink.ts.
   */
  telemetry: string | undefined;
};

/** The key reference of the ChatGPT plan's sign-in. */
export const OAUTH_CHATGPT = "oauth:chatgpt";

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);

const DEFAULT_PROVIDERS: ProviderConfig[] = [
  {
    id: "gemini",
    label: "Gemini",
    transport: "openai-chat",
    base_url: "https://generativelanguage.googleapis.com/v1beta/openai",
    key: "secret://gemini",
    models: [],
  },
  {
    id: "anthropic",
    label: "Anthropic",
    transport: "anthropic-messages",
    base_url: "https://api.anthropic.com",
    key: "secret://anthropic",
    models: [],
  },
  {
    id: "openai",
    label: "OpenAI",
    transport: "openai-chat",
    base_url: "https://api.openai.com/v1",
    key: "secret://openai",
    models: [],
  },
  // The owner's ChatGPT plan, signed in from Colonia the way Codex signs in (see providers/chatgpt-login.ts).
  {
    id: "chatgpt",
    label: "Codex",
    transport: "chatgpt-responses",
    base_url: "https://chatgpt.com/backend-api/codex",
    key: OAUTH_CHATGPT,
    models: [],
  },
];

const list = (v: string | undefined) =>
  (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

/** `<home>/core.env` (written by `colonia expose`) as defaults under the process environment, which always wins. */
export function withCoreEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const home = env.COLONIA_HOME ?? defaultHome();
  let text: string;
  try {
    text = fs.readFileSync(path.join(home, CORE_ENV_FILE), "utf8");
  } catch {
    return env;
  }
  return { ...coreEnvDefaults(parseCoreEnv(text)), ...env };
}

/** `readCoreEnv: false` keeps the result independent of any file on disk (tests, embedders). */
export function loadConfig(processEnv: NodeJS.ProcessEnv = process.env, readCoreEnv = true): CoreConfig {
  const env = readCoreEnv ? withCoreEnv(processEnv) : processEnv;
  // COLONIA_LLM_* puts one custom OpenAI-compatible provider first (local models, tests, other gateways).
  const custom: ProviderConfig[] = env.COLONIA_LLM_BASE_URL
    ? [
        {
          id: "custom",
          label: "Custom",
          transport: "openai-chat",
          base_url: env.COLONIA_LLM_BASE_URL,
          key: env.COLONIA_LLM_KEY_REF ?? "env:COLONIA_LLM_KEY",
          models: list(env.COLONIA_LLM_MODELS),
        },
      ]
    : [];
  const port = Number(env.COLONIA_PORT ?? 7440);
  const config: CoreConfig = {
    host: env.COLONIA_HOST ?? "127.0.0.1",
    port,
    hooksPort: Number(env.COLONIA_HOOKS_PORT ?? (port === 0 ? 0 : port + 8)),
    home: env.COLONIA_HOME ?? defaultHome(),
    token: env.COLONIA_TOKEN || undefined,
    allowedOrigins: list(env.COLONIA_ALLOWED_ORIGINS),
    webDist: env.COLONIA_WEB_DIST || undefined,
    v1: { url: env.COLONIA_V1_URL ?? "http://127.0.0.1:7430", home: env.COLONIA_V1_HOME ?? path.join(os.homedir(), ".colonia") },
    telegramApi: env.COLONIA_TELEGRAM_API || undefined,
    flowHttpAllow: list(env.COLONIA_FLOW_HTTP_ALLOW).filter((a) => /^127\.0\.0\.1:\d{1,5}$/.test(a)),
    discord:
      env.COLONIA_DISCORD_API && env.COLONIA_DISCORD_GATEWAY
        ? { api: env.COLONIA_DISCORD_API, gateway: env.COLONIA_DISCORD_GATEWAY, cdn: env.COLONIA_DISCORD_API }
        : undefined,
    slackApi: env.COLONIA_SLACK_API || undefined,
    googleApi: env.COLONIA_GOOGLE_API || undefined,
    googleClient: env.COLONIA_GOOGLE_CLIENT || undefined,
    publicUrl: env.COLONIA_PUBLIC_URL?.replace(/\/$/, "") || undefined,
    expoPushUrl: env.COLONIA_EXPO_PUSH_URL || "https://exp.host/--/api/v2/push/send",
    imessage: env.COLONIA_IMESSAGE !== "off",
    headless: env.COLONIA_HEADLESS === "off" ? false : env.COLONIA_CHROME || true,
    native: {
      claude: env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude"),
      codex: env.CODEX_HOME ?? path.join(os.homedir(), ".codex"),
    },
    runtimeSkills: {
      homes: {
        // Where ~/.cursor and ~/.agents are looked for; a sandbox points it away from the owner's (COLONIA_APPS_HOME).
        home: env.COLONIA_APPS_HOME || os.homedir(),
        claude: env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude"),
        codex: env.CODEX_HOME ?? path.join(os.homedir(), ".codex"),
      },
      // A scratch core (its own COLONIA_HOME) must not rewrite the owner's apps with its checkout's text.
      auto: env.COLONIA_RUNTIME_SKILLS === "on" || (!env.COLONIA_HOME && env.COLONIA_RUNTIME_SKILLS !== "off"),
    },
    ollamaUrl: env.COLONIA_OLLAMA_URL || "http://127.0.0.1:11434",
    providers: [...custom, ...DEFAULT_PROVIDERS],
    secrets: env.COLONIA_SECRETS === "file" ? "file" : systemBackend(),
    llmTimeoutMs: Number(env.COLONIA_LLM_TIMEOUT_MS ?? 45_000),
    agentName: env.COLONIA_AGENT_NAME?.trim() || undefined,
    updates: env.COLONIA_UPDATES === "off" ? "off" : env.COLONIA_UPDATES === "app" ? "app" : "on",
    whatsNew: env.COLONIA_WHATS_NEW !== "off",
    news: env.COLONIA_NEWS !== "off",
    supervised: env.COLONIA_SUPERVISED === "1",
    app: env.COLONIA_APP || undefined,
    releases: env.COLONIA_RELEASES === "off" ? undefined : env.COLONIA_RELEASES || RELEASE_FEED,
    telemetry: telemetryOff(env) ? undefined : env.COLONIA_TELEMETRY || undefined,
  };
  assertSafeBind(config);
  return config;
}

/** The owner, the shell or a CI said no telemetry (https://consoledonottrack.com). */
function telemetryOff(env: NodeJS.ProcessEnv): boolean {
  const yes = (v: string | undefined) => Boolean(v) && v !== "0" && v !== "false";
  return env.COLONIA_TELEMETRY === "off" || yes(env.DO_NOT_TRACK) || yes(env.CI);
}

export function assertSafeBind(config: Pick<CoreConfig, "host" | "token">): void {
  if (!LOOPBACK.has(config.host) && !config.token) {
    throw new Error(`refusing to listen on ${config.host} without COLONIA_TOKEN`);
  }
}

/** Config for tests and embedders: defaults plus overrides, no environment. */
export function testConfig(over: Partial<CoreConfig> & { home: string }): CoreConfig {
  // Never the machine's real v1: a test that wants one passes it.
  const v1 = { url: "http://127.0.0.1:9", home: path.join(over.home, "v1") };
  const native = { claude: path.join(over.home, "claude-home"), codex: path.join(over.home, "codex-home") };
  return {
    ...loadConfig({}, false),
    port: 0,
    hooksPort: 0,
    secrets: "file",
    v1,
    native,
    runtimeSkills: { homes: { home: over.home, ...native }, auto: false },
    updates: "off",
    whatsNew: false,
    news: false,
    app: undefined,
    releases: undefined,
    telemetry: undefined,
    headless: false,
    agentName: "Roby",
    ...over,
  };
}
