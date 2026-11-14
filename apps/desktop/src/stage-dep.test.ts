import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { dependents, stageSingleFile } from "../scripts/stage-dep.ts";

// kysely is the core's dependency, not this package's: its types are not in reach here.
// biome-ignore lint/suspicious/noExplicitAny: a library loaded by path, used through its runtime shape
type Lib = Record<string, any>;

const real = fs.realpathSync(path.resolve(import.meta.dirname, "../../core/node_modules/kysely"));

test("PERF-6: kysely staged as one file exports what the installed one does and builds the same SQL", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "colonia-stage-dep-"));
  try {
    const dir = path.join(home, "node_modules", "kysely");
    fs.cpSync(real, dir, { recursive: true, dereference: true });
    fs.mkdirSync(path.join(home, "node_modules", "@scope", "other"), { recursive: true });
    fs.writeFileSync(
      path.join(home, "node_modules", "@scope", "other", "package.json"),
      JSON.stringify({ name: "@scope/other", dependencies: { zod: "1" } }),
    );
    assert.deepEqual(dependents(path.join(home, "node_modules"), "kysely"), []);
    assert.deepEqual(dependents(path.join(home, "node_modules"), "zod"), ["@scope/other"]);
    await stageSingleFile(dir);
    const files = fs.readdirSync(dir).sort();
    assert.deepEqual(files, ["LICENSE", "index.js", "package.json"]);
    // Resolved by its bare name from a file beside node_modules, as the installed core does.
    const probe = path.join(home, "probe.mjs");
    fs.writeFileSync(probe, 'export * as staged from "kysely";');
    const { staged } = (await import(pathToFileURL(probe).href)) as { staged: Lib };
    const original = (await import(pathToFileURL(path.join(real, "dist/index.js")).href)) as Lib;
    assert.deepEqual(Object.keys(staged).sort(), Object.keys(original).sort());
    const sqlOf = (k: Lib) => {
      const q = new k.Kysely({
        dialect: {
          createAdapter: () => new k.SqliteAdapter(),
          createDriver: () => new k.DummyDriver(),
          createIntrospector: (db: unknown) => new k.SqliteIntrospector(db),
          createQueryCompiler: () => new k.SqliteQueryCompiler(),
        },
      })
        .selectFrom("inbox")
        .select(["n"])
        .where("channel", "in", ["wa-1", "wa-2"])
        .orderBy("n", "desc")
        .limit(2)
        .compile();
      return { sql: q.sql, parameters: q.parameters };
    };
    assert.deepEqual(sqlOf(staged), sqlOf(original));
    assert.deepEqual(sqlOf(staged), {
      sql: 'select "n" from "inbox" where "channel" in (?, ?) order by "n" desc limit ?',
      parameters: ["wa-1", "wa-2", 2],
    });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
