import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { tempDir } from "../../../core/src/testkit/platform.ts";
import { runCommand } from "./run-command.ts";
import { ensureAppKey } from "./ssh-login.ts";

/** How many turns the event loop made while `work` ran: 0 means it froze the process (and every window). */
async function loopTurnsDuring(work: () => unknown): Promise<number> {
  let turns = 0;
  let going = true;
  const spin = () => {
    if (!going) return;
    turns++;
    setImmediate(spin);
  };
  setImmediate(spin);
  await work();
  going = false;
  return turns;
}

test("a command run from the main process leaves the event loop running and keeps spawnSync's answer", async () => {
  let result: Awaited<ReturnType<typeof runCommand>> | undefined;
  const turns = await loopTurnsDuring(async () => {
    result = await runCommand(
      process.execPath,
      ["-e", "setTimeout(() => { process.stdout.write('out'); process.stderr.write('err'); process.exit(3) }, 300)"],
      { timeout: 10_000 },
    );
  });
  assert.ok(turns > 5, `the loop turned ${turns} times`);
  assert.deepEqual(result, { status: 3, stdout: "out", stderr: "err" });
});

test("a command past its timeout is killed and answers null, as spawnSync did", async () => {
  const started = Date.now();
  const r = await runCommand(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { timeout: 300 });
  assert.equal(r.status, null);
  assert.ok(Date.now() - started < 10_000);
  assert.equal((await runCommand("colonia-no-such-program", [], { timeout: 1000 })).status, null);
});

test("making the app's ssh key does not freeze the main process", async () => {
  await using dir = tempDir("app-key-");
  let key: string | undefined = "not asked";
  // Node stands in for ssh-keygen: it refuses ssh-keygen's options, after starting up like any program does.
  const turns = await loopTurnsDuring(async () => {
    key = await ensureAppKey(path.join(dir.path, "data"), process.execPath);
  });
  assert.ok(turns > 0, "the loop stood still while ssh-keygen ran");
  assert.equal(key, undefined);
});
