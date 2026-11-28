import assert from "node:assert/strict";
import { test } from "node:test";
import { type DelegatedInput, type DelegatedState, delegatedFeed } from "./delegated-feed.ts";

function clock() {
  let now = 0;
  const jobs = new Set<{ at: number; run: () => void }>();
  return {
    now: () => now,
    delay(run: () => void, ms: number) {
      const job = { at: now + ms, run };
      jobs.add(job);
      return () => {
        jobs.delete(job);
      };
    },
    advance(ms: number) {
      now += ms;
      for (const job of [...jobs])
        if (job.at <= now) {
          jobs.delete(job);
          job.run();
        }
    },
    jobs,
  };
}
const input: DelegatedInput = {
  thread_id: "child",
  thread_title: "Review",
  agent_id: "reviewer",
  agent_name: "Reviewer",
  expires_at: new Date(2000).toISOString(),
  part: { type: "input", input_id: "request", kind: "confirm", prompt: "Approve?", state: "pending" },
};

test("a delayed read cannot restore a request answered while it was loading", async () => {
  const timers = clock();
  const first = Promise.withResolvers<DelegatedInput[]>();
  const states: DelegatedState[] = [];
  let calls = 0;
  const feed = delegatedFeed(
    () => (++calls === 1 ? first.promise : Promise.resolve([])),
    (state) => states.push(state),
    timers,
  );
  feed.refresh();
  feed.refresh();
  timers.advance(100);
  assert.equal(calls, 1);
  feed.refresh();
  first.resolve([input]);
  await Promise.resolve();
  assert.deepEqual(states, []);
  timers.advance(0);
  await Promise.resolve();
  assert.deepEqual(states, [{ inputs: [], failed: false }]);
  assert.equal(calls, 2);
  feed.close();
  assert.equal(timers.jobs.size, 0);
});

test("expiry refreshes a quiet conversation and closing discards an outstanding response", async () => {
  const timers = clock();
  const late = Promise.withResolvers<DelegatedInput[]>();
  const states: DelegatedState[] = [];
  let calls = 0;
  const feed = delegatedFeed(
    () => (++calls === 1 ? Promise.resolve([input]) : late.promise),
    (state) => states.push(state),
    timers,
  );
  feed.refresh();
  timers.advance(100);
  await Promise.resolve();
  assert.equal(states[0]?.inputs[0]?.part.input_id, "request");
  timers.advance(1901);
  timers.advance(100);
  assert.equal(calls, 2);
  feed.close();
  late.resolve([input]);
  await Promise.resolve();
  assert.equal(states.length, 1);
  assert.equal(timers.jobs.size, 0);
});

test("a failed refresh clears stale cards and can be retried", async () => {
  const timers = clock();
  const states: DelegatedState[] = [];
  let fail = true;
  const feed = delegatedFeed(
    async () => {
      if (fail) throw new Error("offline");
      return [input];
    },
    (state) => states.push(state),
    timers,
  );
  feed.refresh();
  timers.advance(100);
  await Promise.resolve();
  assert.deepEqual(states, [{ inputs: [], failed: true }]);
  fail = false;
  feed.refresh();
  timers.advance(100);
  await Promise.resolve();
  assert.equal(states[1]?.failed, false);
  assert.equal(states[1]?.inputs.length, 1);
  feed.close();
});

test("continuous background activity cannot postpone reads or discard every response", async () => {
  const timers = clock();
  const states: DelegatedState[] = [];
  const loading = Promise.withResolvers<DelegatedInput[]>();
  let calls = 0;
  const feed = delegatedFeed(
    () => {
      calls++;
      return loading.promise;
    },
    (state) => states.push(state),
    timers,
  );
  for (let i = 0; i < 20; i++) {
    feed.changed();
    timers.advance(50);
  }
  assert.equal(calls, 1);
  loading.resolve([input]);
  await Promise.resolve();
  assert.equal(states[0]?.inputs[0]?.part.input_id, "request");
  timers.advance(100);
  await Promise.resolve();
  assert.equal(calls, 2);
  feed.close();
  assert.equal(timers.jobs.size, 0);
});
