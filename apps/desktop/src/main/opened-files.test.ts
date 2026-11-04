import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { openedIn, openedQueue, readOpened } from "./opened-files.ts";

test("only Colonia files that exist count among a launch's arguments, flags and other files never", () => {
  const exists = (p: string) => !p.includes("missing");
  const argv = ["/Applications/Colonia.app/x", "--colonia-adopt-local", "~/work/Pantry.COLONIAART", "notes.txt", "missing.coloniaext"];
  assert.deepEqual(openedIn(argv, exists), [path.resolve("~/work/Pantry.COLONIAART")]);
});

test("an opened file is read once by the panel; a huge or missing one says why instead", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "colonia-opened-"));
  try {
    const art = path.join(dir, "pantry.coloniaart");
    fs.writeFileSync(art, '{"format":"colonia-artifact@1"}');
    assert.deepEqual(readOpened(art, 10), { name: "pantry.coloniaart", error: "too-big" });
    assert.deepEqual(readOpened(path.join(dir, "gone.coloniaart")), { name: "gone.coloniaart", error: "unreadable" });

    let told = 0;
    const q = openedQueue(() => told++);
    q.add([art, art, path.join(dir, "notes.txt")]);
    assert.equal(told, 1);
    assert.deepEqual(q.take(), [{ name: "pantry.coloniaart", text: '{"format":"colonia-artifact@1"}' }]);
    assert.deepEqual(q.take(), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
