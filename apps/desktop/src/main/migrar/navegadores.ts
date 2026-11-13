// Importar desde el navegador habitual: SOLO marcadores y las webs más visitadas, de los ficheros locales del
// propio usuario (Chrome, Edge, Brave, Firefox). Nunca se abren cookies, sesiones ni contraseñas, y no se lee nada
// hasta que el usuario pulsa «Importar»: el descubrimiento solo comprueba que existan las carpetas.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export type Familia = "chromium" | "firefox";
export type Navegador = "chrome" | "edge" | "brave" | "firefox";

export type FuenteImportar = {
  id: string;
  navegador: Navegador;
  /** Nombre de la carpeta del perfil («Default», «Profile 2», «ab12.default-release»). */
  perfil: string;
  /** PERFIL-NOMBRE-1: el nombre que el usuario le puso al perfil («Trabajo», «Alex») y su cuenta, si el navegador los guarda. */
  nombre?: string;
  email?: string;
  familia: Familia;
  /** Carpeta del perfil: no sale del proceso principal. */
  dir: string;
};

/** Lo que ve el panel de una fuente: nada de rutas. */
export type FuentePublica = Pick<FuenteImportar, "id" | "navegador" | "perfil" | "nombre" | "email">;

export type Marcador = { titulo: string; url: string };
export type WebVisitada = { host: string; visitas: number };
export type Importado = { marcadores: Marcador[]; visitadas: WebVisitada[]; visitadasNoDisponibles: boolean };

export const MAX_MARCADORES = 3000;
const MAX_VISITADAS = 60;

type Entorno = { platform: NodeJS.Platform; home: string; appData?: string; localAppData?: string };
type Sistema = "win32" | "darwin" | "linux";

const CHROMIUM: Array<{ navegador: Exclude<Navegador, "firefox">; ruta: Record<Sistema, string> }> = [
  {
    navegador: "chrome",
    ruta: { win32: "Google/Chrome/User Data", darwin: "Google/Chrome", linux: "google-chrome" },
  },
  {
    navegador: "edge",
    ruta: { win32: "Microsoft/Edge/User Data", darwin: "Microsoft Edge", linux: "microsoft-edge" },
  },
  {
    navegador: "brave",
    ruta: {
      win32: "BraveSoftware/Brave-Browser/User Data",
      darwin: "BraveSoftware/Brave-Browser",
      linux: "BraveSoftware/Brave-Browser",
    },
  },
];

/** Raíz donde cada sistema guarda los datos de las aplicaciones. */
function raizDatos(e: Entorno): { chromium: string; firefox: string } | undefined {
  if (e.platform === "win32") {
    const local = e.localAppData ?? path.join(e.home, "AppData", "Local");
    const roaming = e.appData ?? path.join(e.home, "AppData", "Roaming");
    return { chromium: local, firefox: path.join(roaming, "Mozilla", "Firefox", "Profiles") };
  }
  if (e.platform === "darwin") {
    const soporte = path.join(e.home, "Library", "Application Support");
    return { chromium: soporte, firefox: path.join(soporte, "Firefox", "Profiles") };
  }
  if (e.platform === "linux") {
    return { chromium: path.join(e.home, ".config"), firefox: path.join(e.home, ".mozilla", "firefox") };
  }
  return undefined;
}

const lista = (dir: string): string[] => {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
};

export function entornoReal(): Entorno {
  return {
    platform: process.platform,
    home: os.homedir(),
    appData: process.env.APPDATA,
    localAppData: process.env.LOCALAPPDATA,
  };
}

const texto = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, 120) : undefined;

/**
 * PERFIL-NOMBRE-1: Chromium guarda el nombre visible de cada perfil y su cuenta en `Local State`
 * (profile.info_cache[<carpeta>]: name, gaia_name, user_name). Solo se leen esos tres campos.
 */
export function nombresChromium(json: string): Record<string, { nombre?: string; email?: string }> {
  let cache: Record<string, { name?: unknown; gaia_name?: unknown; user_name?: unknown }> | undefined;
  try {
    cache = JSON.parse(json)?.profile?.info_cache;
  } catch {
    return {};
  }
  const out: Record<string, { nombre?: string; email?: string }> = {};
  for (const [dir, p] of Object.entries(cache && typeof cache === "object" ? cache : {})) {
    if (!p || typeof p !== "object") continue;
    const email = texto(p.user_name);
    out[dir] = { nombre: texto(p.name) ?? texto(p.gaia_name) ?? email, ...(email ? { email } : {}) };
  }
  return out;
}

