export function publicLink(path: string, address: { url?: string | null; mode?: string; error?: string }): string {
  if (!address.url || address.mode === "off" || address.error) throw new Error("Public address unavailable");
  return `${address.url}${path}`;
}

type LinkWindow = { navigate(url: string): void; close(): void };

/** Reserve the tab during the click, before asynchronous protocol discovery consumes user activation. */
export async function openPublicLink(load: () => Promise<string>, open: () => LinkWindow | null): Promise<void> {
  const target = open();
  if (!target) throw new PopupBlockedError();
  try {
    target.navigate(await load());
  } catch (error) {
    target.close();
    throw error;
  }
}

/** ENLACE-PUBLICO-1 · The tab could not be opened (the browser blocked it): the caller copies the link instead. */
export class PopupBlockedError extends Error {
  constructor() {
    super("Popup blocked");
  }
}

type AddressLike = { url?: string | null; mode?: string; error?: string; starting?: boolean };

/** ENLACE-PUBLICO-1 · The public address could not be had; `reason` is why, in the core's own code. */
export class PublicLinkError extends Error {
  readonly reason?: string;
  constructor(reason?: string) {
    super("Public address unavailable");
    this.reason = reason;
  }
}

/**
 * ENLACE-PUBLICO-1 · The public link of `path`, switching on the temporary link right here when there is no public
 * address yet. An address the owner chose (Tailscale, ngrok, their own) is never replaced: if it is down, its reason.
 */
export async function ensurePublicLink(
  path: string,
  deps: { read: () => Promise<AddressLike | undefined>; activate: () => Promise<AddressLike | undefined> },
): Promise<string> {
  const now = await deps.read();
  if (now && linkOrUndefined(path, now)) return `${now.url}${path}`;
  if (now && now.mode !== "off" && now.mode !== "cloudflare") throw new PublicLinkError(now.error ?? "failed");
  const after = await deps.activate();
  if (after && linkOrUndefined(path, after)) return `${after.url}${path}`;
  throw new PublicLinkError(after?.error ?? "failed");
}

function linkOrUndefined(path: string, a: AddressLike): string | undefined {
  try {
    return publicLink(path, a);
  } catch {
    return undefined;
  }
}
