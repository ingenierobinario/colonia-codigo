// Entre la página y la bóveda: decide si se rellena y si se ofrece guardar. La dirección y la aplicación las pone el
// proceso principal (la del fotograma que habla), nunca la página. La oferta pendiente vive solo en memoria y el panel
// no ve la contraseña: solo el sitio y el usuario.
import { type Boveda, origenDe, type ResultadoGuardar } from "./boveda.ts";

export type Oferta = { id: string; app: string; sitio: string; usuario: string; cambia: boolean };
export type Respuesta = "guardar" | "nunca" | "ahora-no";

type Pendiente = Oferta & { origen: string; contrasena: string; caduca: number };
const VIGENCIA_MS = 5 * 60_000;

export function crearGuardian(b: Boveda, ofrecer: (o: Oferta) => void, ahora: () => number = Date.now) {
  const pendientes = new Map<string, Pendiente>();
  let n = 0;
  return {
    /** Lo que se puede rellenar en esa dirección de esa aplicación; nada si el origen no coincide al milímetro. */
    sondear(app: string, url: string): { usuario: string; contrasena: string } | undefined {
      const origen = origenDe(url);
      if (!origen) return undefined;
      const c = b.buscar(app, origen);
      return c && { usuario: c.usuario, contrasena: c.contrasena };
    },

    capturar(app: string, url: string, usuario: unknown, contrasena: unknown): void {
      const origen = origenDe(url);
      if (!origen || typeof usuario !== "string" || typeof contrasena !== "string" || !usuario || !contrasena) return;
      if (!b.disponible() || b.esNunca(app, origen)) return;
      const estado = b.estado(app, origen, usuario, contrasena);
      if (estado === "igual") return;
      for (const [k, p] of pendientes) if (p.app === app || p.caduca < ahora()) pendientes.delete(k);
      const id = `o${++n}`;
      const o: Pendiente = {
        id,
        app,
        sitio: new URL(origen).host,
        usuario,
        cambia: estado === "cambia",
        origen,
        contrasena,
        caduca: ahora() + VIGENCIA_MS,
      };
      pendientes.set(id, o);
      ofrecer({ id, app, sitio: o.sitio, usuario, cambia: o.cambia });
    },

    responder(id: string, r: Respuesta): ResultadoGuardar | "nunca" | "descartada" {
      const p = pendientes.get(id);
      pendientes.delete(id);
      if (!p || p.caduca < ahora()) return "descartada";
      if (r === "nunca") {
        b.nunca(p.app, p.origen);
        return "nunca";
      }
      if (r !== "guardar") return "descartada";
      return b.guardar({ app: p.app, origen: p.origen, usuario: p.usuario, contrasena: p.contrasena });
    },
  };
}
