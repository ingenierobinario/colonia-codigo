// What keeps colonia_flow current as Flows grow: every Flow and table method is placed, every step kind is in the skill the
// agent reads, and the tool is the super-agent's alone (rules/FLOWS.md#agents-reach-it, DECISIONS.md#d-181).
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { methods } from "@colonia/protocol";
import { FlowNode } from "@colonia/protocol/flow-graph";
import { SPANISH_TITLES } from "../engine/tool-titles.ts";
import { readSkillFile, skillsFor } from "../skills/skills.ts";
import { FLOW_SETTINGS } from "./flow-tool.ts";
import { settingsCore } from "./settings.test-support.ts";
import { SETTINGS } from "./settings.ts";
import { FLOW_ELSEWHERE, OWNER_ONLY } from "./settings-reach.ts";

let h: Awaited<ReturnType<typeof settingsCore>>;
before(async () => {
  h = await settingsCore({ tool: "colonia_flow" });
  await h.env.client.call("projects.create", { name: "Acme" });
  await h.env.client.call("agents.create", { slug: "acme-writer", name: "Acme Writer" });
});
after(async () => {
  await h.env.core.close();
  await h.env.cleanup();
});

test("every Flow and table method is placed: colonia_flow, the owner's, or left out with a reason", () => {
  const flowish = Object.keys(methods).filter((m) => /^(flows|tables)\./.test(m));
  const placed = [Object.keys(FLOW_SETTINGS), Object.keys(OWNER_ONLY), Object.keys(FLOW_ELSEWHERE)];
  const missing = flowish.filter((m) => !placed.some((list) => list.includes(m)));
  assert.deepEqual(missing, [], "place each new Flow method in tools/flow-tool-*.ts or tools/settings-reach.ts");
  const twice = flowish.filter((m) => placed.filter((list) => list.includes(m)).length > 1);
  assert.deepEqual(twice, []);
  const stale = Object.keys(FLOW_ELSEWHERE).filter((m) => !(m in methods));
  assert.deepEqual(stale, []);
  const effects = Object.keys(FLOW_ELSEWHERE).filter((m) => methods[m as keyof typeof methods].effect);
  assert.deepEqual(effects, [], "a method that changes something is colonia_flow's or the owner's, never left out");
  const inSettings = Object.keys(SETTINGS).filter((m) => /^(flows|tables)\./.test(m));
  assert.deepEqual(inSettings, [], "Flows and tables are the owner's work: colonia_flow, not colonia_settings");
});

test("the colonia-flows skill names every step kind, so an agent can draw a new one", () => {
  const found = skillsFor(h.env.core.store, { home: h.env.home }, undefined).find((s) => s.name === "colonia-flows");
  assert.ok(found, "Colonia ships the colonia-flows skill");
  const skill = readSkillFile(found);
  const kinds = FlowNode.options.map((o) => o.shape.kind.value);
  assert.ok(kinds.includes("webhook") && kinds.includes("http"));
  const missing = kinds.filter((k) => !skill.includes(`| \`${k}\``));
  assert.deepEqual(missing, [], "add each new step kind and its fields to the table in skills/colonia/colonia-flows/SKILL.md");
});

test("only the super-agent is offered colonia_flow, and its index lists Flows and tables", async () => {
  const offered = async (agent: string) => {
    await h.ask("hello", undefined, agent);
    return h.llm.calls.at(-1)?.tools.map((t) => t.function.name) ?? [];
  };
  assert.ok((await offered("superagent")).includes("colonia_flow"));
  assert.ok(!(await offered("acme-writer")).includes("colonia_flow"));
  const index = (await h.ask({})).answer;
  assert.match(index, /^- flows: list, /m);
  assert.match(index, /^- tables: list, /m);
});

test("its card's title says Flow or table, in Spanish", () => {
  const title = SPANISH_TITLES.colonia_flow;
  assert.equal(title?.({ method: "flows.set", params: { id: "x", enabled: true } }), "Cambió un Flow");
  assert.equal(title?.({ method: "tables.remove", params: { project: "p", table: "t" } }), "Quitó una tabla");
  assert.equal(title?.({ method: "flows.list", params: {} }), "Revisó los Flows");
});
