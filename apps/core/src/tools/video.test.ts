import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { useOwnerShell } from "../harness/env.ts";
import { RUNS_SCRIPTS, tempDir } from "../testkit/platform.ts";
import { publicVideoUrl, videoTools, vttText } from "./video.ts";

test("captions read as timed paragraphs, the scrolling repeats of automatic captions dropped", () => {
  const vtt = [
    "WEBVTT",
    "Kind: captions",
    "Language: es",
    "",
    "00:00:01.000 --> 00:00:03.000",
    "hola <c>a</c> todos",
    "",
    "00:00:03.000 --> 00:00:05.000",
    "hola a todos",
    "hoy hablamos de memoria",
    "",
    "00:00:40.500 --> 00:00:42.000",
    "y del prefill",
  ].join("\n");
  assert.equal(vttText(vtt), "[0:01] hola a todos hoy hablamos de memoria\n[0:40] y del prefill");
});

test("only a public site's page is fetched, never this machine or a private address", () => {
  assert.ok(publicVideoUrl("https://youtu.be/abc123"));
  assert.ok(publicVideoUrl("https://www.youtube.com/watch?v=abc"));
  for (const bad of [
    "http://127.0.0.1:7440/rpc",
    "http://localhost/x",
    "file:///etc/hosts",
    "http://[::1]/",
    "http://intranet/x",
    "nope",
  ])
    assert.equal(publicVideoUrl(bad), false, bad);
});

test("without yt-dlp the tool is not offered", () => {
  assert.deepEqual(videoTools(undefined), []);
  assert.equal(videoTools("/usr/bin/true")[0]?.name, "video_transcript");
});

// A script stands in for yt-dlp (RUNS_SCRIPTS).
if (RUNS_SCRIPTS)
  test("yt-dlp runs with the PATH agents get, so its own helpers (ffmpeg) are found", async (t) => {
    await using dir = tempDir();
    const fake = path.join(dir.path, "yt-dlp");
    fs.writeFileSync(fake, `#!/bin/sh\nprintf '{"title":"%s"}' "$PATH"\n`, { mode: 0o755 });
    useOwnerShell(true, {
      shell: { ask() {}, current: () => ({ PATH: "/opt/colonia-test-helpers/bin" }), settled: async () => {} },
    });
    t.after(() => useOwnerShell(false));
    const tool = videoTools(fake)[0];
    assert.ok(tool);
    const out = String(
      await tool.run({ url: "https://youtu.be/abc123" }, { signal: AbortSignal.timeout(10_000) } as never),
    );
    assert.match(out, /\/opt\/colonia-test-helpers\/bin/);
  });
