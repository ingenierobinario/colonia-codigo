import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { RUNS_SCRIPTS, tempDir } from "../testkit/platform.ts";
import { toOggOpus } from "./audio.ts";

// A script stands in for ffmpeg (RUNS_SCRIPTS).
if (RUNS_SCRIPTS)
  test("a voice note is converted by an ffmpeg found only in the usual folders, not on the service's PATH", async (t) => {
    await using home = tempDir();
    const bin = path.join(home.path, ".local", "bin");
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, "ffmpeg"), "#!/bin/sh\ncat >/dev/null\nprintf converted\n", { mode: 0o755 });
    const before = { HOME: process.env.HOME, PATH: process.env.PATH };
    process.env.HOME = home.path;
    process.env.PATH = "/usr/bin:/bin";
    t.after(() => Object.assign(process.env, before));
    assert.equal(String(await toOggOpus(Buffer.from("audio"))), "converted");
  });
