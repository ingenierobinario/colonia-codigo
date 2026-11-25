import assert from "node:assert/strict";
import { test } from "node:test";
import { computeLayout, LAYOUT } from "./layout.ts";

test("narrow windows show one whole column, and resized columns leave room for the chat", () => {
  for (const width of [390, 650, 750]) {
    for (const panel of [false, true]) {
      const l = computeLayout(width, panel, true);
      assert.equal(l.compact, true);
      assert.equal(l.sidebarW + (panel ? l.panelW : l.listW), width);
    }
  }
  for (const width of [780, 800, 900, 1320, 1600]) {
    for (const panel of [false, true]) {
      for (const own of [{}, { listW: 520, sidebarW: 380 }, { panelWide: true }, { panelW: 5000 }]) {
        const l = computeLayout(width, panel, true, "medium", own);
        assert.ok(
          width - l.sidebarW - l.listW - (panel ? l.panelW : 0) >= LAYOUT.chatMinW,
          `${width}, panel=${panel}, ${JSON.stringify(own)}`,
        );
      }
    }
  }
});

test("a dragged side panel keeps its width within the chat's minimum", () => {
  const l = computeLayout(1800, true, true, "medium", { panelW: 700 });
  assert.equal(l.panelW, 700);
  assert.ok(l.listW > 0, "room left for the list");
  const max = computeLayout(1600, true, true, "medium", { panelW: 5000 });
  assert.equal(max.panelW, max.panelMaxW);
  assert.equal(1600 - max.sidebarW - max.panelW, LAYOUT.chatMinW);
  assert.equal(computeLayout(1600, true, true, "medium", { panelW: 10 }).panelW, LAYOUT.panelMinW);
});

test("a panel dragged into the list's room folds the list away", () => {
  const l = computeLayout(1600, true, true, "medium", { panelW: 900 });
  assert.equal(l.listW, 0);
});

test("no dragged width keeps the usual panel", () => {
  assert.equal(computeLayout(1600, true, true).panelW, LAYOUT.panelW);
});

test("a folded chat list leaves its strip, and a phone still shows the whole list", () => {
  assert.equal(computeLayout(1200, false, true, "medium", { listCollapsed: true, listW: 400 }).listW, LAYOUT.listRailW);
  assert.equal(computeLayout(1200, false, true).listW, LAYOUT.listW);
  const phone = computeLayout(390, false, false, "medium", { listCollapsed: true });
  assert.ok(phone.compact && phone.listW > LAYOUT.listRailW);
});