/** PERFIL-NOMBRE-1: Firefox los nombra en profiles.ini (Name= / Path=); la clave es la carpeta del perfil. */
export function nombresFirefox(ini: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const bloque of ini.split(/^\s*\[/m)) {
    const nombre = /^Name=(.+)$/m.exec(bloque)?.[1]?.trim();
    const ruta = /^Path=(.+)$/m.exec(bloque)?.[1]?.trim();
    if (nombre && ruta) out[path.basename(ruta.replace(/\\/g, "/"))] = nombre.slice(0, 120);
  }
  return out;
}

const leer = (f: string): string => {
  try {
    return fs.readFileSync(f, "utf8");
  } catch {
    return "";
  }
};

export function descubrirFuentes(e: Entorno = entornoReal()): FuenteImportar[] {
  const raiz = raizDatos(e);
  const sistema = e.platform as Sistema;
  if (!raiz) return [];
  const out: FuenteImportar[] = [];
  for (const c of CHROMIUM) {
    const base = path.join(raiz.chromium, c.ruta[sistema]);
    const nombres = nombresChromium(leer(path.join(base, "Local State")));
    for (const perfil of lista(base).filter((n) => n === "Default" || /^Profile \d+$/.test(n))) {
      const dir = path.join(base, perfil);
      if (["Bookmarks", "AccountBookmarks", "History"].some((n) => fs.existsSync(path.join(dir, n))))
        out.push({
          id: `${c.navegador}:${perfil}`,
          navegador: c.navegador,
          perfil,
          ...nombres[perfil],
          familia: "chromium",
          dir,
        });
    }
  }
  // profiles.ini está junto a Profiles/ en Windows y macOS, y en la misma carpeta en Linux.
  const ini = nombresFirefox(
    leer(path.join(raiz.firefox, "..", "profiles.ini")) || leer(path.join(raiz.firefox, "profiles.ini")),
  );
  for (const perfil of lista(raiz.firefox)) {
    const dir = path.join(raiz.firefox, perfil);
    const nombre = ini[perfil];
    if (fs.existsSync(path.join(dir, "places.sqlite")))
      out.push({
        id: `firefox:${perfil}`,
        navegador: "firefox",
        perfil,
        ...(nombre ? { nombre } : {}),
        familia: "firefox",
        dir,
      });
  }
  return out;
}

/** https://host/ruta sin consulta, sin fragmento y sin credenciales: lo que hace falta para reconocer y anclar. */
export function limpiarUrl(raw: string): string | undefined {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return undefined;
    return `${u.origin}${u.pathname}`;
  } catch {
    return undefined;
  }
}

type NodoChromium = { type?: string; name?: string; url?: string; children?: NodoChromium[] };

/** El fichero Bookmarks de Chromium (JSON) en una lista plana de marcadores. */
export function marcadoresChromium(json: string): Marcador[] {
  let raiz: { roots?: Record<string, NodoChromium> };
  try {
    raiz = JSON.parse(json);
  } catch {
    return [];
  }
  const out: Marcador[] = [];
  const visita = (n: NodoChromium) => {
    if (out.length >= MAX_MARCADORES) return;
    if (n.type === "url" && typeof n.url === "string") {
      const url = limpiarUrl(n.url);
      if (url) out.push({ titulo: String(n.name ?? "").slice(0, 200), url });
    }
    for (const h of n.children ?? []) visita(h);
  };
  for (const n of Object.values(raiz?.roots ?? {})) if (n && typeof n === "object") visita(n);
  return out;
}

/** Visitas por sitio: suma las de todas sus páginas y descarta ruta y consulta, que son del usuario. */
export function sitiosMasVisitados(filas: Array<{ url: string; visitas: number }>): WebVisitada[] {
  const por = new Map<string, number>();
  for (const f of filas) {
    const url = limpiarUrl(f.url);
    if (!url) continue;
    const host = new URL(url).host;
    por.set(host, (por.get(host) ?? 0) + (Number.isFinite(f.visitas) ? f.visitas : 0));
  }
  return [...por.entries()]
    .map(([host, visitas]) => ({ host, visitas }))
    .sort((a, b) => b.visitas - a.visitas)
    .slice(0, MAX_VISITADAS);
}

