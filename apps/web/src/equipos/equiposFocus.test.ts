import assert from "node:assert/strict";
import { test } from "node:test";
import { FOCUS_CLASS, revealEquipo } from "./equiposFocus.ts";

const card = () => {
  const log: string[] = [];
  const classes = new Set<string>();
  return {
    log,
    classes,
    scrollIntoView: (o: ScrollIntoViewOptions) => log.push(`scroll:${o.block}:${o.behavior}`),
    classList: {
      add: (c: string) => {
        classes.add(c);
        log.push(`add:${c}`);
      },
      remove: (c: string) => {
        classes.delete(c);
        log.push(`remove:${c}`);
      },
    },
    get offsetWidth() {
      log.push("reflow");
      return 0;
    },
  };
};

test("EQUIPO-FOCO-1: picking a computer scrolls to its card and flashes it", () => {
  const el = card();
  revealEquipo(el, false);
  assert.deepEqual(el.log, ["scroll:nearest:smooth", `remove:${FOCUS_CLASS}`, "reflow", `add:${FOCUS_CLASS}`]);
  assert.ok(el.classes.has(FOCUS_CLASS));
});

test("EQUIPO-FOCO-1: picking the same computer again restarts the flash", () => {
  const el = card();
  revealEquipo(el, false);
  el.log.length = 0;
  revealEquipo(el, false);
  // The class leaves and the layout is read before it comes back: without that the animation would not replay.
  assert.deepEqual(el.log.slice(1), [`remove:${FOCUS_CLASS}`, "reflow", `add:${FOCUS_CLASS}`]);
});

test("EQUIPO-FOCO-1: with reduced motion the scroll does not animate", () => {
  const el = card();
  revealEquipo(el, true);
  assert.equal(el.log[0], "scroll:nearest:auto");
});
