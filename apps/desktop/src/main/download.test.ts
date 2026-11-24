// DESCARGA-REANUDA-1 · Un servidor local que corta a mitad o se queda mudo: la descarga reanuda con Range y no se cuelga.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { download } from "./download.ts";

const DATA = Buffer.alloc(256 * 1024, 0);
for (let i = 0; i < DATA.length; i++) DATA[i] = i % 251;
const HALF = DATA.length / 2;

async function serve(handler: http.RequestListener) {
  const server = http.createServer(handler);
  await new Promise<void>((res) => server.listen(0, "127.0.0.1", res));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/colonia.zip`;
  return { url, close: () => new Promise<void>((res) => server.close(() => res())) };
}

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "descarga-")), "colonia.zip");

test("a cut in the middle resumes with Range and the file comes out whole", async () => {
  const ranges: (string | undefined)[] = [];
  const s = await serve((req, res) => {
    ranges.push(req.headers.range);
    const m = /^bytes=(\d+)-$/.exec(req.headers.range ?? "");
    if (!m) {
      res.writeHead(200, { "Content-Length": DATA.length });
      res.write(DATA.subarray(0, HALF), () => res.destroy());
      return;
    }
    const from = Number(m[1]);
    res.writeHead(206, {
      "Content-Length": DATA.length - from,
      "Content-Range": `bytes ${from}-${DATA.length - 1}/${DATA.length}`,
    });
    res.end(DATA.subarray(from));
  });
  const file = tmp();
  try {
    await download(s.url, file, { backoffMs: 10 });
    assert.equal(ranges.length, 2);
    assert.equal(ranges[0], undefined);
    assert.match(ranges[1] ?? "", /^bytes=\d+-$/);
    assert.ok(Number(/\d+/.exec(ranges[1] ?? "")?.[0]) > 0, "resumes from the bytes it already has");
    assert.deepEqual(fs.readFileSync(file), DATA);
  } finally {
    await s.close();
  }
});

test("a server that goes silent is cut after idleMs and the next try finishes", async () => {
  let calls = 0;
  const s = await serve((req, res) => {
    calls++;
    if (calls === 1) {
      res.writeHead(200, { "Content-Length": DATA.length });
      res.write(DATA.subarray(0, HALF)); // y no manda nada más
      return;
    }
    const from = Number(/^bytes=(\d+)-$/.exec(req.headers.range ?? "")?.[1] ?? 0);
    res.writeHead(206, { "Content-Length": DATA.length - from });
    res.end(DATA.subarray(from));
  });
  const file = tmp();
  const t0 = Date.now();
  try {
    await download(s.url, file, { idleMs: 300, backoffMs: 10 });
    const ms = Date.now() - t0;
    assert.equal(calls, 2);
    assert.ok(ms >= 300 && ms < 5_000, `cut after ${ms} ms`);
    assert.deepEqual(fs.readFileSync(file), DATA);
  } finally {
    await s.close();
  }
});

test("a server that never answers gives up after the tries, with the idle error", async () => {
  let calls = 0;
  const s = await serve(() => {
    calls++; // ni cabeceras
  });
  try {
    await assert.rejects(download(s.url, tmp(), { idleMs: 150, tries: 3, backoffMs: 10 }), /sin datos en/);
    assert.equal(calls, 3);
  } finally {
    s.close();
  }
});

test("a 404 is not retried", async () => {
  let calls = 0;
  const s = await serve((_req, res) => {
    calls++;
    res.writeHead(404).end();
  });
  try {
    await assert.rejects(download(s.url, tmp(), { backoffMs: 10 }), /HTTP 404/);
    assert.equal(calls, 1);
  } finally {
    await s.close();
  }
});

test("a server that ignores Range sends the whole file again and it is rewritten, not appended", async () => {
  let calls = 0;
  const s = await serve((_req, res) => {
    calls++;
    res.writeHead(200, { "Content-Length": DATA.length });
    if (calls === 1) res.write(DATA.subarray(0, HALF), () => res.destroy());
    else res.end(DATA);
  });
  const file = tmp();
  try {
    await download(s.url, file, { backoffMs: 10 });
    assert.deepEqual(fs.readFileSync(file), DATA);
  } finally {
    await s.close();
  }
});
