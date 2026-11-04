import assert from "node:assert/strict";
import { test } from "node:test";
import { describeExposure, planExposure, tailscaleDnsName } from "./expose-plan.ts";

const token = () => "generated";

test("lan listens on every address and creates a token when there is none", () => {
  const r = planExposure({ COLONIA_PORT: "7500", COLONIA_PUBLIC_URL: "https://old.example" }, "lan", { token });
  assert.deepEqual(r, {
    vars: { COLONIA_PORT: "7500", COLONIA_TOKEN: "generated", COLONIA_HOST: "0.0.0.0" },
    generatedToken: "generated",
  });
});

test("tailscale keeps the core on loopback, publishes the name and keeps an existing token", () => {
  const r = planExposure({ COLONIA_HOST: "0.0.0.0", COLONIA_TOKEN: "kept" }, "tailscale", {
    tailscaleUrl: "https://box.tail0.ts.net",
    token,
  });
  assert.deepEqual(r, { vars: { COLONIA_TOKEN: "kept", COLONIA_PUBLIC_URL: "https://box.tail0.ts.net" } });
  assert.throws(() => planExposure({}, "tailscale", { token }));
});

test("off removes the exposure but keeps the token", () => {
  const r = planExposure({ COLONIA_HOST: "0.0.0.0", COLONIA_PUBLIC_URL: "https://x", COLONIA_TOKEN: "kept" }, "off");
  assert.deepEqual(r, { vars: { COLONIA_TOKEN: "kept" } });
});

test("reads the MagicDNS name from tailscale status", () => {
  assert.equal(tailscaleDnsName('{"Self":{"DNSName":"box.tail0.ts.net."}}'), "box.tail0.ts.net");
  assert.equal(tailscaleDnsName('{"Self":{}}'), undefined);
  assert.equal(tailscaleDnsName("not json"), undefined);
});

test("describes each exposure", () => {
  assert.match(describeExposure({}), /only this computer/);
  assert.match(describeExposure({ COLONIA_HOST: "0.0.0.0" }), /0\.0\.0\.0/);
  assert.match(describeExposure({ COLONIA_PUBLIC_URL: "https://box.ts.net" }), /stays on this computer/);
});
