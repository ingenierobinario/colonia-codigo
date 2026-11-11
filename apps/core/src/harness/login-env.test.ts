import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { RUNS_SCRIPTS, stopped, tempDir, waitFor } from "../testkit/platform.ts";
import {
  type After,
  createLoginEnv,
  dumpArgs,
  dumpCommand,
  loginShell,
  mergePath,
  mergeShell,
  parseDump,
  type ShellRun,
  shellRunner,
  takenFrom,
} from "./login-env.ts";

const P = (...dirs: string[]) => dirs.join(path.delimiter);

type Asked = { file: string; args: string[]; env: Record<string, string>; timeoutMs: number };

/** A shell that exports `env`: it answers as the Node it is told to run would, around what its rc files print. */
function shellExporting(env: Record<string, string>) {
  const asked: Asked[] = [];
  const run: ShellRun = async (file, args, o) => {
    asked.push({ file, args, ...o });
    const mark = /-p '"(\w+)" \+ /.exec(args.at(-1) ?? "")?.[1] ?? "";
    return `Last login: today\n${mark}${JSON.stringify(env)}${mark}\nbye\n`;
  };
  return { run, asked };
}

test("the shell is told to run this same Node, which prints its environment between two marks", () => {
  assert.equal(
    dumpCommand("/Applications/Ana's Colonia.app/Contents/MacOS/Colonia", "MARK"),
    `/usr/bin/env -u NODE_OPTIONS ELECTRON_RUN_AS_NODE=1 '/Applications/Ana'\\''s Colonia.app/Contents/MacOS/Colonia' -p '"MARK" + JSON.stringify(process.env) + "MARK"'`,
  );
});

test("the shell starts as a login, interactive one that runs one command; csh has no login flag for that", () => {
  for (const shell of ["/bin/zsh", "/bin/bash", "/opt/homebrew/bin/fish", "/bin/sh"])
    assert.deepEqual(dumpArgs(shell, "cmd"), ["-i", "-l", "-c", "cmd"], shell);
  for (const shell of ["/bin/csh", "/bin/tcsh"]) assert.deepEqual(dumpArgs(shell, "cmd"), ["-ic", "cmd"], shell);
});

test("the shell asked is the session's, else the account's, else the system's usual one", () => {
  assert.equal(
    loginShell({ SHELL: "/opt/homebrew/bin/fish" }, "darwin", () => "/bin/zsh"),
    "/opt/homebrew/bin/fish",
  );
  assert.equal(
    loginShell({}, "linux", () => "/bin/bash"),
    "/bin/bash",
  );
  assert.equal(
    loginShell({}, "darwin", () => null),
    "/bin/zsh",
  );
  // A user without an entry in the system's list (a container's) has no account to read.
  const unknown = () => {
    throw new Error("no such user");
  };
  assert.equal(loginShell({}, "linux", unknown), "/bin/sh");
});

test("what rc files print around the marks stays out, and a value keeps its line breaks", () => {
  const env = { PATH: "/usr/bin", NOTE: "two\nlines", QUOTED: `it's "here"` };
  assert.deepEqual(parseDump(`Welcome back\nMARK${JSON.stringify(env)}MARK\nbye\n`, "MARK"), env);
  assert.deepEqual(parseDump('MARK{"A":"1","B":2,"C":null}MARK', "MARK"), { A: "1" }, "only text is a value");
});

test("an answer without both marks, or without an environment between them, is none", () => {
  assert.equal(parseDump("", "MARK"), undefined);
  assert.equal(parseDump('MARK{"A":"1"}', "MARK"), undefined, "cut before its end");
  assert.equal(parseDump("MARKnot jsonMARK", "MARK"), undefined);
  assert.equal(parseDump('MARK["A"]MARK', "MARK"), undefined);
  assert.equal(parseDump("MARKnullMARK", "MARK"), undefined);
});

