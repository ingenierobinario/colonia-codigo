import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fakeProgram } from "../harness/fake-program.test-support.ts";
import { RUNS_SCRIPTS, stopped, tempDir, waitFor } from "./platform.ts";
import { vmBrowserDriver } from "./vm-browser-driver.ts";

// The guest driver is a Unix executable, as in the VM consent tests.
if (RUNS_SCRIPTS) {
  test("the guest fixture can reap its own browser when normal termination is ignored", async () => {
    const dir = tempDir("colonia-guest-rescue-");
    const ready = path.join(dir.path, "ready");
    const refused = path.join(dir.path, "refused");
    const chrome = fakeProgram(
      dir.path,
      "chrome",
      `
const fs = require('node:fs');
process.on('SIGTERM', () => fs.writeFileSync(${JSON.stringify(refused)}, 'ignored'));
require('node:net').createServer().listen(0, '127.0.0.1', () => fs.writeFileSync(${JSON.stringify(ready)}, 'ready'));
`,
    );
    const driver = vmBrowserDriver(dir.path, chrome.bin, "http://127.0.0.1:9");
    const child = spawn(process.execPath, [driver.binary, "/usr/local/bin/colonia-browser"], { stdio: "pipe" });
    try {
      await waitFor(() => fs.existsSync(ready), "the fake browser to start");
      child.kill();
      await waitFor(() => fs.existsSync(refused), "the fake browser to refuse normal termination");
      assert.equal(child.exitCode, null);
      driver.forceClose();
      await stopped(child);
      await driver.closed();
      assert.equal(child.exitCode, 0);
    } finally {
      driver.forceClose();
      await stopped(child);
      await driver.closed();
      await dir.remove();
    }
  });
}
