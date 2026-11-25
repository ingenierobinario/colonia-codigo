/** Each business uses a fresh app context, including drafts and remembered entity IDs. */
export const workspacePath =
  typeof window === "undefined"
    ? ""
    : (/^\/workspaces\/w_[a-f0-9]{32}(?=\/|$)/.exec(window.location.pathname)?.[0] ?? "");

export function workspaceStorageKey(key: string): string {
  return workspacePath ? `${key}:${workspacePath.split("/").at(-1)}` : key;
}