test("of what the shell exports, only PATH and what agents' programs need to work is taken", () => {
  const taken = takenFrom({
    PATH: "/opt/homebrew/bin:/usr/bin",
    https_proxy: "http://proxy.example:8080",
    NO_PROXY: "localhost",
    NODE_EXTRA_CA_CERTS: "/etc/ssl/acme.pem",
    LANG: "es_ES.UTF-8",
    NVM_DIR: "/home/someone/.nvm",
    // Credentials, and what would move where the core itself looks, stay in the shell.
    GITHUB_TOKEN: "x",
    AWS_PROFILE: "work",
    SSH_AUTH_SOCK: "/tmp/agent.sock",
    CLAUDE_CONFIG_DIR: "/home/someone/.claude-work",
    CODEX_HOME: "/home/someone/.codex-work",
    NODE_OPTIONS: "--max-old-space-size=4096",
    LC_TERMINAL: "iTerm2",
    HOME: "/home/someone",
    // Exported empty: nothing to give.
    HTTP_PROXY: "",
  });
  assert.deepEqual(taken, {
    PATH: "/opt/homebrew/bin:/usr/bin",
    https_proxy: "http://proxy.example:8080",
    NO_PROXY: "localhost",
    NODE_EXTRA_CA_CERTS: "/etc/ssl/acme.pem",
    LANG: "es_ES.UTF-8",
    NVM_DIR: "/home/someone/.nvm",
  });
});

test("the shell's PATH comes in its own order, after what only the core's own PATH has", () => {
  // An app opened from the Finder: all of its bare PATH is in the shell's, so agents get the terminal's order.
  assert.equal(mergePath("/usr/bin:/bin", "/opt/homebrew/bin:/usr/bin:/bin", ":"), "/opt/homebrew/bin:/usr/bin:/bin");
  // A service keeps in front the folders it was installed with and the shell does not know.
  assert.equal(
    mergePath("/opt/wrapper/bin:/usr/bin:/srv/tools", "/home/someone/.nvm/bin:/usr/bin", ":"),
    "/opt/wrapper/bin:/srv/tools:/home/someone/.nvm/bin:/usr/bin",
  );
  assert.equal(mergePath("", "/a::/b:/a", ":"), "/a:/b", "each folder once, no empty one");
  assert.equal(mergePath("/a:/b", "", ":"), "/a:/b");
});

test("what the core was given wins over the shell's, under any case of the name", () => {
  const env: Record<string, string | undefined> = {
    Path: P("/usr/bin"),
    HTTPS_PROXY: "http://mine.example:1",
    LANG: "C",
  };
  mergeShell(env, {
    PATH: P("/opt/homebrew/bin", "/usr/bin"),
    https_proxy: "http://shell.example:2",
    http_proxy: "http://shell.example:3",
    HTTP_PROXY: "http://shell.example:3",
    LANG: "es_ES.UTF-8",
    NVM_DIR: "/home/someone/.nvm",
  });
  assert.deepEqual(env, {
    Path: P("/opt/homebrew/bin", "/usr/bin"),
    HTTPS_PROXY: "http://mine.example:1",
    LANG: "C",
    // Programs read one spelling or the other: both arrive when the core had neither.
    http_proxy: "http://shell.example:3",
    HTTP_PROXY: "http://shell.example:3",
    NVM_DIR: "/home/someone/.nvm",
  });
});

test("the owner's shell is asked once, away from Colonia's own settings, and what it exports is kept", async () => {
  const shell = shellExporting({
    PATH: "/opt/homebrew/bin:/usr/bin",
    HTTPS_PROXY: "http://proxy.example:8080",
    GITHUB_TOKEN: "x",
  });
  const read: [string, string[]][] = [];
  const login = createLoginEnv({
    platform: "darwin",
    env: {
      SHELL: "/bin/zsh",
      HOME: "/home/someone",
      COLONIA_HOME: "/home/someone/.colonia",
      ELECTRON_RUN_AS_NODE: "1",
      NODE_OPTIONS: "--inspect",
    },
    node: "/opt/colonia/node",
    run: shell.run,
    read: (sh, names) => read.push([sh, names]),
  });
  assert.equal(login.current(), undefined, "nothing before it answers");
  login.ask();
  login.ask();
  await login.settled();
  login.ask();
  await login.settled();
  assert.deepEqual(login.current(), { PATH: "/opt/homebrew/bin:/usr/bin", HTTPS_PROXY: "http://proxy.example:8080" });
  assert.equal(shell.asked.length, 1);
  const [asked] = shell.asked;
  assert.equal(asked?.file, "/bin/zsh");
  assert.deepEqual(asked?.args.slice(0, 3), ["-i", "-l", "-c"]);
  assert.match(asked?.args[3] ?? "", /ELECTRON_RUN_AS_NODE=1 '\/opt\/colonia\/node' -p /);
  assert.deepEqual(asked?.env, { SHELL: "/bin/zsh", HOME: "/home/someone" }, "the shell starts as a terminal's would");
  // Names only: a proxy's address can carry a password.
  assert.deepEqual(read, [["/bin/zsh", ["PATH", "HTTPS_PROXY"]]]);
});

