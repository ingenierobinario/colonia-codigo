// A short command run from the main process without stopping it: spawnSync there freezes every window until the
// command ends (ssh to a slow server, the bundled terminal), so this is spawn with spawnSync's answer and timeout.
import { spawn } from "node:child_process";

export interface CommandResult {
  /** The exit code; null when it could not start, was killed by its timeout or died from a signal (as spawnSync). */
  status: number | null;
  stdout: string;
  stderr: string;
}

export function runCommand(
  command: string,
  args: string[],
  opts: { timeout: number; env?: NodeJS.ProcessEnv; stdout?: boolean },
): Promise<CommandResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let done = false;
    let timer: NodeJS.Timeout | undefined;
    const finish = (status: number | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, args, {
        env: opts.env,
        stdio: ["ignore", opts.stdout === false ? "ignore" : "pipe", "pipe"],
        windowsHide: true,
      });
    } catch {
      finish(null);
      return;
    }
    timer = setTimeout(() => {
      child.kill();
      finish(null);
    }, opts.timeout);
    child.stdout?.setEncoding("utf8").on("data", (d: string) => {
      stdout += d;
    });
    child.stderr?.setEncoding("utf8").on("data", (d: string) => {
      stderr += d;
    });
    child.on("error", () => finish(null));
    child.on("close", (code) => finish(code));
  });
}
