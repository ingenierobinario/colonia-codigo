import assert from "node:assert/strict";
import { test } from "node:test";
import { officeFrameBudget } from "./frame-budget.ts";

test("expensive frames leave time for input instead of saturating every animation tick", () => {
  const budget = officeFrameBudget();
  assert.equal(budget.ready(0), true);
  budget.rendered(0, 120);
  assert.equal(budget.ready(136), false);
  assert.equal(budget.ready(359), false);
  assert.equal(budget.ready(360), true);
  budget.rendered(360, 364);
  assert.equal(budget.ready(396), false);
  assert.equal(budget.ready(556), true);
});

test("fast rendering remains capped and resumes after time spent away", () => {
  const budget = officeFrameBudget();
  budget.rendered(0, 2);
  assert.equal(budget.ready(16), false);
  assert.equal(budget.ready(34), true);
  assert.equal(budget.ready(10_000), true);
});

test("slow initialization cannot postpone explicit changes or leave a long animation pause", () => {
  const budget = officeFrameBudget();
  budget.rendered(0, 5_000);
  assert.equal(budget.ready(5_001, true), true);
  assert.equal(budget.ready(5_249), false);
  assert.equal(budget.ready(5_250), true);
});

test("a graphics stall after submission leaves input time before submitting another frame", () => {
  const budget = officeFrameBudget();
  assert.equal(budget.ready(0), true);
  budget.rendered(0, 2);
  // Drawing returned quickly, but compositing occupied the graphics device until the next animation callback.
  assert.equal(budget.ready(300), false);
  assert.equal(budget.ready(316), false);
  assert.equal(budget.ready(317, true), true);
  assert.equal(budget.ready(550), true);
});
