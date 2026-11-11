#!/usr/bin/env node
// The body a release is published with: what the version brings, in Spanish and in English, as every installed Colonia
// reads it back (rules/RELEASE.md › What people are told). The text lives in apps/core/src/release-highlights.ts.
//   node scripts/release-body.ts v2.27.0           # prints the body; exits 1, printing nothing, when there is none
//   node scripts/release-body.ts v2.27.0 --check   # prints nothing; exits 1 unless the highlights are there and fit
// It imports only two files without dependencies, so the release job runs it on plain Node before any install.
import { highlightProblems, highlightsOf } from "../apps/core/src/release-highlights.ts";
import { releaseBody } from "../packages/protocol/src/releases.ts";

const USAGE = "usage: node scripts/release-body.ts <v2.x.y> [--check]";

/** The body for a tag or a version, or none when that version has no highlights. */
export function bodyOf(tag: string): string | undefined {
  const highlights = highlightsOf(tag);
  return highlights ? releaseBody(highlights) : undefined;
}

type Out = (line: string) => void;

/** The command itself: its exit code, with the body on `out` and anything else on `err`. */
export function run(args: readonly string[], out: Out, err: Out): number {
  const check = args.includes("--check");
  const [tag, ...extra] = args.filter((a) => a !== "--check");
  if (!tag || extra.length || !/^v?\d+\.\d+\.\d+$/.test(tag)) {
    err(USAGE);
    return 1;
  }
  const problems = highlightProblems(tag);
  // A body is still printed when a line runs long: only the check holds a release back for it.
  const body = bodyOf(tag);
  if (!body || (check && problems.length)) {
    for (const p of problems) err(p);
    return 1;
  }
  if (check) err(`Colonia ${tag.replace(/^v/, "")}: highlights ready`);
  else out(body);
  return 0;
}

if (import.meta.main) {
  process.exitCode = run(
    process.argv.slice(2),
    (text) => process.stdout.write(text),
    (line) => process.stderr.write(`${line}\n`),
  );
}
