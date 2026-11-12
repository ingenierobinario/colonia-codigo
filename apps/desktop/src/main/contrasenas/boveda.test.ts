import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { type CajaSecreta, crearBoveda, origenDe } from "./boveda.ts";

// Cifrado de prueba: invierte los bytes y los marca. Basta para comprobar que el disco nunca ve el texto.
const cajaFalsa = (disponible = true): CajaSecreta => ({
  disponible: () => disponible,
  cifrar: (t) => Buffer.from(`ENC:${Buffer.from(t).reverse().toString("latin1")}`, "latin1"),
  descifrar: (d) => Buffer.from(d.toString("latin1").slice(4), "latin1").reverse().toString(),
});

const montar = (t: { after(fn: () => void): void }, caja = cajaFalsa()) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "colonia-test-boveda-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const archivo = path.join(dir, "logins.json");
  return { dir, archivo, b: crearBoveda({ archivo, caja }) };
};
const ENT = { app: "a1", origen: "https://mail.example.com", usuario: "ana@example.com", contrasena: "Sup3r-secreta!" };

test("el origen es esquema + host + puerto, y solo http(s)", () => {
  assert.equal(origenDe("https://mail.example.com/x?y=1"), "https://mail.example.com");
  assert.equal(origenDe("https://mail.example.com:443/"), "https://mail.example.com");
  assert.equal(origenDe("https://mail.example.com:8443/"), "https://mail.example.com:8443");
  assert.equal(origenDe("file:///etc/passwd"), undefined);
  assert.equal(origenDe("no es url"), undefined);
});

test("no rellena en otro origen, otro puerto, otro esquema ni otra aplicación", (t) => {
  const { b } = montar(t);
  assert.equal(b.guardar(ENT), "guardada");
  assert.equal(b.buscar("a1", "https://mail.example.com")?.contrasena, ENT.contrasena);
  assert.equal(b.buscar("a1", "https://mail.example.com:8443"), undefined);
  assert.equal(b.buscar("a1", "http://mail.example.com"), undefined);
  assert.equal(b.buscar("a1", "https://mail.example.com.evil.test"), undefined);
  assert.equal(b.buscar("a1", "https://evil.test"), undefined);
  assert.equal(b.buscar("a2", "https://mail.example.com"), undefined, "otra partición");
});

test("no hay texto plano en el disco", (t) => {
  const { dir, archivo, b } = montar(t);
  b.guardar(ENT);
  b.nunca("a1", "https://otra.example.com");
  for (const f of fs.readdirSync(dir)) {
    const bytes = fs.readFileSync(path.join(dir, f)).toString("latin1");
    assert.ok(!bytes.includes(ENT.contrasena), `${f} contiene la contraseña`);
    assert.ok(!bytes.includes(ENT.usuario), `${f} contiene el usuario`);
  }
  assert.ok(fs.existsSync(archivo));
});

test("si el sistema no puede cifrar, no se guarda nada", (t) => {
  const { archivo, b } = montar(t, cajaFalsa(false));
  assert.equal(b.guardar(ENT), "no-disponible");
  assert.equal(fs.existsSync(archivo), false);
  assert.deepEqual(b.lista(), []);
  assert.equal(b.buscar("a1", ENT.origen), undefined);
});

test("borrar funciona: una entrada, y todas las de una aplicación", (t) => {
  const { archivo, b } = montar(t);
  b.guardar(ENT);
  b.guardar({ ...ENT, usuario: "luis@example.com" });
  b.guardar({ ...ENT, app: "a2" });
  const [primera] = b.lista();
  assert.equal(b.lista().length, 3);
  assert.equal(b.borrar((primera as NonNullable<typeof primera>).id), true);
  assert.equal(b.borrar("no-existe"), false);
  assert.equal(b.lista().length, 2);
  assert.equal(b.borrarApp("a1") + b.borrarApp("a2") > 0, true);
  assert.deepEqual(b.lista(), []);
  assert.ok(!fs.readFileSync(archivo, "utf8").includes('"blob":"'), "no queda ningún secreto");
});

test("la lista no lleva contraseñas; revelar sí la devuelve; cambiarla actualiza", (t) => {
  const { b } = montar(t);
  b.guardar(ENT);
  assert.equal(b.estado("a1", ENT.origen, ENT.usuario, ENT.contrasena), "igual");
  assert.equal(b.estado("a1", ENT.origen, ENT.usuario, "otra"), "cambia");
  assert.equal(b.estado("a1", ENT.origen, "nuevo@example.com", "x"), "nueva");
  assert.equal(b.guardar({ ...ENT, contrasena: "otra" }), "actualizada");
  assert.equal(b.lista().length, 1);
  const [e] = b.lista();
  assert.ok(!JSON.stringify(e).includes("otra"));
  assert.equal(b.revelar((e as NonNullable<typeof e>).id), "otra");
});

test("«nunca para este sitio» se recuerda y un origen inválido se rechaza", (t) => {
  const { b } = montar(t);
  assert.equal(b.esNunca("a1", ENT.origen), false);
  b.nunca("a1", ENT.origen);
  assert.equal(b.esNunca("a1", ENT.origen), true);
  assert.equal(b.guardar({ ...ENT, origen: "https://mail.example.com/ruta" }), "rechazada");
  assert.equal(b.guardar({ ...ENT, contrasena: "" }), "rechazada");
});
