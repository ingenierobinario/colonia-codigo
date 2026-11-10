import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { loadConfig, testConfig } from "./config.ts";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "colonia-config-"));
after(() => fs.rmSync(home, { recursive: true, force: true }));
fs.writeFileSync(
  path.join(home, "core.env"),
  "# test\nCOLONIA_HOST=0.0.0.0\nCOLONIA_PORT=7501\nCOLONIA_TOKEN=from-file\nCOLONIA_PUBLIC_URL=https://colonia.example.ts.net/\nCOLONIA_SECRETS=keychain\n",
);

test("core.env in the home supplies defaults for the exposure keys", () => {
  const c = loadConfig({ COLONIA_HOME: home });
  assert.equal(c.host, "0.0.0.0");
  assert.equal(c.port, 7501);
  assert.equal(c.token, "from-file");
  assert.equal(c.publicUrl, "https://colonia.example.ts.net");
});

test("the process environment wins over core.env, and other keys in the file are ignored", () => {
  const c = loadConfig({ COLONIA_HOME: home, COLONIA_PORT: "7600", COLONIA_TOKEN: "from-env", COLONIA_SECRETS: "file" });
  assert.equal(c.port, 7600);
  assert.equal(c.token, "from-env");
  assert.equal(c.host, "0.0.0.0");
  assert.equal(c.secrets, "file");
});

test("a home without core.env, and testConfig, read nothing from disk", () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "colonia-config-empty-"));
  try {
    assert.equal(loadConfig({ COLONIA_HOME: empty }).host, "127.0.0.1");
  } finally {
    fs.rmSync(empty, { recursive: true, force: true });
  }
  const t = testConfig({ home });
  assert.equal(t.host, "127.0.0.1");
  assert.equal(t.token, undefined);
});

test("the webhook listener takes a free port when the core's port + 8 would pass 65535", () => {
  assert.equal(loadConfig({ COLONIA_HOME: home, COLONIA_PORT: "7600" }).hooksPort, 7608);
  assert.equal(loadConfig({ COLONIA_HOME: home, COLONIA_PORT: "65531" }).hooksPort, 0);
});
