import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { localConnection, serviceConnection } from "./local.ts";

test("RPC connections honor COLONIA_URL but service operations always target the local installation", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "colonia-service-target-"));
  try {
    fs.writeFileSync(path.join(home, "core.env"), "COLONIA_PORT=7550\nCOLONIA_TOKEN=local-token\n");
    const env = { COLONIA_HOME: home, COLONIA_URL: "https://server.example.com" };
    assert.equal(localConnection(env).url, "https://server.example.com");
    assert.deepEqual(serviceConnection(env), { url: "http://127.0.0.1:7550", token: "local-token" });
    assert.equal(serviceConnection({ ...env, COLONIA_PORT: "7660" }).url, "http://127.0.0.1:7660");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
