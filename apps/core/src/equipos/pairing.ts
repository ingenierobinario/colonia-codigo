// El código de emparejamiento: 6 dígitos, un solo uso, 10 minutos y se bloquea tras 5 fallos. Solo uno vigente a la vez.
import { randomInt } from "node:crypto";

export const CODE_TTL_MS = 10 * 60_000;
export const MAX_ATTEMPTS = 5;

export type Attempt = "ok" | "wrong" | "expired" | "locked" | "none";
export type PairingState = { expires: number; misses: number; used: boolean };
export type PairingStore = {
  read(code: string): PairingState | undefined;
  write(code: string, state: PairingState): void;
};

export function createPairing(opts: { clock?: () => number; makeCode?: () => string } = {}) {
  const clock = opts.clock ?? Date.now;
  const makeCode = opts.makeCode ?? (() => String(randomInt(0, 1_000_000)).padStart(6, "0"));
  let current: (PairingState & { code: string }) | undefined;
  let store: PairingStore | undefined;
  const persist = () => {
    if (current) store?.write(current.code, { expires: current.expires, misses: current.misses, used: current.used });
  };

  const live = () => {
    if (current && (current.expires <= clock() || current.used || current.misses >= MAX_ATTEMPTS)) current = undefined;
    return current;
  };
  return {
    /** `preset`: un código que ya trae el equipo (AUTOVINCULAR-1, la plantilla de Railway), con su propia vigencia. */
    start(preset?: { code: string; ttlMs: number; store?: PairingStore }): { code: string; expiresAt: number } {
      if (current) {
        current.used = true;
        persist();
      }
      const code = preset?.code ?? makeCode();
      store = preset?.store;
      current = {
        code,
        ...(store?.read(code) ?? { expires: clock() + (preset?.ttlMs ?? CODE_TTL_MS), misses: 0, used: false }),
      };
      persist();
      return { code, expiresAt: current.expires };
    },
    cancel(): boolean {
      const had = Boolean(live());
      if (current) {
        current.used = true;
        persist();
      }
      current = undefined;
      return had;
    },
    active: () => Boolean(live()),
    /** `check` recibe el código vigente y dice si quien llama lo conoce. Acertar lo gasta; fallar 5 veces lo anula. */
    attempt(check: (code: string) => boolean): Attempt {
      const c = current;
      if (!c) return "none";
      if (c.used || c.misses >= MAX_ATTEMPTS) {
        current = undefined;
        return "locked";
      }
      if (c.expires <= clock()) {
        current = undefined;
        return "expired";
      }
      if (check(c.code)) {
        c.used = true;
        persist();
        current = undefined;
        return "ok";
      }
      c.misses++;
      persist();
      if (c.misses >= MAX_ATTEMPTS) {
        current = undefined;
        return "locked";
      }
      return "wrong";
    },
  };
}
export type Pairing = ReturnType<typeof createPairing>;
