import assert from "node:assert/strict";
import { test } from "node:test";
import { type Equipo, type EquipoLocal, THIS_EQUIPO_ID } from "@colonia/protocol";
import { ALIAS_MAX, aliasTaken, aliasToSave, cleanAlias, equipoEntries, realName } from "./equiposModel.ts";

const equipo = (over: Partial<Equipo>): Equipo => ({
  id: "eqp_1",
  name: "DESKTOP-ACME01",
  hostname: "DESKTOP-ACME01",
  platform: "windows",
  created_at: "2026-01-01T00:00:00.000Z",
  connected: false,
  agent_access: false,
  in_use: false,
  ...over,
});
const local: EquipoLocal = {
  name: "oficina-pc",
  hostname: "oficina-pc",
  platform: "windows",
  addresses: ["192.168.1.20"],
};

test("ESTE-EQUIPO-1: este ordenador va el primero aunque no haya ningún equipo conectado", () => {
  assert.deepEqual(equipoEntries(undefined), []);
  assert.deepEqual(equipoEntries({ equipos: [], local }), [
    { id: THIS_EQUIPO_ID, name: "oficina-pc", hostname: "oficina-pc", alias: undefined, self: true, connected: true },
  ]);
  const list = equipoEntries({ equipos: [equipo({}), equipo({ id: "eqp_2", name: "salon-pc" })], local });
  assert.deepEqual(
    list.map((e) => [e.id, e.self]),
    [
      [THIS_EQUIPO_ID, true],
      ["eqp_1", false],
      ["eqp_2", false],
    ],
  );
});

test("ESTE-EQUIPO-1: si este ordenador también está conectado como uno más, sale una sola vez y el primero", () => {
  const own = equipo({ id: "eqp_9", name: "oficina-pc", hostname: "oficina-pc", local: true, connected: true });
  const list = equipoEntries({ equipos: [equipo({}), own], local });
  assert.deepEqual(
    list.map((e) => [e.id, e.self]),
    [
      ["eqp_9", true],
      ["eqp_1", false],
    ],
  );
  assert.equal(list.filter((e) => e.self).length, 1);
});

test("ESTE-EQUIPO-1: un servidor anterior, que no dice cuál es este ordenador, deja la lista como estaba", () => {
  const old = equipo({ hostname: undefined });
  assert.deepEqual(equipoEntries({ equipos: [old] }), [
    {
      id: "eqp_1",
      name: "DESKTOP-ACME01",
      hostname: "DESKTOP-ACME01",
      alias: undefined,
      self: false,
      connected: false,
    },
  ]);
});

test("EQUIPOS-ALIAS-1: el nombre se limpia igual que en el servidor y vaciarlo devuelve el del equipo", () => {
  assert.equal(cleanAlias("  Portátil   de\nMarta "), "Portátil de Marta");
  assert.equal(cleanAlias("x".repeat(150)).length, ALIAS_MAX);
  const e = { hostname: "DESKTOP-ACME01" };
  assert.equal(aliasToSave("  Portátil de Marta ", e), "Portátil de Marta");
  assert.equal(aliasToSave("   ", e), "");
  assert.equal(aliasToSave("DESKTOP-ACME01", e), "");
});

test("EQUIPOS-ALIAS-1: no se puede repetir el nombre de otro equipo, pero sí conservar el propio", () => {
  const all = equipoEntries({
    equipos: [
      equipo({ name: "Portátil de Marta", alias: "Portátil de Marta" }),
      equipo({ id: "eqp_2", name: "salon-pc", hostname: "salon-pc" }),
    ],
    local,
  });
  assert.equal(aliasTaken("portátil  de MARTA", "eqp_2", all), true);
  assert.equal(aliasTaken("desktop-acme01", "eqp_2", all), true);
  assert.equal(aliasTaken("Oficina-PC", "eqp_2", all), true);
  assert.equal(aliasTaken("salon-pc", THIS_EQUIPO_ID, all), true);
  assert.equal(aliasTaken("Portátil de Marta", "eqp_1", all), false);
  assert.equal(aliasTaken("Sobremesa", "eqp_2", all), false);
  assert.equal(aliasTaken("   ", "eqp_2", all), false);
});

test("EQUIPOS-ALIAS-1: el nombre del propio equipo solo se enseña aparte cuando el visible es otro", () => {
  assert.equal(realName({ name: "Portátil de Marta", hostname: "DESKTOP-ACME01" }), "DESKTOP-ACME01");
  assert.equal(realName({ name: "DESKTOP-ACME01", hostname: "DESKTOP-ACME01" }), undefined);
});
