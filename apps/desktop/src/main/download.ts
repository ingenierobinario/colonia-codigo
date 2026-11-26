// DESCARGA-REANUDA-1 · Descarga de un fichero de actualización que no se queda colgada ni empieza de cero.
// Antes era un único fetch con un tope total de 20 min: si el equipo se dormía a mitad, el socket moría y, al
// despertar, undici daba «terminated» ~40 min después y se perdía todo lo bajado (update.log del 24-nov, 2.36.69).
// Ahora: se corta si pasan `idleMs` sin recibir bytes, y se reintenta reanudando con Range desde lo que ya hay.
import fs from "node:fs";
import path from "node:path";

export type DownloadOptions = { idleMs?: number; tries?: number; backoffMs?: number; maxBytes?: number };

class HttpError extends Error {}
class SizeError extends Error {}
class ResumeError extends Error {}

export async function download(url: string, file: string, opts: DownloadOptions = {}): Promise<void> {
  const idleMs = opts.idleMs ?? 60_000;
  const tries = opts.tries ?? 5;
  const backoffMs = opts.backoffMs ?? 2_000;
  const maxBytes = opts.maxBytes ?? 2 * 1024 ** 3;
  let etag: string | undefined;
  fs.rmSync(file, { force: true });
  for (let i = 1; ; i++) {
    const have = fs.existsSync(file) ? fs.statSync(file).size : 0;
    const ac = new AbortController();
    const stalled = () => ac.abort(new Error(`${path.basename(file)}: sin datos en ${Math.round(idleMs / 1000)} s`));
    let idle = setTimeout(stalled, idleMs);
    try {
      const r = await fetch(url, {
        signal: ac.signal,
        headers: have ? { Range: `bytes=${have}-`, ...(etag ? { "If-Range": etag } : {}) } : {},
      });
      if (!r.ok || !r.body) throw new HttpError(`download ${path.basename(file)}: HTTP ${r.status}`);
      // Sin 206 el servidor manda el fichero entero: se reescribe desde cero.
      const append = have > 0 && r.status === 206;
      const responseTag = r.headers.get("etag") ?? undefined;
      if (r.status === 206) {
        const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(r.headers.get("content-range") ?? "");
        if (
          !append ||
          !range ||
          Number(range[1]) !== have ||
          Number(range[2]) < have ||
          Number(range[2]) >= Number(range[3]) ||
          (etag && responseTag && etag !== responseTag)
        )
          throw new ResumeError("The download changed or returned an invalid byte range");
        if (Number(range[3]) > maxBytes) throw new SizeError(`download ${path.basename(file)} exceeds its size limit`);
      }
      if (!append) etag = responseTag?.startsWith('"') ? responseTag : undefined;
      let received = append ? have : 0;
      const length = Number(r.headers.get("content-length"));
      if (Number.isFinite(length) && received + length > maxBytes)
        throw new SizeError(`download ${path.basename(file)} exceeds its size limit`);
      // Cada trozo se escribe antes de leer el siguiente: lo que llegó antes de un corte queda en disco para el Range.
      const out = await fs.promises.open(file, append ? "a" : "w");
      try {
        for await (const chunk of r.body as unknown as AsyncIterable<Uint8Array>) {
          received += chunk.byteLength;
          if (received > maxBytes) throw new SizeError(`download ${path.basename(file)} exceeds its size limit`);
          clearTimeout(idle);
          idle = setTimeout(stalled, idleMs);
          let offset = 0;
          while (offset < chunk.byteLength) {
            const { bytesWritten } = await out.write(chunk, offset, chunk.byteLength - offset);
            if (bytesWritten === 0) throw new Error("The download could not be written");
            offset += bytesWritten;
          }
        }
      } finally {
        await out.close();
      }
      return;
    } catch (err) {
      ac.abort();
      if (err instanceof ResumeError) {
        await fs.promises.rm(file, { force: true });
        etag = undefined;
      }
      if (err instanceof SizeError) {
        await fs.promises.rm(file, { force: true });
        throw err;
      }
      if (i >= tries || (err instanceof HttpError && !/HTTP 5\d\d/.test(err.message))) throw err;
      await new Promise((res) => setTimeout(res, backoffMs * i));
    } finally {
      clearTimeout(idle);
    }
  }
}
