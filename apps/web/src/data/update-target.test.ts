import assert from "node:assert/strict";
import { test } from "node:test";
import { packageCommandOf, updateTarget } from "./update-target.ts";

const app = { current: "2.0.0", latest: "2.1.0", notes: [], install: "auto" as const };
const core = { source: "release" as const, behind: 1, latest: "2.1.0", changes: [] };

test("remote Desktop never offers an app-only update even if the core reports no newer release", () => {
  assert.deepEqual(updateTarget({ ...core, behind: 0 }, app, true, true), { target: "both", version: "2.1.0" });
  assert.deepEqual(updateTarget(undefined, app, true, true), { target: "both", version: "2.1.0" });
  assert.deepEqual(updateTarget(core, undefined, true, true), { target: "both", version: "2.1.0" });
});

test("local bundled Desktop still offers its app while a browser offers only its core", () => {
  assert.deepEqual(updateTarget({ ...core, source: "app" }, app, false, true), { target: "app", version: "2.1.0" });
  assert.equal(updateTarget({ ...core, source: "app" }, undefined, false, true), undefined);
  assert.deepEqual(updateTarget(core, undefined, false, false), { target: "core", version: "2.1.0" });
  assert.equal(updateTarget({ ...core, behind: 0 }, undefined, false, false), undefined);
});

test("a package install says its command only for the app's own downloaded update", () => {
  const command = "sudo apt install '/home/ana/Downloads/Colonia-2.4.0-linux-amd64.deb'";
  const app = { current: "2.3.0", latest: "2.4.0", notes: [], install: "drag" as const, command };
  assert.equal(packageCommandOf(app, "app"), command);
  assert.equal(packageCommandOf(app, "core"), undefined);
  assert.equal(packageCommandOf({ ...app, install: "auto" }, "app"), undefined);
  assert.equal(packageCommandOf({ ...app, command: undefined }, "app"), undefined);
  assert.equal(packageCommandOf(undefined, "app"), undefined);
});
