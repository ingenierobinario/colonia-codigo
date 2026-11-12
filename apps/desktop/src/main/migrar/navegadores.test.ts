import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
  descubrirFuentes,
  leerFuente,
  limpiarUrl,
  marcadoresChromium,
  nombresChromium,
  nombresFirefox,
  sitiosMasVisitados,
} from "./navegadores.ts";

const carpeta = (t: { after(fn: () => void): void }) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "colonia-test-nav-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const huella = (f: string) => createHash("sha256").update(fs.readFileSync(f)).digest("hex");

const BOOKMARKS = JSON.stringify({
  roots: {
    bookmark_bar: {
      type: "folder",
      children: [
        { type: "url", name: "Correo", url: "https://mail.google.com/mail/u/0/#inbox?token=secreto" },
        {
          type: "folder",
          name: "Trabajo",
          children: [{ type: "url", name: "Notion", url: "https://www.notion.so/ws" }],
        },
        { type: "url", name: "Atajo", url: "javascript:alert(1)" },
      ],
    },
    other: { type: "folder", children: [{ type: "url", name: "Chat", url: "https://app.slack.com/client/T1" }] },
  },
});

test("los marcadores de Chromium se aplanan, sin consulta ni fragmento y solo http(s)", () => {
  const m = marcadoresChromium(BOOKMARKS);
  assert.deepEqual(
    m.map((x) => x.url),
    ["https://mail.google.com/mail/u/0/", "https://www.notion.so/ws", "https://app.slack.com/client/T1"],
  );
  assert.equal(marcadoresChromium("no es json").length, 0);
  assert.equal(limpiarUrl("https://u:p@host.example/a?x=1#y"), "https://host.example/a");
});

test("las webs más visitadas se suman por sitio y pierden la ruta", () => {
  const top = sitiosMasVisitados([
    { url: "https://mail.google.com/a?q=1", visitas: 5 },
    { url: "https://mail.google.com/b", visitas: 7 },
    { url: "https://otra.example/", visitas: 3 },
    { url: "chrome://settings", visitas: 99 },
  ]);
  assert.deepEqual(top, [
    { host: "mail.google.com", visitas: 12 },
    { host: "otra.example", visitas: 3 },
  ]);
});

test("Chrome se descubre por su carpeta y se leen sus marcadores", (t) => {
  const home = carpeta(t);
  const perfil = path.join(home, "AppData", "Local", "Google", "Chrome", "User Data", "Default");
  fs.mkdirSync(perfil, { recursive: true });
  fs.writeFileSync(path.join(perfil, "Bookmarks"), BOOKMARKS);
  const fuentes = descubrirFuentes({ platform: "win32", home });
  assert.deepEqual(
    fuentes.map((f) => f.id),
    ["chrome:Default"],
  );
  const r = leerFuente(fuentes[0] as (typeof fuentes)[number]);
  assert.equal(r.marcadores.length, 3);
  assert.equal(r.visitadasNoDisponibles, true); // sin History: se declara, no se inventa
});

test("Firefox: places.sqlite se lee en una copia de solo lectura y el original queda intacto", (t) => {
  const home = carpeta(t);
  const perfil = path.join(home, "Library", "Application Support", "Firefox", "Profiles", "ab12.default-release");
  fs.mkdirSync(perfil, { recursive: true });
  const original = path.join(perfil, "places.sqlite");
  const db = new DatabaseSync(original);
  db.exec(`CREATE TABLE moz_places (id INTEGER PRIMARY KEY, url TEXT, visit_count INTEGER);
    CREATE TABLE moz_bookmarks (id INTEGER PRIMARY KEY, type INTEGER, fk INTEGER, title TEXT);
    INSERT INTO moz_places VALUES (1, 'https://outlook.office.com/mail/inbox?x=1', 40), (2, 'https://example.com/', 2),
      (3, 'place:sort=8', 0);
    INSERT INTO moz_bookmarks VALUES (1, 1, 1, 'Outlook'), (2, 2, NULL, 'carpeta'), (3, 1, 3, 'consulta interna');`);
  db.close();
  const antes = huella(original);
  const tmpAntes = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith("colonia-importar-"));
  const fuentes = descubrirFuentes({ platform: "darwin", home });
  assert.equal(fuentes[0]?.navegador, "firefox");
  const r = leerFuente(fuentes[0] as (typeof fuentes)[number]);
  assert.deepEqual(r.marcadores, [{ titulo: "Outlook", url: "https://outlook.office.com/mail/inbox" }]);
  assert.deepEqual(
    r.visitadas.map((v) => v.host),
    ["outlook.office.com", "example.com"],
  );
  assert.equal(huella(original), antes, "el original no se modifica");
  const tmpDespues = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith("colonia-importar-"));
  assert.deepEqual(tmpDespues, tmpAntes, "la copia temporal se borra");
});

test("una base bloqueada o ilegible no rompe: marcadores sí, visitadas declaradas no disponibles", (t) => {
  const home = carpeta(t);
  const perfil = path.join(home, ".config", "microsoft-edge", "Default");
  fs.mkdirSync(perfil, { recursive: true });
  fs.writeFileSync(path.join(perfil, "Bookmarks"), BOOKMARKS);
  fs.writeFileSync(path.join(perfil, "History"), "esto no es sqlite");
  const [f] = descubrirFuentes({ platform: "linux", home });
  assert.equal(f?.navegador, "edge");
  const r = leerFuente(f as NonNullable<typeof f>);
  assert.equal(r.marcadores.length, 3);
  assert.equal(r.visitadasNoDisponibles, true);
});

test("PERFIL-NOMBRE-1: el nombre real de cada perfil sale de Local State y de profiles.ini", (t) => {
  const home = carpeta(t);
  const base = path.join(home, ".config", "google-chrome");
  for (const p of ["Default", "Profile 3"]) {
    fs.mkdirSync(path.join(base, p), { recursive: true });
    fs.writeFileSync(path.join(base, p, "Bookmarks"), BOOKMARKS);
  }
  fs.writeFileSync(
    path.join(base, "Local State"),
    JSON.stringify({
      profile: {
        info_cache: {
          Default: { name: "Trabajo", gaia_name: "Alex D", user_name: "alex@empresa.com" },
          "Profile 3": { name: "", gaia_name: "Alex Personal", user_name: "" },
        },
      },
    }),
  );
  const ff = path.join(home, ".mozilla", "firefox");
  fs.mkdirSync(path.join(ff, "ab12.default-release"), { recursive: true });
  fs.writeFileSync(path.join(ff, "ab12.default-release", "places.sqlite"), "");
  fs.writeFileSync(
    path.join(ff, "profiles.ini"),
    "[General]\nStartWithLastProfile=1\n\n[Profile0]\nName=Casa\nIsRelative=1\nPath=ab12.default-release\n",
  );
  const fuentes = descubrirFuentes({ platform: "linux", home });
  assert.deepEqual(
    fuentes.map(({ id, nombre, email }) => ({ id, nombre, email })),
    [
      { id: "chrome:Default", nombre: "Trabajo", email: "alex@empresa.com" },
      { id: "chrome:Profile 3", nombre: "Alex Personal", email: undefined },
      { id: "firefox:ab12.default-release", nombre: "Casa", email: undefined },
    ],
  );
  assert.deepEqual(nombresChromium("roto"), {});
  assert.deepEqual(nombresFirefox("[Profile0]\nName=Win\nPath=Profiles/xy.default\n"), { "xy.default": "Win" });
  assert.deepEqual(nombresFirefox("[Profile0]\nName=Win\nPath=C:\\P\\zz.default\n"), { "zz.default": "Win" });
});
