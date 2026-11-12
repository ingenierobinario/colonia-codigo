// NAVEGADORES-1: the owner's browser profiles under Navegadores. Each opens inside Colonia with tabs of its own
// persistent jar (profile nav:<id>); nothing is copied from the real browser.
import type { Store } from "../domain/store.ts";
import type { Handlers } from "./router.ts";

export function navegadorHandlers(store: Store) {
  const list = () => store.settings.read("navegadores");
  return {
    "navegadores.list": () => ({ navegadores: list() }),
    "navegadores.set": ({ id, navegador }) => {
      const now = list();
      const next = navegador ? { id, ...navegador } : undefined;
      const navegadores = !next
        ? now.filter((n) => n.id !== id)
        : now.some((n) => n.id === id)
          ? now.map((n) => (n.id === id ? next : n))
          : [...now, next];
      store.settings.write("navegadores", navegadores);
      return { navegadores };
    },
  } satisfies Partial<Handlers>;
}
