import assert from "node:assert/strict";
import { test } from "node:test";
import { tempDir } from "../testkit/platform.ts";
import { fakeWhatsApp } from "./fake-whatsapp.test-support.ts";
import { type WaLib, whatsappAdapter } from "./whatsapp.ts";

test("stopping WhatsApp waits for the socket's asynchronous close", async (t) => {
  const dir = tempDir("colonia-wa-close-");
  const fake = fakeWhatsApp();
  const closing = Promise.withResolvers<void>();
  const closed = Promise.withResolvers<void>();
  const lib: WaLib = {
    ...fake.lib,
    makeWASocket(options) {
      const socket = fake.lib.makeWASocket(options);
      const end = socket.end.bind(socket);
      socket.end = async () => {
        closing.resolve();
        await closed.promise;
        await end();
      };
      return socket;
    },
  };
  const adapter = whatsappAdapter({ dir: dir.path, lib: async () => lib });
  t.after(async () => {
    closed.resolve();
    await adapter.stop();
    await dir.remove();
  });
  await adapter.start({
    receive: () => {},
    action: () => {},
    status: () => {},
    signal: new AbortController().signal,
  });
  let stopped = false;
  const stopping = adapter.stop().then(() => {
    stopped = true;
  });
  await closing.promise;
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(stopped, false, "the close has started but its socket is not closed yet");
  closed.resolve();
  await stopping;
  assert.equal(stopped, true);
});
