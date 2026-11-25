import assert from "node:assert/strict";
import { test } from "node:test";
import { Agent, Job, Thread } from "@colonia/protocol";
import { officeActivity } from "./activity.ts";

const at = "2026-01-01T00:00:00.000Z";
const agent = Agent.parse({ id: "a", name: "A", kind: "agent" });
const thread = (id: string, state: string) =>
  Thread.parse({ id, title: id, kind: "agent", state, agent_ids: ["a"], created_at: at, updated_at: at });
const job = (id: string, state: string, activity: string) =>
  Job.parse({
    id,
    kind: "agent",
    title: id,
    thread_id: id,
    agent_id: "a",
    state,
    trigger: "user",
    tool_calls: 1,
    started_at: at,
    activity,
  });

test("the office includes work outside loaded chats and counts each active conversation once", () => {
  const result = officeActivity(
    [agent],
    [job("outside", "working", "Reading\n the project"), job("known", "working", "Writing")],
    [thread("known", "working")],
    true,
  ).get("a");
  assert.equal(result?.presence, "working");
  assert.equal(result.active, 2);
  assert.equal(result.threadId, "outside");
  assert.equal(result.summary, "Reading the project");
});

test("a request for the owner takes priority, completed work is idle, and disconnected agents are never shown as working", () => {
  const threads = [thread("waiting", "input-required"), thread("queued", "queued")];
  const jobs = [job("running", "working", "Long task")];
  assert.equal(officeActivity([agent], jobs, threads, true).get("a")?.threadId, "waiting");
  assert.deepEqual(officeActivity([agent], jobs, threads, false).get("a"), {
    presence: "offline",
    summary: "",
    active: 0,
  });
  assert.equal(officeActivity([agent], [], [thread("done", "completed")], true).get("a")?.presence, "idle");
});
