import assert from "node:assert/strict";
import { test } from "node:test";
import type { ColoniaClient } from "@colonia/protocol/client";
import { equipo } from "./equipo.ts";

function fake(state: Record<string, unknown>) {
  const calls: [string, unknown][] = [];
  const client = {
    call: async (m: string, p: unknown) => {
      calls.push([m, p]);
      if (m === "equipos.local_state")
        return {
          paired: false,
          connected: false,
          locked: false,
          always_allow: false,
          pending: [],
          audit: [],
          ...state,
        };
      if (m === "equipos.local_pair") return { name: "Portátil" };
      return {};
    },
  } as unknown as ColoniaClient;
  return { client, calls };
}

test("emparejar pide el código por la terminal y nunca lo toma de los argumentos", async () => {
  const { client, calls } = fake({ needs_passphrase: false });
  const asked: string[] = [];
  await equipo(client, ["emparejar", "ws://x:1", "huella-larga"], async (q) => (asked.push(q), "123456"));
  assert.equal(asked.length, 1);
  assert.deepEqual(calls[1], ["equipos.local_pair", { url: "ws://x:1", fingerprint: "huella-larga", code: "123456" }]);
});

test("sin almacén del sistema pide contraseña y rechaza una corta sin gastar el código", async () => {
  const { client, calls } = fake({ needs_passphrase: true });
  await assert.rejects(
    equipo(client, ["emparejar", "ws://x:1", "huella-larga"], async () => "corta"),
    /8 caracteres/,
  );
  assert.equal(
    calls.some(([m]) => m === "equipos.local_pair"),
    false,
  );
});

test("comandos mal formados no llaman al core", async () => {
  const { client, calls } = fake({});
  await assert.rejects(equipo(client, ["emparejar"]), /colonia equipo/);
  await assert.rejects(equipo(client, ["bailar"]), /colonia equipo/);
  assert.equal(calls.length, 0);
});
