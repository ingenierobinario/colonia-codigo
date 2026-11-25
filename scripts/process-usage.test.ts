import assert from "node:assert/strict";
import { test } from "node:test";
import { cpuPercent, linuxUsage, processUsage, psUsage } from "./process-usage.ts";

test("Linux idle sampling preserves ticks across a whole CPU second", () => {
  const stat = (user: number, system: number) =>
    `123 (name ) with spaces) S 1 2 3 4 5 6 7 8 9 10 ${user} ${system} 0 0`;
  const before = linuxUsage(stat(90, 9), "Name:\ttest\nVmRSS:\t2048 kB\n", 100);
  const after = linuxUsage(stat(91, 9), "VmRSS:\t2048 kB\n", 100);
  assert.equal(before.rss, 2);
  assert.equal(before.cpu, 0.99);
  assert.ok(Math.abs(cpuPercent({ ...before, at: 0 }, { ...after, at: 5000 }) - 0.2) < 1e-9);
});

test("ps accepts fractional and multi-day CPU times", () => {
  assert.deepEqual(psUsage(" 2048 0:01.25 "), { rss: 2, cpu: 1.25 });
  assert.deepEqual(psUsage("4096 2-03:04:05.50"), { rss: 4, cpu: 183845.5 });
});

test("measurement failure cannot masquerade as zero resource use", () => {
  for (const output of ["", "0 0:00", "2048 unknown", "NaN 0:01"]) assert.throws(() => psUsage(output));
  assert.throws(() => linuxUsage("", "", 100));
  assert.throws(() => cpuPercent({ rss: 1, cpu: 1, at: 20 }, { rss: 1, cpu: 2, at: 20 }));
  assert.equal(cpuPercent({ rss: 1, cpu: 1, at: 0 }, { rss: 1, cpu: 1.1, at: 10000 }).toFixed(2), "1.00");
});

test("the host sampler reads a live process and rejects a missing one", async () => {
  const sample = await processUsage(process.pid);
  assert.ok(sample.rss > 0 && sample.cpu >= 0 && sample.at > 0);
  await assert.rejects(processUsage(2147483647));
});
