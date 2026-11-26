import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fakeWhatsApp } from "../channels/fake-whatsapp.test-support.ts";
import { whatsappAdapter } from "../channels/whatsapp.ts";
import { say, scriptedLlm, startCore, texts } from "../engine/testkit.ts";
import { tempDir, waitFor } from "../testkit/platform.ts";
import { sessionFixture } from "./whatsapp-handoff.test-support.ts";

process.env.COLONIA_SYNC_BEACON_PORT = "47649";

test("the server receives WhatsApp with the desktop closed and synchronizes the conversation when it returns", async () => {
  const desktopHome = tempDir("colonia-wa-desktop-");
  const serverHome = tempDir("colonia-wa-server-");
  const phone = fakeWhatsApp();
  const localPhone = fakeWhatsApp();
  const llm = scriptedLlm(() => say("Received"));
  const bootDesktop = () =>
    startCore({
      home: desktopHome.path,
      llm,
      channelAdapters: {
        whatsapp: (c) =>
          whatsappAdapter({ dir: path.join(desktopHome.path, "channels", c.id), lib: async () => localPhone.lib }),
      },
    });
  let desktop = await bootDesktop();
  const server = await startCore({
    home: serverHome.path,
    llm,
    channelAdapters: {
      whatsapp: (c) =>
        whatsappAdapter({ dir: path.join(serverHome.path, "channels", c.id), lib: async () => phone.lib }),
    },
  });
  const wait = <T>(check: () => T | Promise<T>, why: string) => waitFor(check, why, { ms: 60_000, every: 50 });
  try {
    const invitation = await server.client.call("sync.pair_start", { initial_source: "joining_device" });
    assert.ok(invitation.pairing);
    await desktop.client.call("sync.pair_join", { address: server.core.url, code: invitation.pairing.code });
    const session = path.join(desktopHome.path, "channels", "whatsapp");
    fs.mkdirSync(session, { recursive: true });
    for (const file of sessionFixture()) fs.writeFileSync(path.join(session, file.name), file.text);
    await desktop.client.call("channels.set", {
      id: "whatsapp",
      channel: { type: "whatsapp", agent_id: "superagent", read_only: true },
    });
    await desktop.client.call("sync.now", {});
    await wait(
      async () =>
        (await server.client.call("channels.list", {})).channels.some(
          (c) => c.id === "whatsapp" && c.status === "running",
        ),
      "the server opens the transferred session without a QR",
    );
    assert.equal(localPhone.sockets, 0, "the source never opens a duplicate session");
    assert.equal(phone.sockets, 1);
    assert.equal(fs.existsSync(session), false);
    await desktop.core.close();
    phone.message({ phone: "5491100000002@s.whatsapp.net", name: "Customer" }, "Arrived while the computer was off");
    const remoteThread = await wait(
      async () =>
        (await server.client.call("threads.list", {})).threads.find((thread) => thread.channel?.id === "whatsapp"),
      "the server keeps the incoming conversation",
    );
    await wait(
      async () =>
        texts((await server.client.call("threads.get", { thread: remoteThread.id })).messages).includes(
          "Arrived while the computer was off",
        ),
      "the incoming message is persisted",
    );
    desktop = await bootDesktop();
    await wait(async () => {
      const threads = (await desktop.client.call("threads.list", {})).threads;
      if (!threads.some((thread) => thread.id === remoteThread.id)) return false;
      return texts((await desktop.client.call("threads.get", { thread: remoteThread.id })).messages).includes(
        "Arrived while the computer was off",
      );
    }, "the desktop automatically catches up after reopening");
    assert.equal(localPhone.sockets, 0);
    assert.equal(phone.sockets, 1);
  } finally {
    await desktop.core.close();
    await server.core.close();
    await desktopHome.remove();
    await serverHome.remove();
  }
});
