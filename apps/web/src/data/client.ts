import { ColoniaClient } from "@colonia/protocol/client";
import { type KeyStore, pickToken } from "./token.ts";

/** localStorage, or none when the browser blocks it (reading the property itself may throw). */
export function keyStore(): KeyStore | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/** Which token this panel shows the core, and where it came from (the pairing gate needs to know). */
export const access = pickToken(window.coloniaDesktop?.coreToken, keyStore());
window.coloniaDesktop?.updateAuth?.(access.token);

/** One HTTP client for the panel. Same origin: Vite proxies /rpc and /ws in dev, the core serves the build. */
export const client = new ColoniaClient({
  url: window.location.origin,
  ...(access.token ? { token: access.token } : {}),
  client: { name: "colonia-web", version: "0.0.0" },
});
