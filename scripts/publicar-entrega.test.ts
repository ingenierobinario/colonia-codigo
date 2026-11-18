import assert from "node:assert/strict";
import { test } from "node:test";
import { publicarEntrega } from "./publicar-entrega.ts";

const fixture = {
  tag: "v2.9.4",
  repo: "ejemplo/entregas",
  files: ["ejemplo.zip", "ejemplo.zip.sha256"],
  notes: "notas.md",
};

function simular(info: object | string) {
  const calls: string[][] = [];
  const run = (args: string[]) => {
    calls.push(args);
    if (args[1] !== "view") return { status: 0, stdout: "", stderr: "" };
    return typeof info === "string"
      ? { status: 1, stdout: "", stderr: info }
      : { status: 0, stdout: JSON.stringify(info), stderr: "" };
  };
  return { calls, run };
}

test("un ensayo o un segundo envío conservan los instaladores de una versión que ya es estable", () => {
  for (const prueba of [true, false]) {
    const { calls, run } = simular({ isDraft: false, isPrerelease: false });
    assert.throws(() => publicarEntrega({ ...fixture, prueba }, run), /estable/);
    assert.deepEqual(
      calls.map((a) => a[1]),
      ["view"],
    );
  }
});
test("una entrega nueva se marca de prueba únicamente si así se solicitó", () => {
  for (const prueba of [true, false]) {
    const { calls, run } = simular("release not found");
    publicarEntrega({ ...fixture, prueba }, run);
    assert.deepEqual(
      calls.map((a) => a[1]),
      ["view", "create"],
    );
    assert.equal(calls.at(-1)?.includes("--prerelease"), prueba);
    assert.ok(fixture.files.every((f) => calls.at(-1)?.includes(f)));
  }
});
test("la versión de prueba se renueva o pasa a estable después de subir todos los archivos", () => {
  for (const prueba of [true, false]) {
    const { calls, run } = simular({ isDraft: false, isPrerelease: true });
    publicarEntrega({ ...fixture, prueba }, run);
    assert.deepEqual(
      calls.map((a) => a[1]),
      ["view", "upload", "edit"],
    );
    assert.ok(calls.at(-1)?.includes(`--prerelease=${prueba}`));
  }
});
test("un fallo de consulta o de subida impide cambiar la versión visible", () => {
  const denied = simular("error de acceso (HTTP 403)");
  assert.throws(() => publicarEntrega({ ...fixture, prueba: true }, denied.run), /403/);
  assert.equal(denied.calls.length, 1);
  const pending = simular({ isDraft: true, isPrerelease: false });
  assert.throws(
    () =>
      publicarEntrega({ ...fixture, prueba: false }, (a) => {
        const result = pending.run(a);
        return a[1] === "upload" ? { status: 1, stdout: "", stderr: "subida interrumpida" } : result;
      }),
    /subida interrumpida/,
  );
  assert.deepEqual(
    pending.calls.map((a) => a[1]),
    ["view", "upload"],
  );
});
