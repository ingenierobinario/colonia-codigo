import assert from "node:assert/strict";
import { test } from "node:test";
import { ensurePublicLink, openPublicLink, PopupBlockedError, PublicLinkError, publicLink } from "./public-link.ts";

test("public links require a configured tunnel, never a private host fallback", () => {
  assert.throws(() => publicLink("/a/example", {}), /unavailable/);
  assert.throws(() => publicLink("/a/example", { url: null }), /unavailable/);
  assert.throws(() => publicLink("/a/example", { url: "https://public.example.com", mode: "off" }), /unavailable/);
  assert.throws(() => publicLink("/a/example", { url: "https://public.example.com", error: "failed" }), /unavailable/);
  assert.equal(publicLink("/a/example", { url: "https://public.example.com" }), "https://public.example.com/a/example");
});

test("public open reserves a tab synchronously before discovery and then navigates", async () => {
  const events: string[] = [];
  let resolve: ((url: string) => void) | undefined;
  const loaded = new Promise<string>((done) => {
    resolve = done;
  });
  const result = openPublicLink(
    () => {
      events.push("load");
      return loaded;
    },
    () => {
      events.push("open");
      return { navigate: (url) => events.push(url), close: () => events.push("close") };
    },
  );
  assert.deepEqual(events, ["open", "load"]);
  resolve?.("https://public.example.com/a/example");
  await result;
  assert.deepEqual(events, ["open", "load", "https://public.example.com/a/example"]);
});

test("failed public discovery closes its reserved tab without navigating", async () => {
  const events: string[] = [];
  await assert.rejects(
    openPublicLink(
      async () => {
        throw new Error("offline");
      },
      () => ({
        navigate: () => events.push("navigate"),
        close: () => events.push("close"),
      }),
    ),
    /offline/,
  );
  assert.deepEqual(events, ["close"]);
});

test("a blocked popup does not start discovery", async () => {
  let loaded = false;
  await assert.rejects(
    openPublicLink(
      async () => {
        loaded = true;
        return "unused";
      },
      () => null,
    ),
    /blocked/,
  );
  assert.equal(loaded, false);
});

test("a blocked popup is told apart so the link can be copied instead", async () => {
  await assert.rejects(
    openPublicLink(
      async () => "unused",
      () => null,
    ),
    (e) => e instanceof PopupBlockedError,
  );
});

test("ENLACE-PUBLICO-1 · an address that is up is used as is, nothing is switched on", async () => {
  let activated = false;
  const url = await ensurePublicLink("/a/x", {
    read: async () => ({ url: "https://p.example.com", mode: "custom" }),
    activate: async () => {
      activated = true;
      return undefined;
    },
  });
  assert.equal(url, "https://p.example.com/a/x");
  assert.equal(activated, false);
});

test("ENLACE-PUBLICO-1 · with no public address the temporary link is switched on right there", async () => {
  const url = await ensurePublicLink("/a/x", {
    read: async () => ({ mode: "off" }),
    activate: async () => ({ url: "https://t.trycloudflare.com", mode: "cloudflare" }),
  });
  assert.equal(url, "https://t.trycloudflare.com/a/x");
});

test("ENLACE-PUBLICO-1 · a failed switch-on says why", async () => {
  await assert.rejects(
    ensurePublicLink("/a/x", {
      read: async () => ({ mode: "off" }),
      activate: async () => ({ mode: "cloudflare", error: "cloudflare_download" }),
    }),
    (e) => e instanceof PublicLinkError && e.reason === "cloudflare_download",
  );
  await assert.rejects(
    ensurePublicLink("/a/x", { read: async () => undefined, activate: async () => undefined }),
    (e) => e instanceof PublicLinkError && e.reason === "failed",
  );
});

test("ENLACE-PUBLICO-1 · an address the owner chose is never replaced when it is down", async () => {
  let activated = false;
  await assert.rejects(
    ensurePublicLink("/a/x", {
      read: async () => ({ mode: "ngrok", error: "ngrok_failed" }),
      activate: async () => {
        activated = true;
        return undefined;
      },
    }),
    (e) => e instanceof PublicLinkError && e.reason === "ngrok_failed",
  );
  assert.equal(activated, false);
});