/**
 * Abre una base SQLite del navegador SIEMPRE sobre una copia (el original puede estar en uso y no se toca) y en solo
 * lectura. Copia también el -wal, que es donde Firefox tiene lo último. Borra la copia al terminar.
 */
export function consultarCopia<T>(original: string, consulta: (db: DatabaseSync) => T): T | undefined {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "colonia-importar-"));
  try {
    const copia = path.join(tmp, "datos.sqlite");
    fs.copyFileSync(original, copia);
    try {
      fs.copyFileSync(`${original}-wal`, `${copia}-wal`);
    } catch {}
    const db = new DatabaseSync(copia, { readOnly: true });
    try {
      return consulta(db);
    } finally {
      db.close();
    }
  } catch {
    return undefined; // el navegador la tiene bloqueada o no es una base válida: se dice, no se insiste
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const filasUrl = (db: DatabaseSync, sql: string) =>
  (db.prepare(sql).all() as Array<{ url: unknown; visitas: unknown }>).map((r) => ({
    url: String(r.url),
    visitas: Number(r.visitas),
  }));

/** Lee marcadores y webs más visitadas de una fuente. Solo esos dos datos: nada más del perfil se abre. */
export function leerFuente(f: FuenteImportar): Importado {
  if (f.familia === "chromium") {
    // MARCADORES-2: los de la cuenta (AccountBookmarks) y los locales (Bookmarks), sin repetir.
    const vistos = new Set<string>();
    const marcadores = ficherosMarcadoresChromium(f.dir)
      .flatMap(marcadoresChromium)
      .filter((m) => !vistos.has(m.url) && vistos.add(m.url))
      .slice(0, MAX_MARCADORES);
    const filas = consultarCopia(path.join(f.dir, "History"), (db) =>
      filasUrl(db, "SELECT url, visit_count AS visitas FROM urls ORDER BY visit_count DESC LIMIT 1500"),
    );
    return { marcadores, visitadas: sitiosMasVisitados(filas ?? []), visitadasNoDisponibles: filas === undefined };
  }
  const lectura = consultarCopia(path.join(f.dir, "places.sqlite"), (db) => ({
    marcadores: (
      db
        .prepare(
          `SELECT b.title AS titulo, p.url AS url FROM moz_bookmarks b JOIN moz_places p ON p.id = b.fk
           WHERE b.type = 1 AND p.url LIKE 'http%' LIMIT ${MAX_MARCADORES}`,
        )
        .all() as Array<{ titulo: unknown; url: unknown }>
    ).flatMap((r) => {
      const url = limpiarUrl(String(r.url));
      return url ? [{ titulo: String(r.titulo ?? "").slice(0, 200), url }] : [];
    }),
    filas: filasUrl(
      db,
      "SELECT url, visit_count AS visitas FROM moz_places WHERE visit_count > 0 ORDER BY visit_count DESC LIMIT 1500",
    ),
  }));
  return {
    marcadores: lectura?.marcadores ?? [],
    visitadas: sitiosMasVisitados(lectura?.filas ?? []),
    visitadasNoDisponibles: lectura === undefined,
  };
}

// NAVEGADORES-2: la barra de marcadores de un perfil, tal cual la ve el navegador: marcadores y carpetas, en orden.
// Solo lectura (Firefox, sobre una copia); la URL entera para abrirla, nunca credenciales embebidas.
export type NodoBarra = { titulo: string; url: string } | { titulo: string; hijos: NodoBarra[] };
const MAX_BARRA = 500;
const MAX_PROFUNDIDAD = 6;

/** La URL tal cual si es http(s) y sin usuario:contraseña; si no, nada. */
function urlBarra(raw: unknown): string | undefined {
  try {
    const u = new URL(String(raw));
    if (u.protocol !== "http:" && u.protocol !== "https:") return undefined;
    u.username = "";
    u.password = "";
    return u.href;
  } catch {
    return undefined;
  }
}

// MARCADORES-2: con la sesión de Google iniciada y los marcadores «en la cuenta», Chrome NO escribe Bookmarks:
// los guarda en AccountBookmarks (mismo formato). Un perfil puede tener los dos; Chrome los muestra juntos,
// primero los de la cuenta. Leer solo Bookmarks dejaba la barra vacía en el perfil real del owner.
const FICHEROS_CHROMIUM = ["AccountBookmarks", "Bookmarks"];

/** El JSON de cada fichero de marcadores que exista en el perfil, en el orden en que Chrome los muestra. */
export function ficherosMarcadoresChromium(dir: string): string[] {
  return FICHEROS_CHROMIUM.map((n) => leer(path.join(dir, n))).filter(Boolean);
}

/** La barra de marcadores de un perfil Chromium a partir de sus ficheros: la barra de cada uno, en orden, y al
 *  final «Otros marcadores» como carpeta si tiene algo (como en Chrome). */
export function barraChromiumPerfil(jsons: string[]): NodoBarra[] {
  const barra = jsons.flatMap((j) => barraChromium(j));
  const otros: NodoBarra[] = [];
  let titulo = "";
  for (const j of jsons) {
    let raiz: { roots?: { other?: NodoChromium } };
    try {
      raiz = JSON.parse(j);
    } catch {
      continue;
    }
    titulo ||= String(raiz?.roots?.other?.name ?? "");
    otros.push(...barraChromium(JSON.stringify({ roots: { bookmark_bar: raiz?.roots?.other } })));
  }
  return otros.length ? [...barra, { titulo: titulo || "Otros marcadores", hijos: otros }] : barra;
}

/** La barra de marcadores del fichero Bookmarks de Chromium (roots.bookmark_bar), con sus carpetas. */
export function barraChromium(json: string): NodoBarra[] {
  let raiz: { roots?: { bookmark_bar?: NodoChromium } };
  try {
    raiz = JSON.parse(json);
  } catch {
    return [];
  }
  let total = 0;
  const nodos = (lista: NodoChromium[] | undefined, nivel: number): NodoBarra[] => {
    const out: NodoBarra[] = [];
    for (const n of lista ?? []) {
      if (total >= MAX_BARRA) break;
      const titulo = String(n.name ?? "").slice(0, 200);
      if (n.type === "url") {
        const url = urlBarra(n.url);
        if (url) {
          total++;
          out.push({ titulo, url });
        }
      } else if (n.type === "folder" && nivel < MAX_PROFUNDIDAD) {
        total++;
        out.push({ titulo, hijos: nodos(n.children, nivel + 1) });
      }
    }
    return out;
  };
  return nodos(raiz?.roots?.bookmark_bar?.children, 0);
}

/** Filas de moz_bookmarks (con la URL ya unida) → la barra de herramientas de Firefox, con sus carpetas. */
export function barraFirefox(
  filas: Array<{ id: number; padre: number; tipo: number; titulo: unknown; url: unknown; guid: unknown }>,
): NodoBarra[] {
  const raiz = filas.find((f) => f.guid === "toolbar_____");
  if (!raiz) return [];
  const hijos = new Map<number, typeof filas>();
  for (const f of filas) hijos.set(f.padre, [...(hijos.get(f.padre) ?? []), f]);
  let total = 0;
  const nodos = (padre: number, nivel: number): NodoBarra[] => {
    const out: NodoBarra[] = [];
    for (const f of hijos.get(padre) ?? []) {
      if (total >= MAX_BARRA) break;
      const titulo = String(f.titulo ?? "").slice(0, 200);
      if (f.tipo === 1) {
        const url = urlBarra(f.url);
        if (url) {
          total++;
          out.push({ titulo, url });
        }
      } else if (f.tipo === 2 && nivel < MAX_PROFUNDIDAD) {
        total++;
        out.push({ titulo, hijos: nodos(f.id, nivel + 1) });
      }
    }
    return out;
  };
  return nodos(raiz.id, 0);
}

/** La barra de marcadores de una fuente; vacía si el perfil no tiene o no se puede leer. */
export function leerBarra(f: FuenteImportar): NodoBarra[] {
  if (f.familia === "chromium") return barraChromiumPerfil(ficherosMarcadoresChromium(f.dir));
  const filas = consultarCopia(path.join(f.dir, "places.sqlite"), (db) =>
    db
      .prepare(
        `SELECT b.id AS id, b.parent AS padre, b.type AS tipo, b.title AS titulo, b.guid AS guid, p.url AS url
         FROM moz_bookmarks b LEFT JOIN moz_places p ON p.id = b.fk ORDER BY b.parent, b.position LIMIT 20000`,
      )
      .all() as Array<{ id: number; padre: number; tipo: number; titulo: unknown; url: unknown; guid: unknown }>,
  );
  return barraFirefox(filas ?? []);
}
