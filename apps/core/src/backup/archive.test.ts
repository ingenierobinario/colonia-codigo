// COPIA-COMPLETA-1 · El archivo de la copia: lo que se guarda vuelve igual, nada se lee en claro, y un archivo que no
// es una copia, una contraseña mala o un archivo dañado dan cada uno su motivo.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { tempDir } from "../testkit/platform.ts";
import { ArchiveError, MAGIC, readArchive, writeArchive } from "./archive.ts";

const PASSWORD = "clave-de-la-copia";
const INFO = { created_at: "2026-11-16T10:00:00.000Z", app_version: "0.0.0" };

async function readAll(file: string, password: string): Promise<Map<string, Buffer>> {
  const out = new Map<string, Buffer>();
  await readArchive(file, password, (meta) => {
    const parts: Buffer[] = [];
    return { write: (b) => parts.push(Buffer.from(b)), end: () => out.set(meta.p, Buffer.concat(parts)) };
  });
  return out;
}

const whyOf = async (work: Promise<unknown>): Promise<string> => {
  try {
    await work;
  } catch (err) {
    if (err instanceof ArchiveError) return err.why;
    throw err;
  }
  return "ok";
};

test("una copia guarda sus entradas cifradas y las devuelve iguales", async () => {
  const tmp = tempDir("colonia-copia-");
  const dir = tmp.path;
  try {
    const file = path.join(dir, "a.colonia");
    const marca = "texto-reconocible-que-no-debe-verse-0001";
    // Más de un trozo (1 MiB), con datos que no se comprimen, y un fichero leído del disco.
    const grande = randomBytes(2_500_000);
    const suelto = path.join(dir, "suelto.bin");
    fs.writeFileSync(suelto, Buffer.concat([Buffer.from(marca.repeat(50)), randomBytes(70_000)]));
    const w = await writeArchive(file, PASSWORD, INFO);
    await w.add("manifest.json", Buffer.from(JSON.stringify({ marca })));
    await w.add("vacio", Buffer.alloc(0));
    await w.add("home/grande.bin", grande);
    await w.addFile("home/suelto.bin", suelto);
    await w.close();

    const raw = fs.readFileSync(file);
    assert.ok(raw.subarray(0, MAGIC.length).equals(MAGIC));
    assert.ok(!raw.includes(Buffer.from(marca)), "el contenido no se lee en claro");
    assert.ok(!raw.includes(Buffer.from("manifest.json")), "ni los nombres de lo que lleva");
    assert.ok(!raw.includes(Buffer.from(PASSWORD)));

    const got = await readAll(file, PASSWORD);
    assert.deepEqual([...got.keys()], ["manifest.json", "vacio", "home/grande.bin", "home/suelto.bin"]);
    assert.equal(got.get("vacio")?.length, 0);
    assert.ok(got.get("home/grande.bin")?.equals(grande));
    assert.ok(got.get("home/suelto.bin")?.equals(fs.readFileSync(suelto)));

    // Leer solo el principio no obliga a descifrar el resto.
    const seen: string[] = [];
    await readArchive(file, PASSWORD, (meta) => {
      seen.push(meta.p);
      return "stop";
    });
    assert.deepEqual(seen, ["manifest.json"]);
  } finally {
    await tmp.remove();
  }
});

test("cada fallo de una copia tiene su motivo", async () => {
  const tmp = tempDir("colonia-copia-");
  const dir = tmp.path;
  try {
    const file = path.join(dir, "a.colonia");
    const w = await writeArchive(file, PASSWORD, INFO);
    await w.add("manifest.json", Buffer.from("{}"));
    await w.add("home/datos.bin", randomBytes(1_600_000));
    await w.close();
    const raw = fs.readFileSync(file);

    assert.equal(await whyOf(readAll(file, "otra-contraseña")), "password");
    assert.equal(await whyOf(readAll(file, PASSWORD)), "ok");

    const ajeno = path.join(dir, "ajeno.colonia");
    fs.writeFileSync(ajeno, "esto no es una copia de Colonia, es un texto cualquiera\n".repeat(20));
    assert.equal(await whyOf(readAll(ajeno, PASSWORD)), "foreign");
    assert.equal(await whyOf(readAll(path.join(dir, "no-existe.colonia"), PASSWORD)), "foreign");

    const cortado = path.join(dir, "cortado.colonia");
    fs.writeFileSync(cortado, raw.subarray(0, raw.length - 700_000));
    assert.equal(await whyOf(readAll(cortado, PASSWORD)), "broken");

    // Un solo byte cambiado en mitad del archivo.
    const tocado = path.join(dir, "tocado.colonia");
    const flipped = Buffer.from(raw);
    const at = raw.length - 300_000;
    flipped[at] = (flipped[at] ?? 0) ^ 0xff;
    fs.writeFileSync(tocado, flipped);
    assert.equal(await whyOf(readAll(tocado, PASSWORD)), "broken");

    // Una copia hecha por un Colonia más nuevo se reconoce sin contraseña.
    const headerLen = raw.readUInt32BE(MAGIC.length);
    const header = JSON.parse(raw.subarray(MAGIC.length + 4, MAGIC.length + 4 + headerLen).toString("utf8"));
    const nuevaCab = Buffer.from(JSON.stringify({ ...header, v: 99 }));
    const len = Buffer.alloc(4);
    len.writeUInt32BE(nuevaCab.length);
    const nueva = path.join(dir, "nueva.colonia");
    fs.writeFileSync(nueva, Buffer.concat([MAGIC, len, nuevaCab, raw.subarray(MAGIC.length + 4 + headerLen)]));
    assert.equal(await whyOf(readAll(nueva, PASSWORD)), "newer");

    // La cabecera va atada al contenido: cambiarla invalida la copia aunque la contraseña sea buena.
    const otraCab = Buffer.from(JSON.stringify({ ...header, app_version: "9.9.9" }));
    len.writeUInt32BE(otraCab.length);
    const manipulada = path.join(dir, "manipulada.colonia");
    fs.writeFileSync(manipulada, Buffer.concat([MAGIC, len, otraCab, raw.subarray(MAGIC.length + 4 + headerLen)]));
    assert.notEqual(await whyOf(readAll(manipulada, PASSWORD)), "ok");
  } finally {
    await tmp.remove();
  }
});
