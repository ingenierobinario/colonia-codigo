// Contraseñas de las aplicaciones web. Viven SOLO en el proceso principal, cifradas con el almacén del sistema
// (DPAPI, Llavero, libsecret) a través de `CajaSecreta`. Si el sistema no puede cifrar, no se guarda nada: ni en
// texto plano ni en un cifrado de mentira. Nada de lo que hay aquí se escribe en un log.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** Lo mínimo de `safeStorage` que usamos; los tests ponen un cifrado propio. */
export type CajaSecreta = {
  disponible(): boolean;
  cifrar(texto: string): Buffer;
  descifrar(datos: Buffer): string;
};

type Registro = { id: string; app: string; origen: string; blob: string; en: number };
type Fichero = { v: 1; items: Registro[]; nunca: Array<{ app: string; origen: string }> };

/** Una entrada tal como la ve la lista de Ajustes: sin contraseña. */
export type EntradaPublica = { id: string; app: string; origen: string; usuario: string };
export type Credencial = { id: string; usuario: string; contrasena: string };
export type ResultadoGuardar = "guardada" | "actualizada" | "igual" | "no-disponible" | "rechazada";

/**
 * El origen EXACTO: esquema, host y puerto. Solo http(s); «null» (opaco) y todo lo demás no tiene origen.
 * `new URL` ya quita el puerto por defecto, como hacen los navegadores.
 */
export function origenDe(url: string): string | undefined {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return undefined;
    return u.origin;
  } catch {
    return undefined;
  }
}

const LIMITE = 1024;
const MAX_ENTRADAS = 2000;

export function crearBoveda(opts: { archivo: string; caja: CajaSecreta; ahora?: () => number }) {
  const ahora = opts.ahora ?? Date.now;

  const leer = (): Fichero => {
    try {
      const f = JSON.parse(fs.readFileSync(opts.archivo, "utf8")) as Partial<Fichero>;
      return {
        v: 1,
        items: Array.isArray(f.items) ? f.items : [],
        nunca: Array.isArray(f.nunca) ? f.nunca : [],
      };
    } catch {
      return { v: 1, items: [], nunca: [] };
    }
  };
  const escribir = (f: Fichero): void => {
    fs.mkdirSync(path.dirname(opts.archivo), { recursive: true });
    const tmp = `${opts.archivo}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(f), { mode: 0o600 });
    fs.renameSync(tmp, opts.archivo);
  };
  const abrir = (r: Registro): { usuario: string; contrasena: string } | undefined => {
    try {
      const o = JSON.parse(opts.caja.descifrar(Buffer.from(r.blob, "base64"))) as Record<string, unknown>;
      return typeof o.usuario === "string" && typeof o.contrasena === "string"
        ? { usuario: o.usuario, contrasena: o.contrasena }
        : undefined;
    } catch {
      return undefined; // otra cuenta del sistema o un almacén que cambió: no se puede abrir, no se adivina
    }
  };

  return {
    disponible: () => opts.caja.disponible(),

    guardar(e: { app: string; origen: string; usuario: string; contrasena: string }): ResultadoGuardar {
      if (!opts.caja.disponible()) return "no-disponible";
      if (!e.app || !origenDe(e.origen) || origenDe(e.origen) !== e.origen) return "rechazada";
      if (!e.usuario || !e.contrasena || e.usuario.length > LIMITE || e.contrasena.length > LIMITE) return "rechazada";
      const f = leer();
      const previo = f.items.find((r) => r.app === e.app && r.origen === e.origen && abrir(r)?.usuario === e.usuario);
      if (previo && abrir(previo)?.contrasena === e.contrasena) return "igual";
      if (!previo && f.items.length >= MAX_ENTRADAS) return "rechazada";
      const blob = opts.caja
        .cifrar(JSON.stringify({ usuario: e.usuario, contrasena: e.contrasena }))
        .toString("base64");
      if (previo) {
        previo.blob = blob;
        previo.en = ahora();
      } else f.items.push({ id: crypto.randomUUID(), app: e.app, origen: e.origen, blob, en: ahora() });
      escribir(f);
      return previo ? "actualizada" : "guardada";
    },

    /** La credencial de ESA aplicación y de ESE origen exacto; con varias cuentas, la guardada más recientemente. */
    buscar(app: string, origen: string): Credencial | undefined {
      if (!opts.caja.disponible() || origenDe(origen) !== origen) return undefined;
      const r = leer()
        .items.filter((x) => x.app === app && x.origen === origen)
        .sort((a, b) => b.en - a.en)
        .find((x) => abrir(x));
      const c = r && abrir(r);
      return r && c ? { id: r.id, usuario: c.usuario, contrasena: c.contrasena } : undefined;
    },

    /** Para saber si hay que ofrecer guardar: ¿existe ya este usuario aquí, y con esta misma contraseña? */
    estado(app: string, origen: string, usuario: string, contrasena: string): "nueva" | "cambia" | "igual" {
      const previo = leer().items.find((r) => r.app === app && r.origen === origen && abrir(r)?.usuario === usuario);
      if (!previo) return "nueva";
      return abrir(previo)?.contrasena === contrasena ? "igual" : "cambia";
    },

    lista(): EntradaPublica[] {
      if (!opts.caja.disponible()) return [];
      return leer()
        .items.flatMap((r) => {
          const c = abrir(r);
          return c ? [{ id: r.id, app: r.app, origen: r.origen, usuario: c.usuario }] : [];
        })
        .sort((a, b) => a.origen.localeCompare(b.origen) || a.usuario.localeCompare(b.usuario));
    },

    revelar(id: string): string | undefined {
      if (!opts.caja.disponible()) return undefined;
      const r = leer().items.find((x) => x.id === id);
      return r ? abrir(r)?.contrasena : undefined;
    },

    borrar(id: string): boolean {
      const f = leer();
      const quedan = f.items.filter((x) => x.id !== id);
      if (quedan.length === f.items.length) return false;
      escribir({ ...f, items: quedan });
      return true;
    },

    /** Al quitar una aplicación de la barra, sus contraseñas se van con ella. */
    borrarApp(app: string): number {
      const f = leer();
      const quedan = f.items.filter((x) => x.app !== app);
      if (quedan.length === f.items.length) return 0;
      escribir({ ...f, items: quedan, nunca: f.nunca.filter((n) => n.app !== app) });
      return f.items.length - quedan.length;
    },

    nunca(app: string, origen: string): void {
      const f = leer();
      if (f.nunca.some((n) => n.app === app && n.origen === origen)) return;
      escribir({ ...f, nunca: [...f.nunca, { app, origen }] });
    },
    esNunca: (app: string, origen: string): boolean => leer().nunca.some((n) => n.app === app && n.origen === origen),
  };
}

export type Boveda = ReturnType<typeof crearBoveda>;
