import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { type CajaSecreta, crearBoveda } from "./boveda.ts";
import { crearGuardian, type Oferta } from "./guardian.ts";

const caja: CajaSecreta = {
  disponible: () => true,
  cifrar: (t) => Buffer.from(`ENC:${Buffer.from(t).reverse().toString("latin1")}`, "latin1"),
  descifrar: (d) => Buffer.from(d.toString("latin1").slice(4), "latin1").reverse().toString(),
};

const montar = (t: { after(fn: () => void): void }) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "colonia-test-guardian-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const b = crearBoveda({ archivo: path.join(dir, "l.json"), caja });
  const ofertas: Oferta[] = [];
  return { b, ofertas, g: crearGuardian(b, (o) => ofertas.push(o)) };
};

test("se ofrece guardar, la oferta no lleva la contraseña y al aceptar se rellena solo en ese origen", (t) => {
  const { g, ofertas } = montar(t);
  g.capturar("a1", "https://mail.example.com/login?x=1", "ana", "clave-1");
  assert.equal(ofertas.length, 1);
  assert.ok(!JSON.stringify(ofertas[0]).includes("clave-1"));
  assert.equal(g.sondear("a1", "https://mail.example.com/"), undefined, "sin aceptar no hay nada guardado");
  assert.equal(g.responder((ofertas[0] as Oferta).id, "guardar"), "guardada");
  assert.deepEqual(g.sondear("a1", "https://mail.example.com/otra"), { usuario: "ana", contrasena: "clave-1" });
  assert.equal(g.sondear("a1", "https://evil.example.com/"), undefined);
  assert.equal(g.sondear("a1", "http://mail.example.com/"), undefined);
  assert.equal(g.sondear("a2", "https://mail.example.com/"), undefined);
});

test("no se vuelve a ofrecer lo ya guardado, «nunca» se respeta y lo que no es web se ignora", (t) => {
  const { g, ofertas } = montar(t);
  g.capturar("a1", "https://x.example.com/", "ana", "c1");
  g.responder((ofertas[0] as Oferta).id, "guardar");
  g.capturar("a1", "https://x.example.com/", "ana", "c1");
  assert.equal(ofertas.length, 1);
  g.capturar("a1", "https://x.example.com/", "ana", "c2");
  assert.equal(ofertas[1]?.cambia, true);
  g.responder((ofertas[1] as Oferta).id, "nunca");
  g.capturar("a1", "https://x.example.com/", "luis", "c3");
  assert.equal(ofertas.length, 2, "tras «nunca» no se ofrece más");
  g.capturar("a1", "file:///etc/passwd", "ana", "c1");
  g.capturar("a1", "https://y.example.com/", 5, "c1");
  assert.equal(ofertas.length, 2);
});

test("una oferta caducada o repetida no guarda nada", (t) => {
  let ahora = 1000;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "colonia-test-guardian-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const b = crearBoveda({ archivo: path.join(dir, "l.json"), caja });
  const ofertas: Oferta[] = [];
  const g = crearGuardian(
    b,
    (o) => ofertas.push(o),
    () => ahora,
  );
  g.capturar("a1", "https://x.example.com/", "ana", "c1");
  ahora += 6 * 60_000;
  assert.equal(g.responder((ofertas[0] as Oferta).id, "guardar"), "descartada");
  assert.deepEqual(b.lista(), []);
  assert.equal(g.responder("o99", "guardar"), "descartada");
});
