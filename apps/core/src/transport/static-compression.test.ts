import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";
import { createLog } from "../log.ts";
import { tempDir } from "../testkit/platform.ts";
import { httpHandler } from "./http.ts";

async function fixture() {
  const dir = tempDir("colonia-static-");
  const source = 'console.log("Contenido del panel");\n'.repeat(2000);
  fs.writeFileSync(path.join(dir.path, "panel.js"), source);
  fs.writeFileSync(path.join(dir.path, "index.html"), `<html>${"<p>Colonia</p>".repeat(200)}</html>`);
  fs.writeFileSync(path.join(dir.path, "image.png"), Buffer.alloc(4096, 42));
  const server = http.createServer(
    httpHandler(
      async () => ({ ok: true, result: { ready: true } }),
      createLog("test", true),
      { allowedOrigins: new Set(), token: undefined },
      dir.path,
    ),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    source,
    get(file: string, accept?: string) {
      return new Promise<{ headers: http.IncomingHttpHeaders; body: Buffer; status: number | undefined }>(
        (resolve, reject) => {
          const request = http.get(
            {
              host: "127.0.0.1",
              port: address.port,
              path: file,
              agent: false,
              headers: accept === undefined ? {} : { "accept-encoding": accept },
            },
            (response) => {
              const chunks: Buffer[] = [];
              response.on("data", (chunk: Buffer) => chunks.push(chunk));
              response.on("error", reject);
              response.on("end", () =>
                resolve({ headers: response.headers, body: Buffer.concat(chunks), status: response.statusCode }),
              );
            },
          );
          request.on("error", reject);
        },
      );
    },
    async [Symbol.asyncDispose]() {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
      await dir[Symbol.asyncDispose]();
    },
  };
}

test("el panel se transfiere comprimido sin cambiar su contenido ni su caché", async () => {
  await using f = await fixture();
  const response = await f.get("/panel.js", "gzip, deflate, br");
  assert.equal(response.headers["content-encoding"], "gzip");
  assert.equal(response.headers.vary, "Accept-Encoding");
  assert.equal(gunzipSync(response.body).toString(), f.source);
  assert.ok(response.body.length < Buffer.byteLength(f.source) / 4);
  assert.equal(response.headers["cache-control"], "public, max-age=31536000, immutable");
  const index = await f.get("/", "gzip");
  assert.equal(index.headers["cache-control"], "no-cache");
  assert.match(gunzipSync(index.body).toString(), /^<html>/);
});

test("respeta clientes sin gzip y exclusiones explícitas", async () => {
  await using f = await fixture();
  for (const encoding of [undefined, "identity", "br", "gzip;q=0", "gzip;q=0, *;q=1", "gzip;q=invalid"]) {
    const response = await f.get("/panel.js", encoding);
    assert.equal(response.headers["content-encoding"], undefined, encoding);
    assert.equal(response.body.toString(), f.source);
  }
  for (const encoding of ["GZIP", "gzip;q=0.5", "*;q=1"]) {
    const response = await f.get("/panel.js", encoding);
    assert.equal(response.headers["content-encoding"], "gzip", encoding);
    assert.equal(gunzipSync(response.body).toString(), f.source);
  }
});

test("no comprime imágenes ni respuestas de datos y conserva el confinamiento de rutas", async () => {
  await using f = await fixture();
  const image = await f.get("/image.png", "gzip");
  assert.equal(image.headers["content-encoding"], undefined);
  assert.deepEqual(image.body, Buffer.alloc(4096, 42));
  const health = await f.get("/health", "gzip");
  assert.equal(health.headers["content-encoding"], undefined);
  assert.deepEqual(JSON.parse(health.body.toString()), { ok: true, result: { ready: true } });
  assert.equal((await f.get("/%", "gzip")).status, 404);
  assert.equal((await f.get("/..%2foutside.js", "gzip")).status, 404);
});
