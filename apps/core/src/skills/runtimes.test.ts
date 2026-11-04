import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { apply, plan, readSkills, runtimes, type Skill, sourceDir } from "./runtimes.ts";

const tmpHome = () => fs.mkdtempSync(path.join(os.tmpdir(), "colonia-runtime-skills-"));
const write = (file: string, text: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const skills: Skill[] = [
  { name: "colonia", files: { "SKILL.md": "---\nname: colonia\n---\nnew\n" } },
  { name: "apc-context", files: { "SKILL.md": "---\nname: apc-context\n---\n", "notes/extra.md": "x" } },
];
const actions = (p: ReturnType<typeof plan>) => p.steps.map((s) => `${s.runtime.id}:${s.name}:${s.action}`).sort();

test("the shipped skills each have a SKILL.md with a matching name", () => {
  const shipped = readSkills(sourceDir());
  assert.deepEqual(
    shipped.map((s) => s.name),
    ["apc-context", "colonia", "colonia-extensions", "colonia-mcp"],
  );
  for (const s of shipped) assert.match(s.files["SKILL.md"] ?? "", new RegExp(`^---\\nname: ${s.name}\\n`));
});

test("only installed runtimes are planned; CODEX_HOME moves Codex", () => {
  const home = tmpHome();
  fs.mkdirSync(path.join(home, ".claude"));
  const codex = path.join(home, "elsewhere", "codex");
  fs.mkdirSync(codex, { recursive: true });
  const p = plan(skills, runtimes({ home, codex }));
  assert.deepEqual(p.missing.map((r) => r.id).sort(), ["agents", "cursor"]);
  assert.deepEqual(actions(p), [
    "claude:apc-context:create",
    "claude:colonia:create",
    "codex:apc-context:create",
    "codex:colonia:create",
  ]);
  assert.ok(p.steps.some((s) => s.dir === path.join(codex, "skills", "colonia")));
});

test("install creates, updates, removes retired Colonia skills and leaves every other skill alone", () => {
  const home = tmpHome();
  const dir = path.join(home, ".claude", "skills");
  write(path.join(dir, "colonia", "SKILL.md"), "old v1 text");
  write(path.join(dir, "colonia", "stale.md"), "from an older version");
  write(path.join(dir, "colonia-runtime", "SKILL.md"), "retired");
  write(path.join(dir, "someone-else", "SKILL.md"), "not ours");
  const targets = runtimes({ home }).filter((r) => r.id === "claude");

  const first = plan(skills, targets);
  assert.deepEqual(actions(first), ["claude:apc-context:create", "claude:colonia-runtime:remove", "claude:colonia:update"]);
  apply(first, skills);

  assert.equal(fs.readFileSync(path.join(dir, "colonia", "SKILL.md"), "utf8"), skills[0]?.files["SKILL.md"]);
  assert.ok(!fs.existsSync(path.join(dir, "colonia", "stale.md")), "an Colonia skill folder becomes an exact copy");
  assert.equal(fs.readFileSync(path.join(dir, "apc-context", "notes", "extra.md"), "utf8"), "x");
  assert.ok(!fs.existsSync(path.join(dir, "colonia-runtime")));
  assert.equal(fs.readFileSync(path.join(dir, "someone-else", "SKILL.md"), "utf8"), "not ours");

  assert.deepEqual(actions(plan(skills, targets)), ["claude:apc-context:unchanged", "claude:colonia:unchanged"]);
});

test("a link in place of a skill is left alone; a retired one is unlinked without touching its target", () => {
  const home = tmpHome();
  const dir = path.join(home, ".agents", "skills");
  const target = path.join(home, "shared", "colonia");
  write(path.join(target, "SKILL.md"), "someone's own");
  fs.mkdirSync(dir, { recursive: true });
  fs.symlinkSync(target, path.join(dir, "colonia"));
  fs.symlinkSync(target, path.join(dir, "colonia-task"));
  const targets = runtimes({ home }).filter((r) => r.id === "agents");

  const p = plan(skills, targets);
  assert.deepEqual(actions(p), ["agents:apc-context:create", "agents:colonia-task:remove", "agents:colonia:skip-link"]);
  apply(p, skills);
  assert.ok(fs.lstatSync(path.join(dir, "colonia")).isSymbolicLink());
  assert.ok(!fs.existsSync(path.join(dir, "colonia-task")));
  assert.equal(fs.readFileSync(path.join(target, "SKILL.md"), "utf8"), "someone's own");
});

test("a dry plan writes nothing", () => {
  const home = tmpHome();
  fs.mkdirSync(path.join(home, ".cursor"));
  plan(skills, runtimes({ home }));
  assert.ok(!fs.existsSync(path.join(home, ".cursor", "skills")));
});
