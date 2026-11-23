// RECORDATORIO-SERVIDOR-1 · Una vez cada 24 h, si este Colonia no tiene servidor vinculado, el panel recuerda que
// los agentes se paran al apagar el ordenador. Nunca el primer día ni tras «No volver a recordar».
import type { Store } from "../domain/store.ts";
import type { Handlers } from "./router.ts";

export const REMINDER_KEY = "hosting_reminder";
export const REMINDER_EVERY_MS = 24 * 60 * 60_000;

export type ReminderState = { first_seen?: number; last_shown?: number; never?: boolean };

/** Toca enseñarlo: sin servidor, sin «no volver», pasado el primer día y 24 h después del último. */
export function reminderDue(state: ReminderState, paired: boolean, now: number): boolean {
  if (paired || state.never) return false;
  if (state.first_seen === undefined || now - state.first_seen < REMINDER_EVERY_MS) return false;
  return state.last_shown === undefined || now - state.last_shown >= REMINDER_EVERY_MS;
}

export function readReminder(raw: string | undefined): ReminderState {
  try {
    const v = JSON.parse(raw ?? "{}") as Record<string, unknown>;
    const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : undefined);
    const first = num(v.first_seen);
    const last = num(v.last_shown);
    return {
      ...(first !== undefined ? { first_seen: first } : {}),
      ...(last !== undefined ? { last_shown: last } : {}),
      ...(v.never === true ? { never: true } : {}),
    };
  } catch {
    return {};
  }
}

export function hostingReminderHandlers(store: Store, paired: () => Promise<boolean>, clock: () => number = Date.now) {
  const load = () => {
    const state = readReminder(store.settings.get(REMINDER_KEY));
    // El primer arranque que pregunta marca el día uno: ese día no se recuerda nada.
    if (state.first_seen === undefined) {
      state.first_seen = clock();
      store.settings.set(REMINDER_KEY, JSON.stringify(state));
    }
    return state;
  };
  const due = async (state: ReminderState) => reminderDue(state, await paired().catch(() => false), clock());
  return {
    "hosting.reminder": async () => ({ due: await due(load()) }),
    "hosting.reminder_set": async ({ action }) => {
      const state = load();
      if (action === "never") state.never = true;
      else state.last_shown = clock();
      store.settings.set(REMINDER_KEY, JSON.stringify(state));
      return { due: await due(state) };
    },
  } satisfies Partial<Handlers>;
}