test("on Windows nobody is asked: its programs already get the owner's environment", async () => {
  const shell = shellExporting({ PATH: "/usr/bin" });
  const login = createLoginEnv({ platform: "win32", env: { SHELL: "/usr/bin/bash" }, run: shell.run });
  login.ask();
  await login.settled();
  assert.equal(shell.asked.length, 0);
  assert.equal(login.current(), undefined);
});

test("a shell that fails changes nothing, and is asked again a minute later, three times at most", async () => {
  let now = 1_000_000;
  let runs = 0;
  const failed: [string, string][] = [];
  const login = createLoginEnv({
    platform: "linux",
    shell: "/bin/bash",
    env: {},
    now: () => now,
    run: async () => {
      runs++;
      throw new Error("it did not answer in 10000 ms");
    },
    failed: (shell, why) => failed.push([shell, why]),
  });
  const askAfter = async (ms: number) => {
    now += ms;
    login.ask();
    await login.settled();
    return runs;
  };
  assert.equal(await askAfter(0), 1);
  assert.equal(login.current(), undefined);
  assert.equal(await askAfter(59_000), 1, "too soon to try again");
  assert.equal(await askAfter(1_000), 2);
  assert.equal(await askAfter(60_000), 3);
  assert.equal(await askAfter(600_000), 3, "given up on");
  assert.deepEqual(failed, Array(3).fill(["/bin/bash", "it did not answer in 10000 ms"]));
});

test("a shell that answers on a later try is kept, and one that cannot start at all is only a failed read", async () => {
  let now = 0;
  let runs = 0;
  const failed: string[] = [];
  const login = createLoginEnv({
    platform: "darwin",
    shell: "/bin/zsh",
    env: {},
    now: () => now,
    mark: () => "MARK",
    run: (() => {
      // The first start fails before any promise exists.
      if (++runs === 1) throw new Error("spawn /bin/zsh EAGAIN");
      return Promise.resolve('MARK{"PATH":"/opt/homebrew/bin"}MARK');
    }) as ShellRun,
    failed: (_shell, why) => failed.push(why),
  });
  login.ask();
  await login.settled();
  assert.deepEqual(failed, ["spawn /bin/zsh EAGAIN"]);
  now += 60_000;
  login.ask();
  await login.settled();
  assert.deepEqual(login.current(), { PATH: "/opt/homebrew/bin" });
  assert.equal(runs, 2);
});

test("a shell that prints no environment is a failed read", async () => {
  const failed: string[] = [];
  const login = createLoginEnv({
    platform: "linux",
    shell: "/bin/bash",
    env: {},
    run: async () => "bash: no job control in this shell\n",
    failed: (_shell, why) => failed.push(why),
  });
  login.ask();
  await login.settled();
  assert.equal(login.current(), undefined);
  assert.deepEqual(failed, ["it did not print its environment"]);
});

test("an account that cannot log in has no shell to ask", async () => {
  for (const shell of ["/usr/sbin/nologin", "/sbin/nologin", "/bin/false", "/usr/bin/false"]) {
    const asked = shellExporting({ PATH: "/usr/bin" });
    const failed: string[] = [];
    const login = createLoginEnv({
      platform: "linux",
      env: { SHELL: shell },
      run: asked.run,
      failed: (_shell, why) => failed.push(why),
    });
    login.ask();
    login.ask();
    await login.settled();
    assert.equal(asked.asked.length, 0, shell);
    assert.deepEqual(failed, [], "nothing to tell: it is how that account is");
    assert.equal(login.current(), undefined);
  }
});

/** The test's own environment, as the real run takes one. */
const ownEnv = () =>
  Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined));

/** Timers that hold the test's process open, as a core's own work holds a core; `giveUp` is the timeout, now. */
function heldTimers() {
  let fire = () => {};
  const after: After = (ms, fn) => {
    const timer = setTimeout(fn, ms);
    fire = fn;
    return () => clearTimeout(timer);
  };
  return { after, giveUp: () => fire() };
}

/** A program that writes its pid where its first argument says, whole or not at all, and never ends by itself. */
const HANGS =
  "const fs = require('node:fs'); const file = process.argv[1]; fs.writeFileSync(file + '.tmp', String(process.pid));" +
  " fs.renameSync(file + '.tmp', file); setInterval(() => {}, 1000);";

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const pidIn = (file: string) => (fs.existsSync(file) ? Number(fs.readFileSync(file, "utf8")) : 0);

