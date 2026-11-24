// DESCARGA-REANUDA-1 · Descarga de un fichero de actualización que no se queda colgada ni empieza de cero.
// Antes era un único fetch con un tope total de 20 min: si el equipo se dormía a mitad, el socket moría y, al
// despertar, undici daba «terminated» ~40 min después y se perdía todo lo bajado (update.log del 24-nov, 2.36.69).
// Ahora: se corta si pasan `idleMs` sin recibir bytes, y se reintenta reanudando con Range desde lo que ya hay.
import fs from "node:fs";
import path from "node:path";

export type DownloadOptions = { idleMs?: number; tries?: number; backoffMs?: number };

class HttpError extends Error {}

export async function download(url: string, file: string, opts: DownloadOptions = {}): Promise<void> {
  const idleMs = opts.idleMs ?? 60_000;
  const tries = opts.tries ?? 5;
  const backoffMs = opts.backoffMs ?? 2_000;
  fs.rmSync(file, { force: true });
  for (let i = 1; ; i++) {
    const have = fs.existsSync(file) ? fs.statSync(file).size : 0;
    const ac = new AbortController();
    const stalled = () => ac.abort(new Error(`${path.basename(file)}: sin datos en ${Math.round(idleMs / 1000)} s`));
    let idle = setTimeout(stalled, idleMs);
    try {
      const r = await fetch(url, { signal: ac.signal, headers: have ? { Range: `bytes=${have}-` } : {} });
      if (!r.ok || !r.body) throw new HttpError(`download ${path.basename(file)}: HTTP ${r.status}`);
      // Sin 206 el servidor manda el fichero entero: se reescribe desde cero.
      const append = have > 0 && r.status === 206;
      // Cada trozo se escribe antes de leer el siguiente: lo que llegó antes de un corte queda en disco para el Range.
      const out = await fs.promises.open(file, append ? "a" : "w");
      try {
        for await (const chunk of r.body as unknown as AsyncIterable<Uint8Array>) {
          clearTimeout(idle);
          idle = setTimeout(stalled, idleMs);
          await out.write(chunk);
        }
      } finally {
        await out.close();
      }
      return;
    } catch (err) {
      if (i >= tries || (err instanceof HttpError && !/HTTP 5\d\d/.test(err.message))) throw err;
      await new Promise((res) => setTimeout(res, backoffMs * i));
    } finally {
      clearTimeout(idle);
    }
  }
}
