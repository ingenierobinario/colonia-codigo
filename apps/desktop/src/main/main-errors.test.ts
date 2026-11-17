// FALLO-SIN-DIALOGO-1: la excepción no capturada se escribe con su traza y la app sigue (sin el diálogo que bloquea).
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { logUncaught, uncaughtLine } from "./main-errors.ts";

test("FALLO-SIN-DIALOGO-1: la línea lleva la traza entera", () => {
  const line = uncaughtLine(new TypeError("Object has been destroyed"), "uncaughtException", new Date(0));
  assert.match(line, /^1970-01-01T00:00:00\.000Z uncaughtException: TypeError: Object has been destroyed\n\s+at /);
  assert.equal(uncaughtLine("raro", undefined, new Date(0)), "1970-01-01T00:00:00.000Z uncaughtException: raro\n");
});

test("FALLO-SIN-DIALOGO-1: el manejador escribe en el log y no relanza", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "colonia-err-"));
  try {
    const file = path.join(dir, "logs", "main.log");
    const proc = new EventEmitter();
    const said: string[] = [];
    logUncaught(proc, file, (l) => said.push(l));
    // Con un manejador registrado, Node (y Electron) ya no tratan la excepción como fatal ni enseñan el diálogo.
    assert.equal(proc.listenerCount("uncaughtException"), 1);
    assert.doesNotThrow(() => proc.emit("uncaughtException", new TypeError("Object has been destroyed"), "uncaughtException"));
    assert.match(fs.readFileSync(file, "utf8"), /TypeError: Object has been destroyed/);
    assert.equal(said.length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
