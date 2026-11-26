import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { callSandbox } from "../e2e/sandbox-control.ts";

test("phone controls use their own child even when another server occupies the old phone port", async (t) => {
  let wrongRequests = 0;
  const wrongServer = http.createServer((_req, res) => {
    wrongRequests++;
    res.writeHead(426).end("Upgrade Required");
  });
  await new Promise<void>((resolve) => wrongServer.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => wrongServer.close(() => resolve())));
  const port = (wrongServer.address() as AddressInfo).port;
  const script = `
    import { serveSandbox } from ${JSON.stringify(new URL("../e2e/sandbox-control.ts", import.meta.url).href)};
    import { controlWhatsApp } from ${JSON.stringify(new URL("../e2e/fake-baileys.ts", import.meta.url).href)};
    serveSandbox(process, (command) => {
      if (command.type === "whatsapp") return controlWhatsApp(command.path, command.body);
      if (command.at === null) process.disconnect();
      return { clock: command.at };
    });
  `;
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
    env: { ...process.env, E2E_WA_PORT: String(port) },
    stdio: ["ignore", "ignore", "pipe", "ipc"],
    windowsHide: true,
  });
  t.after(async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, "exit");
    if (child.connected) child.disconnect();
    await exited;
  });
  const [scan, clock, sent] = await Promise.all([
    callSandbox(child, { type: "whatsapp", path: "/scan", body: "{}" }),
    callSandbox(child, { type: "clock", at: "2026-01-01T00:00:00.000Z" }),
    callSandbox(child, { type: "whatsapp", path: "/sent?jid=someone", body: "" }),
  ]);
  assert.deepEqual(scan, { ok: true });
  assert.deepEqual(clock, { clock: "2026-01-01T00:00:00.000Z" });
  assert.deepEqual(sent, { owner: "5491100000001@s.whatsapp.net", sent: [] });
  assert.equal(wrongRequests, 0);
  await assert.rejects(
    callSandbox(child, { type: "whatsapp", path: "/unknown", body: "{}" }),
    /Unknown simulated WhatsApp control/,
  );
  assert.equal(child.listenerCount("message"), 0);
  assert.equal(child.listenerCount("exit"), 0);
  await assert.rejects(callSandbox(child, { type: "clock", at: null }), /disconnected/);
  await assert.rejects(callSandbox(child, { type: "clock", at: null }), /disconnected/);
});
