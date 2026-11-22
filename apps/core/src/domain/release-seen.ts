// LAZY-1 · Lo barato de «¿hay novedades que contar?» sin cargar domain/whats-new.ts ni los 49 KB de
// release-highlights.ts: la versión ya contada, una vuelta atrás y una instalación nueva se resuelven aquí.
import { compareVersions, type ReleaseSource } from "../release-notes.ts";
import type { Store } from "./store.ts";

/** The last release this install was told about (or started on). */
export const SEEN_KEY = "release_seen";

/** La versión que hay que contar (whats-new.ts la cuenta), o nada si no hay nada que contar ya. */
export function releaseToTell(store: Store, source: ReleaseSource): { version: string; seen?: string } | undefined {
  const version = source.version();
  if (!version) return undefined;
  const seen = store.settings.get(SEEN_KEY);
  if (seen === version) return undefined;
  // A downgrade tells nothing and keeps the newest release told, so going back up is not told twice.
  if (seen && compareVersions(version, seen) <= 0) return undefined;
  // A new install (nothing said in it yet) starts at its version untold.
  if (!seen && !store.messages.anyFromOwner()) {
    store.settings.set(SEEN_KEY, version);
    return undefined;
  }
  return seen ? { version, seen } : { version };
}
