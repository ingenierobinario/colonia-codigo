import assert from "node:assert/strict";
import { test } from "node:test";
import type { Store } from "../domain/store.ts";
import { searchEarlier } from "./media.ts";

const store = {
  modelLog: {
    list: () => [
      { seq: 1, run_id: "a", item: { role: "user", content: "el fichero es config.yaml" } },
      { seq: 2, run_id: "a", item: { role: "assistant", content: "vale" } },
      { seq: 3, run_id: "b", item: { role: "tool", content: "leído CONFIG.yaml entero" } },
    ],
  },
} as unknown as Store;

test("search_earlier finds the whole log, newest first, any case (D-186)", () => {
  const r = searchEarlier(store, "t", "config.yaml", 8);
  assert.match(r, /^#3 tool:[\s\S]*#1 user:/);
  assert.match(searchEarlier(store, "t", "config", 1), /^#3/);
  assert.match(searchEarlier(store, "t", "nada", 8), /nothing earlier/);
});
