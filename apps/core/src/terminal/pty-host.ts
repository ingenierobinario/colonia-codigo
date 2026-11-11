// Runs a command on the native pty (@lydell/node-pty: ConPTY on Windows) and relays it over stdin/stdout, the same
// protocol pty-bridge.py speaks. A process of its own, not the core: on Windows the pseudoconsole, its worker thread
// and the console-list agent are only released when this process ends, so ending it is how a terminal is released.
//
// usage: pty-host.ts <rows> <cols> <command> [args...]   |   pty-host.ts --probe
//
// stdin is typed into the pty, the pty's output comes out on stdout. File descriptor 3, when open, takes
// "<rows> <cols>" lines to resize the window. Exits with the child's status. --probe exits 0 when the module loads.
import { createRequire } from "node:module";
import net from "node:net";
import { exitWhenClosed } from "@colonia/protocol/exit";

type NodePty = typeof import("@lydell/node-pty");

function load(): NodePty | undefined {
  try {
    return createRequire(import.meta.url)("@lydell/node-pty") as NodePty;
  } catch {
    return undefined;
  }
}

/** One argument of a Windows command line, quoted the way Node's own spawn does it. */
export function quoteArg(arg: string): string {
  if (arg && !/[\s"]/.test(arg)) return arg;
  let out = '"';
  let slashes = 0;
  for (const ch of arg) {
    if (ch === "\\") slashes++;
    else {
      out += "\\".repeat(ch === '"' ? slashes * 2 + 1 : slashes) + ch;
      slashes = 0;
    }
  }
  return `${out}${"\\".repeat(slashes * 2)}"`;
}

function main(argv: string[]): void {
  const pty = load();
  if (argv[0] === "--probe") {
    exitWhenClosed(pty ? 0 : 1);
    return;
  }
  const [rows, cols, file, ...args] = argv;
  if (!pty || !file) {
    process.stderr.write(pty ? "usage: pty-host.ts <rows> <cols> <command> [args...]\n" : "colonia: no native pty\n");
    exitWhenClosed(2);
    return;
  }
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  let p: ReturnType<NodePty["spawn"]>;
  try {
    p = pty.spawn(file, process.platform === "win32" ? args.map(quoteArg).join(" ") : args, {
      name: "xterm-256color",
      cols: Number(cols) || 80,
      rows: Number(rows) || 24,
      cwd: process.cwd(),
      env,
    });
  } catch (e) {
    process.stderr.write(`colonia: ${(e as Error).message}\n`);
    exitWhenClosed(1);
    return;
  }
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (d: string) => p.write(d));
  p.onData((d) => process.stdout.write(d));
  let control: net.Socket | undefined;
  try {
    control = new net.Socket({ fd: 3, readable: true, writable: false });
  } catch {
    control = undefined;
  }
  let line = "";
  control?.setEncoding("utf8");
  control?.on("error", () => {});
  control?.on("data", (d: string) => {
    line += d;
    for (let i = line.indexOf("\n"); i >= 0; i = line.indexOf("\n")) {
      const [r, c] = line.slice(0, i).trim().split(/\s+/).map(Number);
      line = line.slice(i + 1);
      try {
        if (r && c) p.resize(c, r);
      } catch {
        // The pty has already ended.
      }
    }
  });
  // Never p.kill(): leaving is what frees the pseudoconsole and everything node-pty started for it.
  p.onExit(({ exitCode }) =>
    process.stdout.write("", () => {
      process.stdin.destroy();
      control?.destroy();
      exitWhenClosed(exitCode ?? 1);
    }),
  );
}

if (import.meta.main) main(process.argv.slice(2));
