// IMPORTAR-CONECTORES-1 · The connectors (MCP servers) the owner already set up in their other AIs — Claude Code,
// Codex, Claude Desktop and Cursor — brought to Colonia as the owner's own servers in one click. Read-only on those
// files. The same server in several AIs is one entry; a credential written in a file goes to Colonia's variables and
// the server names it as secret://, never in clear; a value that only points at the owner's shell (${VAR}) is asked.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { InternalCall } from "../rpc/internal.ts";
import { serverName } from "./apply-extras.ts";
import { type FoundMcp, type FoundServer, mcpsOf, readJson, SECRET_KEY, tomlServers } from "./native-extras.ts";

export type McpSource = "claude-code" | "codex" | "claude-desktop" | "cursor";
/** Where to look: the owner's home folder, Claude Code's and Codex's folders, and the system's app-data folder. */
export type GlobalHomes = {
  home: string;
  claude?: string | undefined;
  codex?: string | undefined;
  appData?: string;
  platform?: NodeJS.Platform;
};

export type GlobalMcp = {
  /** Stable for the same definition: what the panel sends back to import it. */
  key: string;
  name: string;
  server: FoundServer;
  sources: McpSource[];
  /** A command run on this computer: it works here, not on another of the owner's computers. */
  local: boolean;
  /** Credential keys whose value is written in the file: they go to Colonia's variables. */
  stored: string[];
  /** Credential keys whose value is not in the file (empty, or ${VAR} from the shell): the owner gives them. */
  needs: string[];
};

/** The folder where desktop apps keep their settings (Claude Desktop's config lives in `Claude/` there). */
export function appDataOf(h: GlobalHomes): string {
  if (h.appData) return h.appData;
  const platform = h.platform ?? process.platform;
  if (platform === "win32") return path.join(h.home, "AppData", "Roaming");
  if (platform === "darwin") return path.join(h.home, "Library", "Application Support");
  return path.join(h.home, ".config");
}

const jsonServers = (file: string) => {
  const v = readJson(file);
  const servers = v && typeof v === "object" ? (v as { mcpServers?: unknown }).mcpServers : undefined;
  return servers && typeof servers === "object" && !Array.isArray(servers) ? (servers as Record<string, unknown>) : {};
};

function readSource(source: McpSource, h: GlobalHomes): FoundMcp[] {
  const claude = h.claude ?? path.join(h.home, ".claude");
  const codex = h.codex ?? path.join(h.home, ".codex");
  switch (source) {
    case "claude-code": {
      // Claude Code keeps its user-wide servers in ~/.claude.json (or inside its folder with CLAUDE_CONFIG_DIR).
      const files = [path.join(claude, ".claude.json"), path.join(path.dirname(claude), ".claude.json")];
      const file = files.find((f) => fs.existsSync(f));
      return file ? mcpsOf(jsonServers(file)) : [];
    }
    case "codex": {
      let text = "";
      try {
        text = fs.readFileSync(path.join(codex, "config.toml"), "utf8");
      } catch {}
      return mcpsOf(tomlServers(text));
    }
    case "claude-desktop":
      return mcpsOf(jsonServers(path.join(appDataOf(h), "Claude", "claude_desktop_config.json")));
    case "cursor":
      return mcpsOf(jsonServers(path.join(h.home, ".cursor", "mcp.json")));
  }
}

const SOURCES: readonly McpSource[] = ["claude-code", "codex", "claude-desktop", "cursor"];

/** The same server, whatever name each AI gave it: its address, or its command and arguments. */
function signature(s: FoundServer): string {
  if (s.url) return `url:${s.url.replace(/\/+$/, "").toLowerCase()}`;
  const command = (s.command ?? "").replace(/\.(cmd|exe|bat)$/i, "").toLowerCase();
  return `cmd:${JSON.stringify([path.basename(command), ...(s.args ?? [])])}`;
}

const missing = (v: string | undefined) => !v?.trim() || v.includes("${");

