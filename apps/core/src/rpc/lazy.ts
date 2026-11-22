// LAZY-1 · Lo que solo se usa al pedirlo no se carga al arrancar: un espacio de llamadas (sync.*, backup.*…) se trae
// con import() la primera vez que alguien lo llama. El core en reposo no carga esos módulos (idle_rss_mb en
// scripts/perf.ts) y quien llama no nota nada: la primera llamada espera a la carga, las demás van directas.
import { type MethodName, methods } from "@colonia/protocol";
import type { Handler, Handlers } from "./router.ts";

/** Una sola carga aunque lleguen varias llamadas a la vez; si falla, la siguiente lo vuelve a intentar. */
export function once<T>(load: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | undefined;
  return () => {
    p ??= load().catch((err) => {
      p = undefined;
      throw err;
    });
    return p;
  };
}

/** Los métodos del protocolo que empiezan por `prefix` («sync.»), sin cargar quién los atiende. */
export function methodsWith<P extends string>(prefix: P): Extract<MethodName, `${P}${string}`>[] {
  return (Object.keys(methods) as MethodName[]).filter((m): m is Extract<MethodName, `${P}${string}`> =>
    m.startsWith(prefix),
  );
}

/** Atiende `names` con lo que devuelva `load`, que solo se ejecuta en la primera llamada. */
export function lazyHandlers<N extends MethodName>(
  names: readonly N[],
  load: () => Promise<Pick<Handlers, N>>,
): Pick<Handlers, N> {
  const loaded = once(load);
  const out: Partial<Record<MethodName, Handler<MethodName>>> = {};
  for (const name of names)
    out[name] = async (params, ctx) => {
      const h = (await loaded())[name] as Handler<MethodName> | undefined;
      if (!h) throw new Error(`${name}: no handler`);
      return h(params, ctx);
    };
  return out as Pick<Handlers, N>;
}
