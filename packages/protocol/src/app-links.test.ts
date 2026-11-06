import assert from "node:assert/strict";
import { test } from "node:test";
import { withoutAppLinks } from "./app-links.ts";

test("a channel message keeps an app link's label and drops where it pointed; web links stay", () => {
  assert.equal(
    withoutAppLinks("Enciéndelo en [Config › Escritorio](colonia:settings/desktop)."),
    "Enciéndelo en Config › Escritorio.",
  );
  assert.equal(
    withoutAppLinks("[docs](https://example.com) y [tareas](Colonia:tasks)"),
    "[docs](https://example.com) y tareas",
  );
});
