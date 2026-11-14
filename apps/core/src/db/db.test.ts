import assert from "node:assert/strict";
import { test } from "node:test";
import { removeDir, tempDir } from "../testkit/platform.ts";
import { openDb } from "./db.ts";

test("PERF-8: the database is opened in WAL with synchronous NORMAL, foreign keys on", () => {
  const home = tempDir("colonia-db-").path;
  const db = openDb(home);
  try {
    const one = (sql: string) => Object.values(db.prepare(sql).get() as Record<string, unknown>)[0];
    assert.equal(one("PRAGMA journal_mode"), "wal");
    assert.equal(one("PRAGMA synchronous"), 1);
    assert.equal(one("PRAGMA foreign_keys"), 1);
  } finally {
    db.close();
    removeDir(home);
  }
});
