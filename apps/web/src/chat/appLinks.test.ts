import assert from "node:assert/strict";
import { test } from "node:test";

const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: { location: { origin: "http://panel.example.test", hash: "" }, addEventListener() {} },
});
const { appPlace } = await import("./appLinks.ts");
if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor);
else Reflect.deleteProperty(globalThis, "window");

const kindOf = (href: string) => {
  const place = appPlace(href);
  if (!place) return undefined;
  const { open: _open, ...rest } = place;
  return rest;
};

test("an app link says what it opens, so its button can show the place's icon and hint", () => {
  assert.deepEqual(kindOf("colonia:tasks/task_0123abcd"), { kind: "task", id: "task_0123abcd" });
  assert.deepEqual(kindOf("colonia:tasks"), { kind: "tasks" });
  assert.deepEqual(kindOf("colonia:flows"), { kind: "flows" });
  assert.deepEqual(kindOf("colonia:flows/prj_1"), { kind: "flows", project: "prj_1" });
  assert.deepEqual(kindOf("colonia:flows/prj_1/inbox"), { kind: "flows", project: "prj_1", flow: "inbox" });
  assert.deepEqual(kindOf("colonia:flows/prj_1/inbox/edit"), { kind: "flows", project: "prj_1", flow: "inbox" });
  assert.equal(kindOf("colonia:flows/prj_1/inbox/delete"), undefined);
  assert.equal(kindOf("colonia:tasks/task_1/more/edit"), undefined);
  assert.deepEqual(kindOf("colonia:settings/desktop"), { kind: "settings", section: "desktop" });
  assert.deepEqual(kindOf("colonia:config"), { kind: "settings", section: "account" });
  assert.deepEqual(kindOf("colonia:resources/mcp"), { kind: "resources", tab: "mcp" });
  assert.deepEqual(kindOf("colonia:inbox"), { kind: "inbox" });
  assert.deepEqual(kindOf("colonia:chat/thr_1"), { kind: "chat", id: "thr_1" });
  assert.deepEqual(kindOf("colonia:project/prj_1/tasks"), { kind: "project", id: "prj_1" });
  // An agent that could not start the computer points the owner to its panel.
  assert.deepEqual(kindOf("colonia:computer"), { kind: "computer" });
  assert.deepEqual(kindOf("colonia:computers"), { kind: "computer" });
});

test("an app link to no known place opens nothing", () => {
  for (const href of ["colonia:settings/nowhere", "colonia:resources/nope", "colonia:chat", "colonia:project", "colonia:elsewhere"])
    assert.equal(appPlace(href), undefined, href);
});
