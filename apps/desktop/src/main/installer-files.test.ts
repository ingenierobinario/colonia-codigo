import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { oldInstallers, removeOldInstallers } from "./installer-files.ts";

test("only Colonia's own Windows installers are removed, and never the one about to run", () => {
  const names = ["Colonia-2.2.4-win-x64.exe", "Colonia-2.3.5-win-x64.exe", "Colonia-2.3.6-win-arm64.exe", "setup.exe", "Colonia.exe"];
  assert.deepEqual(oldInstallers(names, "Colonia-2.3.6-win-arm64.exe"), ["Colonia-2.2.4-win-x64.exe", "Colonia-2.3.5-win-x64.exe"]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "colonia-installers-"));
  try {
    for (const n of [...names, "notes.txt"]) fs.writeFileSync(path.join(dir, n), "x");
    removeOldInstallers(dir, "Colonia-2.3.5-win-x64.exe");
    assert.deepEqual(fs.readdirSync(dir).sort(), ["Colonia-2.3.5-win-x64.exe", "Colonia.exe", "notes.txt", "setup.exe"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
