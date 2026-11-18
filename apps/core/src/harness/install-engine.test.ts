import assert from "node:assert/strict";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createInstaller } from "./install-engine.ts";

test("instala una sola vez y detecta la herramienta sin reiniciar", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "colonia-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const find = async (bin: string) => (await stat(join(dir, bin)).catch(() => undefined)) && join(dir, bin);
  let calls = 0;
  const install = createInstaller(find, async () => {
    calls++;
    await writeFile(join(dir, "kimi"), "");
  });
  const first = install("acp:kimi");
  assert.equal(first, install("acp:kimi"));
  assert.deepEqual(await first, { installed: true });
  assert.deepEqual(await install("acp:kimi"), { installed: true });
  assert.equal(calls, 1);
});

test("permite reintentar y comprueba si apareció el ejecutable", async () => {
  let calls = 0;
  const install = createInstaller(
    async () => undefined,
    async () => {
      if (++calls === 1) throw new Error("descarga interrumpida");
    },
  );
  await assert.rejects(install("codex"), /interrumpida/);
  assert.deepEqual(await install("codex"), { installed: false });
});