test("a read gives what the shell wrote, whole", async () => {
  const run = shellRunner(heldTimers().after);
  const out = await run(process.execPath, ["-e", "process.stdout.write('a'.repeat(200000) + 'ñ')"], {
    env: ownEnv(),
    timeoutMs: 60_000,
  });
  assert.equal(out.length, 200_001);
  assert.ok(out.endsWith("añ"));
});

test("a shell that does not answer in time is ended, and the read fails", async () => {
  await using dir = tempDir("colonia-login-env-");
  const pidFile = path.join(dir.path, "pid");
  const timers = heldTimers();
  const reading = shellRunner(timers.after)(process.execPath, ["-e", HANGS, pidFile], {
    env: ownEnv(),
    timeoutMs: 600_000,
  });
  try {
    const pid = await waitFor(() => pidIn(pidFile), "the shell to start");
    timers.giveUp();
    await assert.rejects(reading, /it did not answer in 600000 ms/);
    await waitFor(() => !alive(pid), "the shell to end");
  } finally {
    timers.giveUp();
  }
});

test("a shell that prints without end is given up on too", async () => {
  const run = shellRunner(heldTimers().after);
  const floods = "const chunk = 'x'.repeat(65536); setInterval(() => process.stdout.write(chunk), 1);";
  await assert.rejects(
    run(process.execPath, ["-e", floods], { env: ownEnv(), timeoutMs: 120_000 }),
    /it printed too much/,
  );
});

test("a shell that is not there is a failed read, not a crash", async () => {
  await using dir = tempDir("colonia-login-env-");
  const run = shellRunner(heldTimers().after);
  await assert.rejects(
    run(path.join(dir.path, "no-such-shell"), ["-c", "true"], { env: ownEnv(), timeoutMs: 60_000 }),
    /ENOENT/,
  );
});

/** A core with nothing left to do once its shell runs: it starts a read of a shell that never answers. */
const ENDS_FIRST = `
const fs = require("node:fs");
const [url, pidFile] = process.argv.slice(1);
import(url).then(({ shellRunner }) => {
  const read = shellRunner()(process.execPath, ["-e", ${JSON.stringify(HANGS)}, pidFile], {
    env: process.env,
    timeoutMs: 600000,
  });
  read.catch(() => {});
  const seen = setInterval(() => fs.existsSync(pidFile) && clearInterval(seen), 20);
});
`;

test("a read under way does not keep a core running, and a core that ends takes the shell with it", async () => {
  await using dir = tempDir("colonia-login-env-");
  const pidFile = path.join(dir.path, "pid");
  const url = pathToFileURL(path.join(import.meta.dirname, "login-env.ts")).href;
  const core = spawn(process.execPath, ["-e", ENDS_FIRST, url, pidFile], {
    stdio: ["ignore", "ignore", "pipe"],
    windowsHide: true,
  });
  let stderr = "";
  core.stderr.on("data", (text) => {
    stderr += text;
  });
  try {
    await stopped(core, 60_000);
    assert.equal(core.exitCode, 0, stderr);
    const pid = pidIn(pidFile);
    assert.ok(pid, "the shell had started");
    await waitFor(() => !alive(pid), "the shell to end with the core");
  } finally {
    core.kill();
    const left = pidIn(pidFile);
    if (left && alive(left)) process.kill(left);
  }
});

// portable: a login shell with rc files exists only where scripts run (RUNS_SCRIPTS); Windows asks nobody.
if (RUNS_SCRIPTS)
  test("a real login shell gives what the owner's profile exports, and ends", async () => {
    await using dir = tempDir("colonia-login-env-");
    fs.writeFileSync(
      path.join(dir.path, ".profile"),
      [
        'echo "Welcome back"',
        "export HTTPS_PROXY=http://proxy.example:8080",
        'export PATH="$HOME/tools/bin:$PATH"',
        "export GITHUB_TOKEN=x",
        "",
      ].join("\n"),
    );
    const failed: string[] = [];
    const login = createLoginEnv({
      shell: "/bin/sh",
      env: { HOME: dir.path, PATH: process.env.PATH ?? "/usr/bin:/bin" },
      run: shellRunner(heldTimers().after),
      failed: (_shell, why) => failed.push(why),
    });
    login.ask();
    await login.settled();
    assert.deepEqual(failed, []);
    const got = login.current();
    assert.equal(got?.HTTPS_PROXY, "http://proxy.example:8080");
    assert.equal(got?.PATH?.split(":")[0], `${dir.path}/tools/bin`);
    assert.deepEqual(
      Object.keys(got ?? {}).filter((k) => /TOKEN/.test(k)),
      [],
    );
  });
