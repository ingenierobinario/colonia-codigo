// RECORDATORIO-SERVIDOR-1 · Frecuencia del recordatorio: 24 h, nunca el primer día, ni con servidor, ni desactivado.
import assert from "node:assert/strict";
import { test } from "node:test";
import { REMINDER_EVERY_MS as DAY, hostingReminderHandlers, readReminder, reminderDue } from "./hosting-reminder.ts";

test("el primer día no se recuerda; pasado, sí", () => {
  assert.equal(reminderDue({ first_seen: 0 }, false, DAY - 1), false);
  assert.equal(reminderDue({ first_seen: 0 }, false, DAY), true);
  assert.equal(reminderDue({}, false, 10 * DAY), false);
});

test("como máximo una vez cada 24 h", () => {
  assert.equal(reminderDue({ first_seen: 0, last_shown: 5 * DAY }, false, 6 * DAY - 1), false);
  assert.equal(reminderDue({ first_seen: 0, last_shown: 5 * DAY }, false, 6 * DAY), true);
});

test("con servidor o con «No volver a recordar» nunca", () => {
  assert.equal(reminderDue({ first_seen: 0 }, true, 9 * DAY), false);
  assert.equal(reminderDue({ first_seen: 0, never: true }, false, 9 * DAY), false);
});

test("lo guardado ilegible se trata como vacío", () => {
  assert.deepEqual(readReminder("{no"), {});
  assert.deepEqual(readReminder('{"first_seen":"x","never":1}'), {});
  assert.deepEqual(readReminder(undefined), {});
});

test("los métodos persisten en los ajustes del núcleo", async () => {
  const kv = new Map<string, string>();
  const store = { settings: { get: (k: string) => kv.get(k), set: (k: string, v: string) => void kv.set(k, v) } };
  let now = 1_000;
  let paired = false;
  const h = hostingReminderHandlers(
    store as never,
    async () => paired,
    () => now,
  );
  const call = (m: "hosting.reminder" | "hosting.reminder_set", p: object) =>
    (h[m] as (p: object) => Promise<{ due: boolean }>)(p);
  assert.deepEqual(await call("hosting.reminder", {}), { due: false });
  now += DAY;
  assert.deepEqual(await call("hosting.reminder", {}), { due: true });
  assert.deepEqual(await call("hosting.reminder_set", { action: "shown" }), { due: false });
  now += DAY;
  // Otra instancia (otro arranque) lee lo mismo: no vive en memoria.
  const again = hostingReminderHandlers(
    store as never,
    async () => paired,
    () => now,
  );
  assert.deepEqual(await (again["hosting.reminder"] as () => Promise<{ due: boolean }>)(), { due: true });
  paired = true;
  assert.deepEqual(await call("hosting.reminder", {}), { due: false });
  paired = false;
  await call("hosting.reminder_set", { action: "never" });
  now += 30 * DAY;
  assert.deepEqual(await call("hosting.reminder", {}), { due: false });
});
