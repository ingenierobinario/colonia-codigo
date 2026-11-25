import { createHash } from "node:crypto";
import path from "node:path";

/** WSL registers distributions per OS user, independently of LIMA_HOME. */
export function workspaceComputer(home: string) {
  return {
    managed: true,
    limaHome: path.join(home, "computer", "lima"),
    instance: `business-${createHash("sha256").update(path.resolve(home)).digest("hex").slice(0, 24)}`,
  };
}

// Workers keep program discovery and OS services, but never inherit an account or a provider credential.
const SYSTEM = new Set([
  "path",
  "pathext",
  "systemroot",
  "windir",
  "comspec",
  "programfiles",
  "programfiles(x86)",
  "programw6432",
  "lang",
  "lc_all",
  "tz",
  "display",
  "wayland_display",
  "dbus_session_bus_address",
  "xdg_runtime_dir",
  "term",
  "colorterm",
]);

export function workspaceEnvironment(
  source: NodeJS.ProcessEnv,
  home: string,
  token: string,
  publicUrl: string,
  electron: boolean,
): NodeJS.ProcessEnv {
  const env = Object.fromEntries(Object.entries(source).filter(([key]) => SYSTEM.has(key.toLowerCase())));
  const account = path.join(home, "account");
  return {
    ...env,
    HOME: account,
    USERPROFILE: account,
    APPDATA: path.join(account, "AppData", "Roaming"),
    LOCALAPPDATA: path.join(account, "AppData", "Local"),
    XDG_CONFIG_HOME: path.join(account, ".config"),
    XDG_DATA_HOME: path.join(account, ".local", "share"),
    XDG_STATE_HOME: path.join(account, ".local", "state"),
    XDG_CACHE_HOME: path.join(account, ".cache"),
    TMPDIR: path.join(home, "tmp"),
    TEMP: path.join(home, "tmp"),
    TMP: path.join(home, "tmp"),
    CLAUDE_CONFIG_DIR: path.join(account, ".claude"),
    CLAUDE_SECURESTORAGE_CONFIG_DIR: path.join(account, ".claude"),
    ANTHROPIC_CONFIG_DIR: path.join(account, ".config", "anthropic"),
    CODEX_HOME: path.join(account, ".codex"),
    COLONIA_HOME: home,
    COLONIA_PORT: "0",
    COLONIA_HOOKS_PORT: "0",
    COLONIA_HOST: "127.0.0.1",
    COLONIA_TOKEN: token,
    COLONIA_PUBLIC_URL: publicUrl,
    COLONIA_RUNTIME_SKILLS: "off",
    COLONIA_NEWS: "off",
    COLONIA_RELEASES: "off",
    COLONIA_IMESSAGE: "off",
    ...(electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
  };
}
