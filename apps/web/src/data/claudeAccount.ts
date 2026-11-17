// CLAUDE-CUENTA-1: the Claude plan (Pro or Max) signed in through the owner's Claude Code (claude.*).
import type { ClaudeAccountStatus } from "@colonia/protocol";
import { t } from "../i18n/index.ts";
import { client } from "./client.ts";
import { loadEngines } from "./engines.ts";
import { loadCatalog } from "./models.ts";
import { notify } from "./notices.ts";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function claudeStatus(): Promise<ClaudeAccountStatus | undefined> {
  try {
    return await client.call("claude.status", {});
  } catch {
    return undefined;
  }
}

async function act(fn: () => Promise<ClaudeAccountStatus>): Promise<ClaudeAccountStatus | undefined> {
  try {
    const s = await fn();
    if (s.connected) await claudeChanged();
    return s;
  } catch (e) {
    notify(t("error.change", { error: errText(e) }));
    return undefined;
  }
}

export const claudeConnect = () => act(() => client.call("claude.connect", {}));
export const claudeCode = (code: string) => act(() => client.call("claude.code", { code }));
export async function claudeInstall(): Promise<ClaudeAccountStatus | undefined> {
  const s = await act(() => client.call("claude.install", {}));
  if (s?.installed) await claudeChanged();
  return s;
}
export async function claudeDisconnect(): Promise<ClaudeAccountStatus | undefined> {
  const s = await act(() => client.call("claude.disconnect", {}));
  await claudeChanged();
  return s;
}

export async function claudeChanged(): Promise<void> {
  await loadEngines(true);
  void loadCatalog(true);
}

/** CLAUDE-ACTIVO-1: the Claude plan on or off for agents; the sign-in stays. */
export const claudeSetEnabled = (enabled: boolean) => act(() => client.call("claude.set_enabled", { enabled }));
