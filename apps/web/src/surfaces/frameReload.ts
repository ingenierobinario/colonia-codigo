import { useSyncExternalStore } from "react";

// APPS-REFRESCAR-1: «Refrescar» vuelve a montar el iframe del artefacto (sus scripts corren otra vez y traen datos);
// lo que recuerda (Colonia.store) se le vuelve a pasar al construirlo, así que no pierde nada.
const ticks = new Map<string, number>();
const subs = new Set<() => void>();

/** Reloads every open copy of the artifact. */
export function reloadFrame(surface: string): void {
  ticks.set(surface, (ticks.get(surface) ?? 0) + 1);
  for (const f of subs) f();
}

function subscribe(f: () => void): () => void {
  subs.add(f);
  return () => subs.delete(f);
}

/** How many times the artifact was reloaded: a key for its iframe. */
export function useFrameTick(surface: string): number {
  return useSyncExternalStore(subscribe, () => ticks.get(surface) ?? 0);
}
