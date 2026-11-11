import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { compareVersions } from "@colonia/protocol";
import { HIGHLIGHT_LIMITS, HIGHLIGHTS, highlightProblems, highlightsOf } from "./release-highlights.ts";
import { localReleases } from "./release-notes.ts";

// The first release whose notes were written for people; older ones never had any.
const FIRST = "2.25.0";

test("every release says what it brings in one to four short lines, the same number in each language", () => {
  for (const version of Object.keys(HIGHLIGHTS)) {
    assert.match(version, /^\d+\.\d+\.\d+$/);
    assert.deepEqual(highlightProblems(version), [], `Colonia ${version}`);
  }
});

test("the version this Colonia is at carries its highlights: a release cannot go out without them", () => {
  // The same answer the running core gives itself: release-notes.json in a packaged build, the last tag in a checkout.
  const version = localReleases(path.resolve(import.meta.dirname, "../../..")).version();
  // A clone without tags does not know its version: the shape rules above still hold every entry.
  if (!version || compareVersions(version, FIRST) < 0) return;
  assert.deepEqual(highlightProblems(version), [], `write the highlights of Colonia ${version} before releasing it`);
});

test("a tag, a dev build and a plain version name the same release; an unknown one has no highlights", () => {
  const known = HIGHLIGHTS["2.26.0"];
  assert.ok(known);
  assert.equal(highlightsOf("v2.26.0"), known);
  assert.equal(highlightsOf("2.26.0-dev.4+abc1234"), known);
  assert.equal(highlightsOf("2.0.0"), undefined);
  assert.equal(highlightsOf("toString"), undefined);
  assert.equal(highlightsOf("not a version"), undefined);
  assert.match(highlightProblems("2.0.0")[0] ?? "", /has no highlights/);
});

test("the limits are the ones the notices are drawn for", () => {
  // Apps up to 2.26.0 read every bullet of a release body, at most eight: both languages must fit.
  assert.ok(HIGHLIGHT_LIMITS.lines * 2 <= 8);
});
