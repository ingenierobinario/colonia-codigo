// Secrets by reference. Config and settings hold `secret://<name>` (or `env:<VAR>`); the value is read only by the
// code that uses it, right when it uses it, and never leaves the core.
// Values live in the system's own store (secrets-stores.ts): the login Keychain on macOS, a DPAPI file on Windows, the
// Secret Service keyring on Linux, so an agent harness sandboxed to read the disk cannot read them. Without one, nothing
// is written in plain text: saving a value fails and none is read from disk. Only the backend "file", asked for by name
// (tests), keeps <home>/secrets.json (0600). See DECISIONS.md#d-010
import fs from "node:fs";
import path from "node:path";
import { defaultHome } from "./config.ts";
import {
  dpapiStore,
  keychainStore,
  type Run,
  runCommand,
  type SecretsBackend,
  secretServiceStore,
  type ValueStore,
} from "./secrets-stores.ts";

export type { SecretsBackend } from "./secrets-stores.ts";

type Entry = { value?: string; updated_at: string; hint?: string };

/** Values at least this long keep their last four characters as a hint; shorter ones would give too much away. */
const HINT_MIN = 12;

export type Secrets = ReturnType<typeof createSecrets>;

/**
 * A project's own value for a name: stored apart (a "~" and "/" no public name can hold), it wins over the global one
 * for that project's MCP servers.
 */
export const projectSecretName = (projectId: string, name: string) => `~${projectId}/${name}`;

/** The project and name of a stored key, when it is a project's own. */
export function splitSecretName(key: string): { project_id?: string; name: string } {
  const m = /^~([^/]+)\/(.+)$/.exec(key);
  return m ? { project_id: m[1] as string, name: m[2] as string } : { name: key };
}

/**
 * The Keychain service of a home: "colonia2" for the default one (as before it moved into ~/.colonia, so its secrets stay
 * found), its own for any other (a test home never overwrites).
 */
export function keychainService(home: string, main = defaultHome()): string {
  const at = path.resolve(home);
  return at === path.resolve(main) ? "colonia2" : `colonia2:${at}`;
}

