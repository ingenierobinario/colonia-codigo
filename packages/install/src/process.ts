import { spawn } from "node:child_process";
import fs from "node:fs";

export type ProcessRunner = (
  command: string,
  args: string[],
  options: {
    signal: AbortSignal;
    detached?: boolean;
    env: NodeJS.ProcessEnv;
    cwd?: string;
    /** A file that receives what the process prints, so a failed start can be explained. */
    output?: string;
    /** How long a detached process must stay up to count as started. */
    settle?: number;
  },
) => Promise<void>;

export const runProcess: ProcessRunner = (command, args, options) =>
  new Promise((resolve, reject) => {
    options.signal.throwIfAborted();
    const out = options.output === undefined ? undefined : fs.openSync(options.output, "w", 0o600);
    // The child holds its own copy of the file; ours is closed whether or not it started.
    const release = () => {
      if (out !== undefined) fs.closeSync(out);
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, args, {
        env: options.env,
        ...(options.cwd ? { cwd: options.cwd } : {}),
        ...(options.detached ? {} : { signal: options.signal }),
        detached: options.detached === true,
        stdio: out === undefined ? "ignore" : ["ignore", out, out],
        // A detached process outlives this one and may open its own windows; hiding it would hide those too.
        windowsHide: options.detached !== true,
      });
    } catch (error) {
      release();
      reject(error);
      return;
    }
    release();
    child.once("error", reject);
    if (options.detached) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const done = (error?: Error) => {
        if (timer) clearTimeout(timer);
        options.signal.removeEventListener("abort", abort);
        child.removeListener("exit", exited);
        child.unref();
        if (error) reject(error);
        else resolve();
      };
      const abort = () => done(new Error("Desktop launch interrupted"));
      const exited = (code: number | null, signal: NodeJS.Signals | null) =>
        done(code === 0 ? undefined : new Error(`Desktop failed to start (${signal ?? code})`));
      child.once("exit", exited);
      options.signal.addEventListener("abort", abort, { once: true });
      child.once("spawn", () => {
        timer = setTimeout(() => done(), options.settle ?? 1500);
      });
    } else
      child.once("exit", (code, signal) =>
        code === 0 ? resolve() : reject(new Error(`${command} failed (${signal ?? code})`)),
      );
  });
