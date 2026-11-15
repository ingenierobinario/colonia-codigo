// CURSOR-FIABLE-1 · Lo que comparten las herramientas que manejan una pantalla (la de este ordenador y la de otro
// equipo): el modo que eligió la persona, el mapa de la última captura y la espera a que la pantalla deje de cambiar.
import { createHash } from "node:crypto";
import { pictureToScreen, type ScreenMap } from "@colonia/protocol";
import type { Store } from "../domain/store.ts";
import type { ToolContext } from "./types.ts";

/** En vivo: el puntero real se mueve y se ve. Segundo plano: el puntero de la persona no se toca. */
export type ScreenMode = "live" | "background";

type Settings = Pick<Store, "settings">;

const TEXT = {
  es: {
    q: "¿Cómo quieres que maneje la pantalla?",
    live: "En vivo (verás moverse el cursor)",
    background: "En segundo plano (sin mover tu cursor)",
  },
  en: {
    q: "How should I drive the screen?",
    live: "Live (you will see the pointer move)",
    background: "In the background (your pointer stays put)",
  },
};
const lang = (store: Settings) => (store.settings.get("owner_language") === "en" ? "en" : "es");

/** Lo elegido por chat (una respuesta a la pregunta, o el modo con que la persona importó la receta que se sigue). */
const chosen = new WeakMap<object, Map<string, ScreenMode>>();
const ofStore = (store: Settings) => {
  let m = chosen.get(store.settings);
  if (!m) {
    m = new Map();
    chosen.set(store.settings, m);
  }
  return m;
};

/** Fija el modo de un chat: solo con algo que dijo la persona (su respuesta, o su elección al importar una receta). */
export function setThreadMode(store: Settings, thread: string, mode: ScreenMode): void {
  const m = ofStore(store);
  m.set(thread, mode);
  if (m.size > 500) m.delete(m.keys().next().value as string);
}

/** El modo con que se maneja la pantalla en un chat, si la persona ya lo dijo (para ese chat, o en su ajuste). */
export function threadMode(store: Settings, thread: string): ScreenMode | undefined {
  const own = ofStore(store).get(thread);
  if (own) return own;
  const set = store.settings.read("desktop").computer_mode;
  return set === "live" || set === "background" ? set : undefined;
}

/**
 * El modo de este chat. Nunca lo decide el agente: sale de lo que la persona fijó para el chat, de su ajuste, o se le
 * pregunta ahora. Devuelve `stop` (lo que se le contesta al modelo) si no hay respuesta.
 */
export async function screenMode(
  store: Settings,
  ctx: Pick<ToolContext, "thread" | "askOwner">,
): Promise<{ mode: ScreenMode } | { stop: string }> {
  const own = ofStore(store).get(ctx.thread.id);
  if (own) return { mode: own };
  const set = store.settings.read("desktop").computer_mode;
  if (set === "live" || set === "background") return { mode: set };
  const t = TEXT[lang(store)];
  const r = await ctx.askOwner(t.q, [t.live, t.background]);
  if (r.state === "answered" && (r.answer === t.live || r.answer === t.background)) {
    const mode: ScreenMode = r.answer === t.live ? "live" : "background";
    setThreadMode(store, ctx.thread.id, mode);
    return { mode };
  }
  return {
    stop: "not done: the owner has to choose how you drive the screen (live, or in the background) and has not answered yet. You cannot choose for them. End this turn and say you are waiting for that answer.",
  };
}

/** Una captura deja de valer para hacer clic por sus píxeles pasado este tiempo: la pantalla ya será otra. */
export const SHOT_FRESH_MS = 3 * 60_000;

/** La última captura de cada pantalla (por chat y pantalla): de qué zona es, para pasar un píxel suyo a su punto. */
export function shotMaps() {
  const maps = new Map<string, { map: ScreenMap; at: number; owner?: string | undefined }>();
  return {
    keep(key: string, map: ScreenMap | undefined, owner?: string): void {
      maps.delete(key);
      if (map) maps.set(key, { map, at: Date.now(), owner });
      if (maps.size > 500) maps.delete(maps.keys().next().value as string);
    },
    /** El punto de pantalla de un píxel de la última captura; lanza (con qué hacer) si no hay captura que valga. */
    point(key: string, px: number, py: number, tool: string, owner?: string): { x: number; y: number } {
      const m = maps.get(key);
      if (!m) throw new Error(`there is no picture to take that pixel from: take a ${tool} first`);
      if (Date.now() - m.at > SHOT_FRESH_MS)
        throw new Error(`the last picture is too old to click by its pixels: take a ${tool} again`);
      if (owner && m.owner && owner.toLowerCase() !== m.owner.toLowerCase())
        throw new Error(`the last picture was of ${m.owner}, not of ${owner}: take a ${tool} of ${owner} first`);
      return pictureToScreen(m.map, px, py);
    },
  };
}

export const digestOf = (bytes: Uint8Array) => createHash("sha1").update(bytes).digest("hex").slice(0, 16);

/** Cuánto se espera entre dos miradas y cuántas se hacen como mucho hasta dar la pantalla por quieta. */
export const SETTLE = { pauseMs: 350, looks: 4 };

/**
 * Mira hasta que dos capturas seguidas son iguales (la app terminó de repintar) o se acaban las miradas. Antes se
 * esperaba un tiempo fijo y se miraba una vez: si la app tardaba más, el agente veía la pantalla a medio cambiar y
 * el siguiente clic iba a algo que ya no estaba ahí.
 */
export async function settled<T extends { digest?: string | undefined }>(
  look: () => Promise<T>,
  o: { pauseMs?: number; looks?: number; discard?: (shot: T) => void } = {},
): Promise<{ shot: T; steady: boolean; looks: number }> {
  const pause = o.pauseMs ?? SETTLE.pauseMs;
  const max = Math.max(1, o.looks ?? SETTLE.looks);
  await new Promise((r) => setTimeout(r, pause));
  let shot = await look();
  for (let n = 1; n < max; n++) {
    // Sin huella no hay con qué comparar: vale la primera, como antes.
    if (!shot.digest) return { shot, steady: false, looks: n };
    await new Promise((r) => setTimeout(r, pause));
    const next = await look();
    o.discard?.(shot);
    if (next.digest === shot.digest) return { shot: next, steady: true, looks: n + 1 };
    shot = next;
  }
  return { shot, steady: max === 1, looks: max };
}

/** Lo que se le dice al modelo cuando la pantalla no llegó a quedarse quieta. */
export const MOVING =
  "(the screen was still changing when this picture was taken: if what you expected is not there yet, look again before acting)";

/** Una mirada no cambia nada: si falla una vez (la conexión, un repintado), se repite una vez. Un clic no se repite. */
export async function twice<T>(fn: () => Promise<T>, pauseMs = 400): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    // Lo que negó la persona o el propio Colonia no se vuelve a intentar.
    if (/emergency stop|not allowed|permission|Linux computer|turned off/i.test(e instanceof Error ? e.message : ""))
      throw e;
    await new Promise((r) => setTimeout(r, pauseMs));
    return fn();
  }
}
