import assert from "node:assert/strict";
import { test } from "node:test";
import { HIGHLIGHTS } from "../apps/core/src/release-highlights.ts";
import { newerReleases } from "../packages/protocol/src/releases.ts";
import { bodyOf, run } from "./release-body.ts";

const call = (...args: string[]) => {
  const out: string[] = [];
  const err: string[] = [];
  const code = run(
    args,
    (t) => out.push(t),
    (t) => err.push(t),
  );
  return { code, out: out.join(""), err: err.join("\n") };
};

test("the body of a release reads back, in an installed Colonia, as its highlights in each language", () => {
  for (const [version, highlights] of Object.entries(HIGHLIGHTS)) {
    const r = call(`v${version}`);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /^## Español\n\n- /);
    assert.match(r.out, /\n\n## English\n\n- /);
    const [release] = newerReleases([{ tag_name: `v${version}`, body: r.out }], "2.0.0");
    assert.deepEqual(release?.localized, highlights);
    // Apps up to 2.26.0 show every bullet, at most eight: both languages must fit.
    assert.ok(r.out.split("\n").filter((l) => l.startsWith("- ")).length <= 8);
  }
});

test("a tag and a plain version give the same body", () => {
  assert.equal(bodyOf("2.26.0"), bodyOf("v2.26.0"));
  assert.equal(call("2.26.0").out, call("v2.26.0").out);
});

test("a version without highlights prints nothing and exits 1, with or without --check", () => {
  for (const args of [["v2.0.1"], ["v2.0.1", "--check"], ["--check", "v2.0.1"]]) {
    const r = call(...args);
    assert.equal(r.code, 1);
    assert.equal(r.out, "");
    assert.match(r.err, /Colonia 2\.0\.1 has no highlights/);
  }
  assert.equal(bodyOf("v2.0.1"), undefined);
});

test("--check says a release is ready without printing its body", () => {
  const r = call("v2.26.0", "--check");
  assert.equal(r.code, 0);
  assert.equal(r.out, "");
  assert.match(r.err, /Colonia 2\.26\.0: highlights ready/);
});

test("anything that is not one version is refused with the usage", () => {
  for (const args of [[], ["--check"], ["main"], ["v2.26.0", "v2.27.0"], ["v2.26.0-rc.1"]]) {
    const r = call(...args);
    assert.equal(r.code, 1);
    assert.equal(r.out, "");
    assert.match(r.err, /^usage: /);
  }
});