export function createSecrets(
  home: string,
  wanted: SecretsBackend,
  env: NodeJS.ProcessEnv = process.env,
  run: Run = runCommand,
) {
  const SERVICE = keychainService(home);
  const index = path.join(home, "secrets.index.json");
  const legacy = path.join(home, "secrets.json");
  const stores: Record<Exclude<SecretsBackend, "file">, () => ValueStore> = {
    keychain: () => keychainStore(SERVICE, run),
    dpapi: () => dpapiStore(home, SERVICE, run),
    "secret-service": () => secretServiceStore(SERVICE, run),
  };
  let store: ValueStore | undefined;
  let backend: SecretsBackend = "file";
  let file = legacy;
  let sealed = false;
  let chosen = false;
  // ARRANQUE-RAPIDO-1: what an asynchronous warm() found out, so choose() does not ask the store again (blocking).
  let probed: boolean | undefined;
  // ARRANQUE-RAPIDO-1: asking a store whether it works runs its program (DPAPI: PowerShell, twice, ~3 s on Windows).
  // A home with nothing saved yet asks when a secret is first used, not while the core starts.
  const choose = () => {
    if (chosen) return;
    chosen = true;
    const candidate = wanted === "file" ? undefined : stores[wanted]();
    // An index means values already went to the store: it stays chosen even while it does not answer (a keyring still
    // locked at boot), or the owner's secrets would seem gone. Otherwise a store that does not work falls back to the file.
    store =
      candidate && (wanted === "keychain" || fs.existsSync(index) || (probed ?? candidate.works()))
        ? candidate
        : undefined;
    backend = store ? wanted : "file";
    // The file holds values only for the file backend; with a store it is just the index (names, dates).
    file = store ? index : legacy;
    // Un fichero heredado o restaurado puede tener permisos demasiado amplios. Corrígelos antes de leerlo.
    if (!store && process.platform !== "win32" && fs.existsSync(legacy)) {
      try {
        fs.chmodSync(legacy, 0o600);
      } catch {}
    }
    // Preserva las conexiones de 2.32.0 que solo existen en el fichero heredado. Un fichero vacío no contiene ninguna.
    sealed = wanted !== "file" && !store && Object.keys(read()).length === 0;
  };
  const cache = new Map<string, string | undefined>();
  // SECRETOS-ILEGIBLES-1: a file saved by Notepad starts with a BOM, which JSON.parse refuses; one cut short by a power
  // loss does not parse at all. Either used to read as empty, and the next save wrote that empty list over every value.
  // Now the BOM is skipped, and an unreadable file is set aside (secrets.json.corrupt-<time>) before anything replaces it.
  let unreadable = false;
  const read = (): Record<string, Entry> => {
    choose();
    let text: string;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      return {};
    }
    try {
      const parsed = JSON.parse(text.replace(/^\uFEFF/, "")) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, Entry>;
    } catch {}
    unreadable = true;
    return {};
  };
  const write = (all: Record<string, Entry>) => {
    fs.mkdirSync(home, { recursive: true });
    if (unreadable && fs.existsSync(file)) {
      fs.copyFileSync(file, `${file}.corrupt-${Date.now()}`);
      unreadable = false;
    }
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(all, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
  };

  const indexEntry = (all: Record<string, Entry>, name: string, value: string | null) => {
    if (value === null) delete all[name];
    else
      all[name] = {
        ...(store ? {} : { value }),
        updated_at: new Date().toISOString(),
        ...(value.length >= HINT_MIN ? { hint: value.slice(-4) } : {}),
      };
  };

  let warming: Promise<void> | undefined;
  const api = {
    /**
     * ARRANQUE-RAPIDO-1: opens the system store in the background (DPAPI: PowerShell, 0.5-3 s on Windows) while the core
     * starts, so neither the first secret read nor the first-start check stops the core from answering the panel.
     */
    warm(): Promise<void> {
      warming ??= (async () => {
        if (chosen || wanted === "file") return;
        const candidate = stores[wanted]();
        if (!candidate.warm) return;
        const ok = await candidate.warm();
        if (chosen) return;
        probed = ok;
        if (fs.existsSync(index) || ok) {
          // The opened store is the one choose() keeps: its values are already in memory.
          chosen = true;
          store = candidate;
          backend = wanted;
          file = index;
        }
      })().catch(() => {});
      return warming;
    },
    get backend(): SecretsBackend {
      choose();
      return backend;
    },
    /** What the owner should know once: the keyring was wanted and is not there, so values sit in a file. */
    get notice(): string | undefined {
      choose();
      return sealed
        ? `No system store for secrets answered, so Colonia will not save any (it never writes them in plain text). On Linux install a keyring (gnome-keyring and libsecret-tools) and restart Colonia. Values already in ${legacy} are not read.`
        : undefined;
    },
    /** Resolves `secret://name` or `env:VAR`; anything else (or a missing value) is undefined. */
    resolve(ref: string | undefined): string | undefined {
      if (!ref) return undefined;
      if (ref.startsWith("env:")) return env[ref.slice(4)] || undefined;
      if (!ref.startsWith("secret://")) return undefined;
      const name = ref.slice(9);
      choose();
      if (sealed) return undefined;
      if (!store) return read()[name]?.value || undefined;
      if (cache.has(name)) return cache.get(name);
      // The Keychain may hold a value from an earlier install in another home; the newer stores only what is listed.
      if (backend !== "keychain" && !Object.hasOwn(read(), name)) return undefined;
      const value = store.get(name);
      // A miss is not kept: a keyring locked now may open later.
      if (value !== undefined || backend === "keychain") cache.set(name, value);
      return value;
    },
    has(ref: string | undefined): boolean {
      return api.resolve(ref) !== undefined;
    },
    /**
     * Whether this install keeps a value under that name (its index). The Keychain may still hold one from an earlier
     * install in another home, which `has` sees and the owner's list does not.
     */
    listed(name: string): boolean {
      return Object.hasOwn(read(), name);
    },
    /** Like resolve, but a project's own value for a `secret://` name comes first. */
    resolveIn(ref: string | undefined, projectId: string | undefined): string | undefined {
      if (projectId && ref?.startsWith("secret://")) {
        const own = api.resolve(`secret://${projectSecretName(projectId, ref.slice(9))}`);
        if (own !== undefined) return own;
      }
      return api.resolve(ref);
    },
    list(): Array<{ name: string; updated_at: string; hint?: string }> {
      return Object.entries(read()).map(([name, e]) => ({
        name,
        updated_at: e.updated_at,
        ...(e.hint ? { hint: e.hint } : {}),
      }));
    },
    set(name: string, value: string | null): void {
      choose();
      if (sealed) {
        if (value !== null) throw new Error(api.notice);
        return;
      }
      const all = read();
      if (store) {
        store.set(name, value);
        cache.delete(name);
      }
      indexEntry(all, name, value);
      write(all);
    },
    /**
     * RESTAURAR-DPAPI-1: many values in one go, as a restore does. A store that seals them together does it once; one
     * that keeps them apart tries each, so a value it refuses does not lose the others. Returns the names not saved.
     */
    setMany(values: Record<string, string | null>): { failed: string[] } {
      choose();
      const names = Object.keys(values);
      if (names.length === 0) return { failed: [] };
      if (sealed) return { failed: names.filter((name) => values[name] !== null) };
      const all = read();
      const saved: string[] = [];
      if (store?.setMany) {
        try {
          store.setMany(values);
          saved.push(...names);
        } catch {}
      } else
        for (const name of names) {
          try {
            store?.set(name, values[name] ?? null);
            saved.push(name);
          } catch {}
        }
      for (const name of saved) {
        cache.delete(name);
        indexEntry(all, name, values[name] ?? null);
      }
      if (saved.length) write(all);
      return { failed: names.filter((n) => !saved.includes(n)) };
    },
  };

  // A home that already keeps secrets chooses now, as before (with an index that asks nothing of the store).
  if (fs.existsSync(index) || fs.existsSync(legacy)) choose();
  // Values written by the file backend before a store was used move there once, and the file goes away.
  if (store && fs.existsSync(legacy)) {
    try {
      const old = JSON.parse(fs.readFileSync(legacy, "utf8")) as Record<string, Entry>;
      for (const [name, e] of Object.entries(old)) if (e.value) api.set(name, e.value);
      fs.rmSync(legacy);
    } catch {}
  }
  return api;
}
