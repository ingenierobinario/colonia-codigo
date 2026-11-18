import { createStore } from "./createStore.ts";

const loadedCatalogs = new Set<() => Promise<void>>();

/** Al recuperar la conexión sólo se actualizan las listas que este panel llegó a utilizar. */
export function refreshPinnedCatalogs(): void {
  for (const refresh of loadedCatalogs) void refresh();
}

export function createPinnedCatalog<T extends object>(initial: T, read: () => Promise<T>) {
  const store = createStore({ ...initial, loaded: false, failed: false });
  let generation = 0;
  let pending: Promise<void> | undefined;
  let writes = Promise.resolve();

  function load(force = false): Promise<void> {
    loadedCatalogs.add(refresh);
    if (pending) return pending;
    const state = store.get();
    // Si ya falló la precarga, montar otra vista conserva el error hasta el clic o la reconexión.
    if (!force && (state.loaded || state.failed)) return Promise.resolve();
    const version = generation;
    const request = read()
      .then((value) => {
        if (version === generation) store.set({ ...value, loaded: true, failed: false });
      })
      .catch(() => {
        if (version === generation) store.set({ ...store.get(), failed: true });
      })
      .finally(() => {
        if (pending === request) pending = undefined;
      });
    pending = request;
    return request;
  }

  function refresh() {
    generation++;
    pending = undefined;
    return load(true);
  }

  function save(write: () => Promise<T>): Promise<void> {
    // El motor devuelve la lista entera al escribir. Enviamos los cambios en el orden en que se hicieron.
    const saved = writes.then(write).then((value) => {
      generation++;
      pending = undefined;
      loadedCatalogs.add(refresh);
      store.set({ ...value, loaded: true, failed: false });
    });
    writes = saved.catch(() => {});
    return saved;
  }

  return { ...store, load, save };
}
