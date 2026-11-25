import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

const exec = promisify(execFile);
const run = async (command: string, args: string[]) => (await exec(command, args, { windowsHide: true })).stdout.trim();
export type ProcessUsage = { rss: number; cpu: number; at: number };

function checked(rss: number, cpu: number) {
  if (!Number.isFinite(rss) || rss <= 0 || !Number.isFinite(cpu) || cpu < 0)
    throw new Error("Invalid process usage sample");
  return { rss, cpu };
}

/** Linux ps rounds CPU time to whole seconds; proc retains the kernel tick precision. */
export function linuxUsage(stat: string, status: string, ticks: number) {
  const close = stat.lastIndexOf(") ");
  if (close < 0 || !Number.isFinite(ticks) || ticks <= 0) throw new Error("Invalid Linux process sample");
  const fields = stat
    .slice(close + 2)
    .trim()
    .split(/\s+/);
  const rss = status.match(/^VmRSS:\s+(\d+)\s+kB\s*$/m);
  return checked(Number(rss?.[1]) / 1024, (Number(fields[11]) + Number(fields[12])) / ticks);
}

/** BSD ps uses fractional seconds and may include a day prefix for long-running processes. */
export function psUsage(output: string) {
  const [rss, time = ""] = output.trim().split(/\s+/);
  const match = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/.exec(time);
  if (!match) throw new Error("Invalid ps process sample");
  const cpu = Number(match[1] ?? 0) * 86400 + Number(match[2] ?? 0) * 3600 + Number(match[3]) * 60 + Number(match[4]);
  return checked(Number(rss) / 1024, cpu);
}

let clockTicks: Promise<number> | undefined;
export async function processUsage(pid: number): Promise<ProcessUsage> {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error("Invalid process id");
  const start = performance.now();
  let usage: { rss: number; cpu: number };
  if (process.platform === "linux") {
    clockTicks ??= run("getconf", ["CLK_TCK"]).then(Number);
    const [stat, status, ticks] = await Promise.all([
      readFile(`/proc/${pid}/stat`, "utf8"),
      readFile(`/proc/${pid}/status`, "utf8"),
      clockTicks,
    ]);
    usage = linuxUsage(stat, status, ticks);
  } else if (process.platform === "win32") {
    const output = await run("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `$ErrorActionPreference = 'Stop'; $p = Get-Process -Id ${pid}; [Console]::Out.Write(('{0} {1}' -f $p.WorkingSet64, $p.TotalProcessorTime.TotalMilliseconds.ToString([cultureinfo]::InvariantCulture)))`,
    ]);
    const [bytes, ms] = output.split(/\s+/);
    usage = checked(Number(bytes) / 1024 / 1024, Number(ms) / 1000);
  } else {
    usage = psUsage(await run("ps", ["-o", "rss=,time=", "-p", String(pid)]));
  }
  return { ...usage, at: (start + performance.now()) / 2 };
}

export function cpuPercent(before: ProcessUsage, after: ProcessUsage) {
  const elapsed = after.at - before.at;
  const cpu = after.cpu - before.cpu;
  if (elapsed <= 0 || cpu < 0 || !Number.isFinite(elapsed) || !Number.isFinite(cpu))
    throw new Error("Invalid process usage interval");
  return (cpu / (elapsed / 1000)) * 100;
}
