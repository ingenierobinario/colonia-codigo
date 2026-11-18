// D-192 fase 2 · Dos equipos del dueño sincronizados: emparejar, ver cómo va, pasar los canales y recuperar versiones.
import { badRequest } from "../errors.ts";
import type { Sync } from "../sync/service.ts";
import type { Handlers } from "./router.ts";

export function syncHandlers(sync: Sync) {
  /** Lo que la persona puede arreglar (un código mal copiado, el otro equipo apagado) se le dice tal cual. */
  const said = <T>(f: () => T): T => {
    try {
      return f();
    } catch (err) {
      throw badRequest((err as Error).message);
    }
  };
  return {
    "sync.status": () => sync.status(),
    "sync.pair_start": ({ initial_source }) => {
      said(() => sync.pairStart(initial_source));
      return sync.status();
    },
    "sync.pair_cancel": () => {
      sync.pairCancel();
      return sync.status();
    },
    "sync.pair_join": async (p) => {
      try {
        await sync.pairJoin(p.code, p.address, p.projects);
      } catch (err) {
        throw badRequest((err as Error).message);
      }
      return sync.status();
    },
    "sync.unpair": () => {
      sync.unpair();
      return sync.status();
    },
    "sync.make_principal": () => {
      sync.makePrincipal();
      return sync.status();
    },
    "sync.saved": (p) => sync.saved(p.limit, p.offset),
    "sync.recover": (p) => ({ ok: sync.recover(p.id) }),
    "sync.saved_delete": (p) => ({ deleted: sync.forgetSaved(p.id) }),
    "sync.set_folder": (p) => {
      said(() => sync.setFolder(p.project, p.path));
      return sync.status();
    },
    "sync.copy_projects": ({ projects }) => {
      said(() => sync.copyProjects(projects));
      return sync.status();
    },
  } satisfies Partial<Handlers>;
}
