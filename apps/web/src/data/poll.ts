// PERF-3 · Lo que comparten las pantallas que releen algo cada pocos segundos: no preguntar con la ventana oculta,
// no apilar una lectura sobre otra que aún no volvió, y no dar por nuevo lo que llegó igual.

/** El valor anterior si el nuevo dice lo mismo: así quien lo mira no se repinta por una lectura idéntica. */
export function keepSame<T>(prev: T, next: T): T {
  if (Object.is(prev, next)) return prev;
  try {
    return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
  } catch {
    return next;
  }
}

type Doc = Pick<Document, "hidden" | "addEventListener" | "removeEventListener">;

/**
 * Lee ahora y cada `ms`. Con la ventana oculta no pregunta, y al volver a verse lee en el acto. Si la lectura anterior
 * sigue en camino, ese turno se salta. Devuelve cómo pararlo.
 */
export function poll(run: () => Promise<unknown>, ms: number, doc: Doc | undefined = globalThis.document): () => void {
  let busy = false;
  const tick = () => {
    if (busy || doc?.hidden) return;
    busy = true;
    void run()
      .catch(() => {})
      .finally(() => {
        busy = false;
      });
  };
  tick();
  const id = setInterval(tick, ms);
  doc?.addEventListener("visibilitychange", tick);
  return () => {
    clearInterval(id);
    doc?.removeEventListener("visibilitychange", tick);
  };
}
