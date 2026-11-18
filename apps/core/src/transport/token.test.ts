import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { ColoniaClient, ColoniaError } from "@colonia/protocol/client";
import { WebSocket as Peer } from "ws";
import { testConfig } from "../config.ts";
import { say, scriptedLlm } from "../engine/testkit.ts";
import { createCore } from "../server.ts";
import { removeDir } from "../testkit/platform.ts";

const TOKEN = "core-token-for-tests";
let core: Awaited<ReturnType<typeof createCore>>;
let home = "";

before(async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "colonia-token-"));
  core = await createCore(
    { ...testConfig({ home }), token: TOKEN },
    { quiet: true, llm: scriptedLlm(() => say("ok")) },
  );
});
after(async () => {
  await core.close();
  await removeDir(home);
});

test("with a core token, an outside app's client token is enough; without either the core refuses", async () => {
  const owner = new ColoniaClient({ url: core.url, token: TOKEN });
  const { token } = await owner.call("clients.create", { name: "Claude Code", scopes: ["chat"] });
  const app = new ColoniaClient({ url: core.url, clientToken: token });
  assert.ok((await app.call("agents.list", {})).agents.length > 0);
  const nobody = new ColoniaClient({ url: core.url });
  await assert.rejects(
    nobody.call("agents.list", {}),
    (e: unknown) => e instanceof ColoniaError && /bad token/.test(e.message),
  );
  const forged = new ColoniaClient({ url: core.url, clientToken: `coloniac_${"0".repeat(48)}` });
  await assert.rejects(
    forged.call("agents.list", {}),
    (e: unknown) => e instanceof ColoniaError && /token/.test(e.message),
  );
  // The client token stands in for the core's, never for the owner: owner-only calls stay closed.
  await assert.rejects(app.call("clients.list", {}), (e: unknown) => e instanceof ColoniaError);
});

test("el panel vinculado conserva su identidad y la conexión deja de funcionar al revocarla", async () => {
  const owner = new ColoniaClient({ url: core.url, token: TOKEN });
  const { code } = await owner.call("devices.pair_start", {});
  const { token, device } = await owner.call("devices.pair", { code, name: "Navegador de prueba", platform: "other" });
  const panel = new ColoniaClient({ url: core.url, token, socketAuth: "subprotocol" });
  const socket = await panel.connect();
  try {
    assert.equal(new URL(socket.url).search.length, 0);
    assert.equal((await socket.call("devices.set_push", { push: null })).id, device.id);
    assert.equal((await owner.call("devices.revoke", { id: device.id })).revoked, true);
    await assert.rejects(socket.call("devices.list", {}));
    await assert.rejects(panel.connect());
  } finally {
    socket.close();
  }
});

async function negotiatedProtocol(url: string, protocols: string[]) {
  const ws = new WebSocket(url, protocols);
  try {
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve(), { once: true });
      ws.addEventListener("error", () => reject(new Error("Conexión rechazada")), { once: true });
    });
    return ws.protocol;
  } finally {
    ws.close();
  }
}

test("solo se negocia el nombre público del protocolo del panel", async () => {
  const url = `${core.url.replace(/^http/, "ws")}/ws`;
  assert.equal(await negotiatedProtocol(url, [`colonia.auth.${TOKEN}`, "colonia.v1"]), "colonia.v1");
});

test("un cliente anterior mantiene su URL y su subprotocolo", async () => {
  const url = `${core.url.replace(/^http/, "ws")}/ws?token=${encodeURIComponent(TOKEN)}`;
  assert.equal(await negotiatedProtocol(url, ["cliente.anterior"]), "cliente.anterior");
});

test("la negociación comprueba el origen y descarta credenciales ambiguas antes de aceptar el socket", async () => {
  const url = `${core.url.replace(/^http/, "ws")}/ws`;
  const offer = ["colonia.v1", `colonia.auth.${TOKEN}`];
  async function status(target: string, protocols: string[], origin: string) {
    const peer = new Peer(target, protocols, { origin });
    return new Promise<number>((resolve, reject) => {
      peer.once("open", () => {
        resolve(101);
        peer.close();
      });
      peer.once("unexpected-response", (_req, res) => {
        resolve(res.statusCode ?? 0);
        res.resume();
        peer.terminate();
      });
      peer.once("error", reject);
    });
  }
  assert.equal(await status(url, offer, "http://localhost:7441"), 101);
  assert.equal(await status(url, offer, "https://otro.example"), 403);
  assert.equal(await status(url, ["colonia.v1"], "http://localhost:7441"), 403);
  assert.equal(await status(url, ["colonia.v1", "colonia.auth.%"], "http://localhost:7441"), 403);
  assert.equal(await status(`${url}?token=otra-ficticia`, offer, "http://localhost:7441"), 403);
});

test("el token de un conector conserva sus permisos al negociar el nuevo protocolo", async () => {
  const owner = new ColoniaClient({ url: core.url, token: TOKEN });
  const { token } = await owner.call("clients.create", { name: "Conector de prueba", scopes: ["chat"] });
  const socket = await new ColoniaClient({ url: core.url, token, socketAuth: "subprotocol" }).connect();
  try {
    assert.equal(socket.welcome?.auth?.actor, "agent");
    await assert.rejects(socket.call("clients.list", {}), (error) => error instanceof ColoniaError);
  } finally {
    socket.close();
  }
});

test("a local core without a token still accepts repeated socket calls", async () => {
  const localHome = fs.mkdtempSync(path.join(os.tmpdir(), "colonia-local-socket-"));
  const local = await createCore(testConfig({ home: localHome }), { quiet: true });
  const socket = await new ColoniaClient({ url: local.url }).connect();
  try {
    assert.ok(Array.isArray((await socket.call("devices.list", {})).devices));
    assert.ok(Array.isArray((await socket.call("devices.list", {})).devices));
  } finally {
    socket.close();
    await socket.closed;
    await local.close();
    await removeDir(localHome);
  }
});

test("Google's return finishes without the core's token, yet only with a state this core signed", async () => {
  const nobody = new ColoniaClient({ url: core.url });
  await assert.rejects(
    nobody.call("integrations.oauth_finish", { code: "c", state: "forged.state" }),
    (e: unknown) => e instanceof ColoniaError && /not valid or expired/.test(e.message),
    "it reaches the handler, which refuses a state it did not sign",
  );
  await assert.rejects(
    nobody.call("integrations.oauth_start", { id: "google-calendar" }),
    (e: unknown) => e instanceof ColoniaError && /bad token/.test(e.message),
    "starting a sign-in stays the owner's",
  );
});
