// WEBAPP-BLANCO-1: when the desktop app takes the browser over from the core's headless one (or gives it back), the
// panels learn the new backend's tabs at once, so a web app never keeps pointing at a tab ("h1") nobody shows.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { CoreEvent, TabInfo } from "@colonia/protocol";
import { createBus } from "../bus.ts";
import type { NodeBroker } from "../nodes/broker.ts";
import type { HeadlessBrowser } from "../nodes/headless-browser.ts";
import { browserHandlers } from "./browser.ts";

const tab = (id: string): TabInfo => ({
  tab: id,
  url: "https://example.com/",
  title: id,
  profile: "app:business-stack",
  control: { kind: "idle" },
});

function fakes() {
  const listeners = new Set<() => void>();
  let node: { caps: string[] } | undefined;
  const desktopTabs = [tab("t1")];
  const broker = {
    withCap: (cap: string) => (node?.caps.includes(cap) ? node : undefined),
    invoke: async (_cap: string, method: string) => {
      assert.equal(method, "browser.tabs");
      return { tabs: desktopTabs };
    },
    onConnectionChange(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    onEvent: () => () => {},
  } as unknown as NodeBroker;
  const headless = {
    available: () => true,
    running: () => true,
    handle: async () => ({ tabs: [tab("h1"), tab("h2")] }),
  } as unknown as HeadlessBrowser;
  const bus = createBus();
  const seen: TabInfo[][] = [];
  bus.on((e: CoreEvent) => {
    if (e.type === "browser.tabs") seen.push(e.tabs);
  });
  const connect = () => {
    node = { caps: ["browser"] };
    for (const l of listeners) l();
  };
  const disconnect = () => {
    node = undefined;
    for (const l of listeners) l();
  };
  return { broker, headless, bus, seen, connect, disconnect };
}

const settle = () => new Promise((r) => setImmediate(r));

test("the desktop taking the browser over replaces the headless tabs the panels list", async () => {
  const f = fakes();
  browserHandlers(f.broker, f.headless, f.bus);
  f.connect();
  await settle();
  assert.deepEqual(
    f.seen.map((tabs) => tabs.map((t) => t.tab)),
    [["t1"]],
  );
});

test("the desktop leaving hands the panels the headless browser's tabs again", async () => {
  const f = fakes();
  f.connect();
  browserHandlers(f.broker, f.headless, f.bus);
  f.disconnect();
  await settle();
  assert.deepEqual(
    f.seen.map((tabs) => tabs.map((t) => t.tab)),
    [["h1", "h2"]],
  );
});
