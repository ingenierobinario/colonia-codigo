import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { tempDir } from "../testkit/platform.ts";
import { createHeadlessBrowser } from "./headless-browser.ts";

for (const phase of ["startup", "operation", "late startup response"] as const) {
  test(`closing the browser rejects pending work: ${phase}`, async () => {
    const dir = tempDir("colonia-browser-close-");
    const input = new PassThrough();
    const output = new PassThrough();
    let killed = false;
    const child = Object.assign(new EventEmitter(), {
      stdio: [null, null, null, output, input],
      kill: () => {
        killed = true;
        return true;
      },
    }) as unknown as ChildProcess;
    const pending = Promise.withResolvers<void>();
    let pendingId = 0;
    output.on("data", (chunk: Buffer) => {
      for (const raw of chunk.toString().split("\0").filter(Boolean)) {
        const message = JSON.parse(raw) as { id: number; method: string };
        if (phase === "operation" && message.method === "Browser.getVersion")
          input.write(`${JSON.stringify({ id: message.id, result: {} })}\0`);
        else {
          pendingId = message.id;
          pending.resolve();
        }
      }
    });
    const browser = createHeadlessBrowser({
      dir: dir.path,
      chrome: process.execPath,
      spawn: (() => child) as never,
      blockedPorts: () => new Set(),
      onChange: () => {},
    });
    let outcome: unknown;
    const opening = browser.handle("browser.open", { url: "https://example.com", by: "superagent" }).then(
      () => {
        outcome = "opened";
      },
      (error: unknown) => {
        outcome = error;
      },
    );
    try {
      await pending.promise;
      browser.close();
      if (phase === "late startup response") input.write(`${JSON.stringify({ id: pendingId, result: {} })}\0`);
      else child.emit("exit", 0, null);
      await setImmediate();
      assert.equal(killed, true);
      assert.ok(outcome instanceof Error, "closing must settle pending work without waiting for a timeout");
      assert.match(outcome.message, /stopped/);
      assert.equal(browser.running(), false);
      assert.deepEqual(browser.list(), []);
    } finally {
      input.emit("error", new Error("test cleanup"));
      await opening;
      browser.close();
      input.destroy();
      output.destroy();
      await dir.remove();
    }
  });
}
