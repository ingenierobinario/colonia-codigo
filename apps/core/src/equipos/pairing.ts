// El código de emparejamiento: 6 dígitos, un solo uso, 10 minutos y se bloquea tras 5 fallos. Solo uno vigente a la vez.
import { randomInt } from "node:crypto";

export const CODE_TTL_MS = 10 * 60_000;
export const MAX_ATTEMPTS = 5;

export type Attempt = "ok" | "wrong" | "expired" | "locked" | "none";

export function createPairing(opts: { clock?: () => number; makeCode?: () => string } = {}) {
  const clock = opts.clock ?? Date.now;
  const makeCode = opts.makeCode ?? (() => String(randomInt(0, 1_000_000)).padStart(6, "0"));
  let current: { code: string; expires: number; misses: number } | undefined;

  const live = () => {
    if (current && current.expires <= clock()) current = undefined;
    return current;
  };
  return {
    start(): { code: string; expiresAt: number } {
      const code = makeCode();
      current = { code, expires: clock() + CODE_TTL_MS, misses: 0 };
      return { code, expiresAt: current.expires };
    },
    cancel(): boolean {
      const had = Boolean(live());
      current = undefined;
      return had;
    },
    active: () => Boolean(live()),
    /** `check` recibe el código vigente y dice si quien llama lo conoce. Acertar lo gasta; fallar 5 veces lo anula. */
    attempt(check: (code: string) => boolean): Attempt {
      const c = current;
      if (!c) return "none";
      if (c.expires <= clock()) {
        current = undefined;
        return "expired";
      }
      if (check(c.code)) {
        current = undefined;
        return "ok";
      }
      if (++c.misses >= MAX_ATTEMPTS) {
        current = undefined;
        return "locked";
      }
      return "wrong";
    },
  };
}
export type Pairing = ReturnType<typeof createPairing>;
