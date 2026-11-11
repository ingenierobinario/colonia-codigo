// The Mac stays awake while Colonia works for the owner (a turn, a command, a computer coming up), and may sleep again
// once nothing does; and a sleep it took anyway is noticed, so the work it cut short is not taken for stuck.
import { spawn as nodeSpawn } from "node:child_process";
import type { RunTimers } from "./engine.ts";

/** What it needs of a child: to end it, and to hear it ended. */
type Held = { kill(): boolean; once(event: "exit" | "error", listener: () => void): unknown };
type Spawn = (cmd: string, args: string[]) => Held;

// ES_CONTINUOUS | ES_SYSTEM_REQUIRED, held by this helper's thread until the core ends (as caffeinate -w). Decimal:
// Windows PowerShell 5.1 reads 0x80000001 as a negative Int32. Sent encoded, so its quotes never meet the command line.
const AWAKE_PS =
  `$k = Add-Type -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint f);'` +
  ` -Name Awake -Namespace Colonia -PassThru; [void]$k::SetThreadExecutionState([uint32]2147483649);` +
  ` try { Wait-Process -Id {pid} -ErrorAction Stop } catch {}`;
const encoded = (script: string) => Buffer.from(script, "utf16le").toString("base64");

/**
 * Holds `caffeinate -i -w <pid>` while `busy()` (macOS only, and only while the owner leaves it on): `-w` ends it with
 * the core even if the core dies without `close`. `update` is called whenever work starts or ends. On Linux the same
 * is asked of systemd (`systemd-inhibit`), and on Windows of the system itself (`SetThreadExecutionState`, held by a
 * hidden PowerShell that waits for the core); a system that has neither, or refuses, is asked once and left alone.
 */
export function keepAwake(o: {
  busy: () => boolean;
  enabled: () => boolean;
  platform?: NodeJS.Platform;
  pid?: number;
  spawn?: Spawn;
}) {
  const platform = o.platform ?? process.platform;
  const spawn: Spawn = o.spawn ?? ((cmd, args) => nodeSpawn(cmd, args, { stdio: "ignore", windowsHide: true }));
  let child: ReturnType<Spawn> | undefined;
  let closed = false;
  let refused = false;
  const pid = String(o.pid ?? process.pid);
  // The inhibitor lasts as long as the command it wraps: one that waits for the core to end.
  const command: [string, string[]] | undefined =
    platform === "darwin"
      ? ["caffeinate", ["-i", "-w", pid]]
      : platform === "linux"
        ? [
            "systemd-inhibit",
            [
              "--what=idle:sleep",
              "--who=Colonia",
              "--why=An agent is working",
              "tail",
              `--pid=${pid}`,
              "-f",
              "/dev/null",
            ],
          ]
        : platform === "win32"
          ? ["powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded(AWAKE_PS.replace("{pid}", pid))]]
          : undefined;
  const release = () => {
    const c = child;
    child = undefined;
    c?.kill();
  };
  return {
    update() {
      if (!command || closed || refused) return;
      const want = o.enabled() && o.busy();
      if (want && !child) {
        const c = spawn(...command);
        child = c;
        // It only ends by itself where it cannot hold anything (no systemd, no leave to block sleep): not asked again.
        const gone = () => {
          if (child !== c) return;
          child = undefined;
          if (platform !== "darwin") refused = true;
        };
        c.once("exit", gone);
        c.once("error", gone);
      } else if (!want && child) release();
    },
    holding: () => Boolean(child),
    close() {
      closed = true;
      release();
    },
  };
}

const wallTimers: RunTimers = {
  now: () => Date.now(),
  after(ms, callback) {
    const timer = setTimeout(callback, ms);
    timer.unref();
    return () => clearTimeout(timer);
  },
};

/** A tick this late means the Mac slept: timers do not run while it does, and fire all at once when it wakes. */
export const SLEEP_GAP_MS = 30_000;
const TICK_MS = 10_000;

/**
 * Notices the Mac's sleeps: a periodic tick that comes `SLEEP_GAP_MS` or more late records a gap, and a tick overdue
 * now is a sleep that just ended (a deadline timer may fire before the tick does).
 */
export function sleepWatch(timers: RunTimers = wallTimers, tickMs = TICK_MS) {
  const gaps: { from: number; to: number }[] = [];
  let expected = timers.now() + tickMs;
  let cancel: (() => void) | undefined;
  const tick = () => {
    const now = timers.now();
    if (now - expected >= SLEEP_GAP_MS) gaps.push({ from: expected, to: now });
    if (gaps.length > 32) gaps.shift();
    expected = now + tickMs;
    cancel = timers.after(tickMs, tick);
  };
  cancel = timers.after(tickMs, tick);
  return {
    /** Whether the Mac slept at some point since `since`. */
    sleptSince(since: number): boolean {
      if (timers.now() - expected >= SLEEP_GAP_MS) return true;
      return gaps.some((g) => g.to >= since);
    },
    close: () => cancel?.(),
  };
}
