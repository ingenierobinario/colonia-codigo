// LAZY-1 · La carga perezosa atiende lo mismo que la directa, carga una sola vez y reintenta si falló.
import assert from "node:assert/strict";
import { test } from "node:test";
import { PROJECT_SHARE_METHODS } from "../server-wiring.ts";
import { lazyHandlers, methodsWith, once } from "./lazy.ts";
import { projectShareHandlers } from "./project-share.ts";

test("PROJECT_SHARE_METHODS son exactamente los de rpc/project-share.ts", () => {
  const h = projectShareHandlers({
    store: {} as never,
    home: "",
    apc: {} as never,
    skillRoots: { home: "", apps: {} as never },
  });
  assert.deepEqual(Object.keys(h).sort(), [...PROJECT_SHARE_METHODS].sort());
});

test("methodsWith lista el espacio entero del protocolo", () => {
  assert.ok(methodsWith("sync.").includes("sync.status"));
  assert.ok(methodsWith("backup.").every((m) => m.startsWith("backup.")));
});

test("lazyHandlers carga una vez y reintenta tras un fallo", async () => {
  let loads = 0;
  let fail = true;
  const h = lazyHandlers(["backup.dismiss"], async () => {
    loads++;
    if (fail) throw new Error("no");
    return { "backup.dismiss": () => ({}) };
  });
  await assert.rejects(Promise.resolve(h["backup.dismiss"]({} as never, {} as never)));
  fail = false;
  assert.deepEqual(await h["backup.dismiss"]({} as never, {} as never), {});
  await h["backup.dismiss"]({} as never, {} as never);
  assert.equal(loads, 2);
  const o = once(async () => ({}));
  assert.equal(o(), o());
});