/** Every connector found in the owner's other AIs, one per server, saying in which AIs it is. */
export function findGlobalMcps(h: GlobalHomes): GlobalMcp[] {
  const out = new Map<string, GlobalMcp>();
  for (const source of SOURCES) {
    for (const m of readSource(source, h)) {
      const sig = signature(m.server);
      const values = { ...m.server.env, ...m.server.headers };
      // A credential left empty in the file is one the owner still has to give.
      const empty = Object.keys(values).filter((k) => SECRET_KEY.test(k) && !values[k]?.trim());
      const secrets = [...new Set([...m.secrets, ...empty])];
      const stored = secrets.filter((k) => !missing(values[k]));
      const needs = secrets.filter((k) => missing(values[k]));
      const seen = out.get(sig);
      if (seen) {
        if (!seen.sources.includes(source)) seen.sources.push(source);
        // The same server written better in another AI (its key there, not here): that definition is the one brought.
        if (stored.length > seen.stored.length) Object.assign(seen, { server: m.server, stored, needs });
        continue;
      }
      out.set(sig, {
        key: createHash("sha256").update(sig).digest("hex").slice(0, 16),
        name: m.name,
        server: m.server,
        sources: [source],
        local: !m.server.url,
        stored,
        needs,
      });
    }
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** A variable's name for one credential of one server: `mcp-<server>-<KEY>`. */
export const variableName = (server: string, key: string) =>
  `mcp-${server}-${key}`.replace(/[^a-zA-Z0-9_.-]+/g, "_").slice(0, 64);

/** The server with each credential swapped for its variable (secret://), ready for the owner's own servers. */
export function withVariables(name: string, s: FoundServer, keys: string[]): FoundServer {
  const swap = (rec: Record<string, string> | undefined) =>
    rec &&
    Object.fromEntries(
      Object.entries(rec).map(([k, v]) => [k, keys.includes(k) ? `secret://${variableName(name, k)}` : v]),
    );
  const env = swap(s.env);
  const headers = swap(s.headers);
  return { ...s, ...(env ? { env } : {}), ...(headers ? { headers } : {}) };
}

export type ImportResult = {
  added: string[];
  existing: string[];
  need_values: Array<{ name: string; keys: string[] }>;
  failed: Array<{ name: string; reason: string }>;
};

const OWNER = { actor: "human" } as const;

/**
 * Brings the chosen connectors (`keys`) as the owner's own servers, through mcp.set and secrets.set (the owner's
 * checks). `values`: what the owner typed for the credentials a file did not hold, by connector key.
 */
export async function importGlobalMcps(
  call: InternalCall,
  found: GlobalMcp[],
  keys: string[],
  values: Record<string, Record<string, string>> = {},
): Promise<ImportResult> {
  const out: ImportResult = { added: [], existing: [], need_values: [], failed: [] };
  const servers = (await call("mcp.list", {}, OWNER)).servers.filter((s) => s.scope === "global");
  for (const m of found.filter((f) => keys.includes(f.key))) {
    const name = serverName(m.name);
    if (servers.some((s) => s.name === name || (m.server.url && s.target === m.server.url))) {
      out.existing.push(name);
      continue;
    }
    const given = values[m.key] ?? {};
    const lacking = m.needs.filter((k) => !given[k]?.trim());
    if (lacking.length) {
      out.need_values.push({ name, keys: lacking });
      continue;
    }
    const raw = { ...m.server.env, ...m.server.headers };
    try {
      for (const k of m.stored) await call("secrets.set", { name: variableName(name, k), value: raw[k] ?? "" }, OWNER);
      for (const k of m.needs)
        await call("secrets.set", { name: variableName(name, k), value: given[k]?.trim() ?? "" }, OWNER);
      await call("mcp.set", { name, server: withVariables(name, m.server, [...m.stored, ...m.needs]) }, OWNER);
      out.added.push(name);
    } catch (err) {
      out.failed.push({ name, reason: err instanceof Error ? err.message : String(err) });
    }
  }
  return out;
}
