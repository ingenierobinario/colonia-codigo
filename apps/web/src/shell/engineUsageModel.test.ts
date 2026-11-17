import assert from "node:assert/strict";
import { test } from "node:test";
import { remainingOf, remainingTone, showsUsage, windowLabel } from "./engineUsageModel.ts";

const translate = (key: string, vars?: Record<string, string | number>) => `${key}${vars ? `:${vars.minutes}` : ""}`;

test("quota windows use translated durations and fallback names", () => {
  assert.equal(
    windowLabel({ id: "primary", used_percent: 0, window_minutes: 300 }, translate),
    "engineUsage.fiveHours",
  );
  assert.equal(
    windowLabel({ id: "secondary", used_percent: 0, window_minutes: 10080 }, translate),
    "engineUsage.weekly",
  );
  assert.equal(
    windowLabel({ id: "primary", used_percent: 100, window_minutes: 60 }, translate),
    "engineUsage.window:60",
  );
  assert.equal(windowLabel({ id: "primary", used_percent: 5 }, translate), "engineUsage.primary");
  assert.equal(windowLabel({ id: "secondary", used_percent: 5 }, translate), "engineUsage.secondary");
});

test("la barra de cuota mide lo DISPONIBLE, no lo gastado (REV-CUOTAS-1)", () => {
  const w = (used_percent: number) => ({ id: "primary", used_percent, window_minutes: 300 });
  assert.equal(remainingOf(w(0)), 100);
  assert.equal(remainingOf(w(100)), 0);
  assert.equal(remainingOf(w(15)), 85);
  assert.equal(remainingOf(w(33.4)), 67);
  assert.equal(remainingOf(w(140)), 0);
  assert.equal(remainingOf(w(-5)), 100);
  assert.equal(remainingOf(w(Number.NaN)), 0);
  assert.equal(remainingTone(0), "danger");
  assert.equal(remainingTone(15), "warning");
  assert.equal(remainingTone(85), "brand");
});

test("un motor sin fuente de cuota compatible no se enseña (sin jerga en el globo)", () => {
  assert.equal(showsUsage({ reason: "unsupported" } as never), false);
  assert.equal(showsUsage({ reason: "signed_out" } as never), true);
  assert.equal(showsUsage({} as never), true);
});
