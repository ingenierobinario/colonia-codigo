import assert from "node:assert/strict";
import { test } from "node:test";
import { type KeyStore, needsPairing, osName, pairError, pickToken, TOKEN_KEY, takePairCode } from "./token.ts";

const memory = (init: Record<string, string> = {}): KeyStore => {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
};

test("a token the panel paired for itself wins; the desktop app's comes next; else none", () => {
  assert.deepEqual(pickToken("core-tok", memory({ [TOKEN_KEY]: "coloniad_x" })), {
    token: "coloniad_x",
    from: "stored",
  });
  assert.deepEqual(pickToken("core-tok", memory()), { token: "core-tok", from: "desktop" });
  assert.deepEqual(pickToken(undefined, memory({ [TOKEN_KEY]: "coloniad_x" })), {
    token: "coloniad_x",
    from: "stored",
  });
  assert.deepEqual(pickToken("", memory()), { token: undefined, from: "none" });
  assert.deepEqual(pickToken(undefined, undefined), { token: undefined, from: "none" });
});

test("a browser that blocks storage goes without a stored token instead of failing", () => {
  const blocked: KeyStore = {
    getItem: () => {
      throw new Error("SecurityError");
    },
    setItem: () => {},
    removeItem: () => {},
  };
  assert.deepEqual(pickToken(undefined, blocked), { token: undefined, from: "none" });
});

test("only the core's refusal asks for pairing; a core that is down or another error does not", () => {
  assert.equal(needsPairing({ code: "unauthorized", message: "missing or bad token" }), true);
  assert.equal(needsPairing(new TypeError("Failed to fetch")), false);
  assert.equal(needsPairing({ code: "internal", message: "HTTP 500" }), false);
  assert.equal(needsPairing(undefined), false);
});

test("a turned-down code says whether it was wrong, locked out, or something else", () => {
  assert.equal(pairError({ code: "unauthorized", message: "unknown or expired code" }), "badCode");
  assert.equal(pairError({ code: "unauthorized", message: "too many wrong codes: ask for a new one" }), "locked");
  assert.equal(pairError({ code: "bad_request", message: "code: too short" }), "badCode");
  assert.equal(pairError(new TypeError("Failed to fetch")), "failed");
});

test("the device's name carries the operating system", () => {
  assert.equal(osName("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"), "macOS");
  assert.equal(osName("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"), "iOS");
  assert.equal(osName("Mozilla/5.0 (Linux; Android 14; Pixel 8)"), "Android");
  assert.equal(osName("Mozilla/5.0 (Windows NT 10.0; Win64; x64)"), "Windows");
  assert.equal(osName("Mozilla/5.0 (X11; Linux x86_64)"), "Linux");
  assert.equal(osName("curl/8"), undefined);
});

test("PRECARGA-PAIR-1: the link's pairing code is read, validated and taken out of the address", () => {
  assert.deepEqual(takePairCode("https://x.up.railway.app/?COLONIA_PAIR_CODE=abcd2345#view=equipos"), {
    code: "ABCD2345",
    clean: "/#view=equipos",
  });
  assert.deepEqual(takePairCode("https://x.up.railway.app/p?lang=es&COLONIA_PAIR_CODE=ABCD-2345"), {
    code: "ABCD-2345",
    clean: "/p?lang=es",
  });
  // Wrong shape (alphabet without 0/1/I/O, length, injected text): it still leaves the address, but fills nothing.
  for (const bad of ["ABCD0123", "ABC", "ABCD2345X", "<script>", ""])
    assert.deepEqual(takePairCode(`https://x.up.railway.app/?COLONIA_PAIR_CODE=${encodeURIComponent(bad)}`), {
      clean: "/",
    });
  assert.deepEqual(takePairCode("https://x.up.railway.app/?lang=es"), {});
});
