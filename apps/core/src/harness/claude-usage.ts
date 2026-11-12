import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { EngineUsageWindow } from "@colonia/protocol";
import { z } from "zod";

// USO-CLAUDE-2: the limits come from the account's usage endpoint, the one Claude Code's own /usage reads,
// with the login Claude Code already keeps. Before this, Colonia ran `claude -p /usage` and parsed an
// undocumented stream frame: CLI updates kept breaking it (from 2.1.31x `-p /usage` reaches the model,
// spends tokens and never answers), so «Límites de cuenta no disponibles» came back after every fix.
const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";

type Options = {
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  /** The stored login as JSON text, or undefined when there is none. */
  credentials?: () => Promise<string | undefined>;
  now?: () => number;
  timeoutMs?: number;
};

const Credentials = z.object({
  claudeAiOauth: z.object({
    accessToken: z.string().min(1),
    expiresAt: z.number().optional(),
  }),
});

const Window = z
  .object({
    utilization: z.number().min(0).max(100),
    resets_at: z.iso.datetime({ offset: true }).nullable().optional(),
  })
  .nullable()
  .optional();
const Report = z.object({ five_hour: Window, seven_day: Window });

export function parseClaudeUsage(body: unknown): EngineUsageWindow[] | undefined {
  const report = Report.safeParse(body);
  if (!report.success) return undefined;
  const windows: EngineUsageWindow[] = [];
  for (const [key, id, minutes] of [
    ["five_hour", "primary", 300],
    ["seven_day", "secondary", 10080],
  ] as const) {
    const limit = report.data[key];
    if (limit)
      windows.push({
        id,
        used_percent: limit.utilization,
        window_minutes: minutes,
        ...(limit.resets_at ? { resets_at: new Date(limit.resets_at).toISOString() } : {}),
      });
  }
  return windows.length ? windows : undefined;
}

/** Where Claude Code keeps its login: a file on Windows and Linux, the login keychain on macOS. */
async function storedCredentials(env: NodeJS.ProcessEnv): Promise<string | undefined> {
  const dir = env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
  const file = await readFile(join(dir, ".credentials.json"), "utf8").catch(() => undefined);
  if (file || process.platform !== "darwin") return file;
  return new Promise((resolve) => {
    execFile(
      "security",
      ["find-generic-password", "-s", "Claude Code-credentials", "-w"],
      { timeout: 5_000, windowsHide: true },
      (error, stdout) => resolve(error ? undefined : stdout.trim() || undefined),
    );
  });
}

/** `command` is the installed CLI; only its login is used, nothing is started. */
export async function readClaudeUsage(
  _command: string,
  options: Options = {},
): Promise<EngineUsageWindow[] | undefined> {
  const env = options.env ?? process.env;
  let token: string;
  try {
    const text = await (options.credentials ?? (() => storedCredentials(env)))();
    if (!text) return undefined;
    const login = Credentials.parse(JSON.parse(text)).claudeAiOauth;
    // An expired login is renewed by Claude Code itself the next time it runs; refreshing it here would
    // rotate the token under the CLI's feet.
    if (login.expiresAt !== undefined && login.expiresAt <= (options.now?.() ?? Date.now())) return undefined;
    token = login.accessToken;
  } catch {
    return undefined;
  }
  try {
    const response = await (options.fetch ?? fetch)(USAGE_URL, {
      headers: {
        authorization: `Bearer ${token}`,
        "anthropic-beta": "oauth-2025-04-20",
        accept: "application/json",
      },
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
    });
    if (!response.ok) return undefined;
    return parseClaudeUsage(await response.json());
  } catch {
    return undefined;
  }
}
