import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import fs from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { LinuxHost } from "./appimage.ts";
import { createDesktopInstaller, type DesktopInstallOptions } from "./desktop.ts";
import { desktopDataDir, hasDesktop } from "./paths.ts";
import type { ProcessRunner } from "./process.ts";

/** A Linux machine where AppImages mount, so the plain launch path runs on any platform. */
const mounts: LinuxHost = {
  read: () => undefined,
  exists: () => true,
  list: () => ["libfuse.so.2"],
  head: () => "libfuse.so.2",
};

function fixture(overrides: Partial<DesktopInstallOptions> = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "colonia-install-test-"));
  const app = path.join(home, "Applications", overrides.platform === "darwin" ? "Colonia.app" : "Colonia.AppImage");
  const coreHome = path.join(home, "core");
  fs.mkdirSync(coreHome);
  fs.writeFileSync(path.join(coreHome, "home-id"), "selected-home");
  const bytes = Buffer.from("desktop binary");
  const name = "Colonia-2.9.1-linux-x64.AppImage";
  const calls: { command: string; args: string[]; env: NodeJS.ProcessEnv }[] = [];
  const requests: string[] = [];
  const fakeFetch: typeof fetch = async (input) => {
    const url = String(input);
    requests.push(url);
    if (url.includes("/releases?"))
      return Response.json([
        {
          tag_name: "v2.9.1",
          assets: [name, `${name}.sha256`].map((asset) => ({
            name: asset,
            browser_download_url: `https://releases.example/${asset}`,
          })),
        },
      ]);
    if (url.endsWith(".sha256")) return new Response(createHash("sha256").update(bytes).digest("hex"));
    return new Response(bytes, { headers: { "content-length": String(bytes.length) } });
  };
  const run: ProcessRunner = async (command, args, options) => {
    calls.push({ command, args, env: options.env });
  };
  const installer = createDesktopInstaller({
    platform: "linux",
    arch: "x64",
    userHome: home,
    env: {
      DISPLAY: ":1",
      COLONIA_DESKTOP_DATA: path.join(home, "desktop"),
      COLONIA_URL: "https://other.example",
      COLONIA_TOKEN: "private",
      ELECTRON_RUN_AS_NODE: "1",
    },
    feed: "https://releases.example",
    candidates: [app],
    fetch: fakeFetch,
    run,
    host: mounts,
    target: () => ({ home: coreHome, port: 7550, home_id: "selected-home" }),
    ...overrides,
  });
  return {
    home,
    app,
    coreHome,
    bytes,
    calls,
    /** The launches alone: the Linux installer also runs the AppImage to take its icon out. */
    opens: () => calls.filter((c) => c.command === app && !c.args.includes("--appimage-extract")),
    requests,
    installer,
    fakeFetch,
    async close() {
      await installer.close();
      fs.rmSync(home, { recursive: true, force: true });
    },
  };
}

test("missing desktop downloads once, reports bytes, installs, and opens the selected local Colonia", async () => {
  const progress: number[] = [];
  const f = fixture({
    changed: (s) => {
      if (s.total) progress.push(s.received);
    },
  });
  try {
    assert.equal(f.installer.status().installed, false);
    f.installer.start();
    f.installer.start();
    const result = await f.installer.wait();
    assert.equal(result.phase, "ready");
    assert.equal(result.installed, true);
    assert.equal(result.received, f.bytes.length);
    assert.ok(progress.includes(f.bytes.length));
    assert.equal(f.requests.filter((r) => r.includes("/releases?")).length, 1);
    assert.deepEqual(fs.readFileSync(f.app), f.bytes);
    fs.accessSync(f.app, fs.constants.X_OK);
    const launcher = fs.readFileSync(path.join(f.home, ".local/share/applications/colonia.desktop"), "utf8");
    const executable = /^Exec=(".*") %U$/m.exec(launcher)?.[1];
    assert.ok(executable, "the launcher quotes its executable path");
    assert.equal(JSON.parse(executable.replace(/\\([`$])/g, "$1")).replace(/%%/g, "%"), f.app);
    assert.match(launcher, /^\[Desktop Entry\]\nType=Application\n/);
    assert.match(launcher, /^StartupWMClass=Colonia$/m);
    assert.match(launcher, /^MimeType=application\/x-colonia-artifact;/m);
    assert.doesNotMatch(launcher, /no-sandbox/);
    const saved = JSON.parse(fs.readFileSync(path.join(f.home, "desktop/connection.json"), "utf8"));
    assert.equal(saved.home, fs.realpathSync(f.coreHome));
    assert.equal(saved.port, 7550);
    assert.equal(saved.home_id, "selected-home");
    assert.equal(saved.token, undefined);
    const opens = f.opens();
    assert.equal(opens.length, 1);
    assert.deepEqual(opens[0]?.args, ["--colonia-adopt-local"]);
    assert.equal(opens[0]?.env.COLONIA_TOKEN, undefined);
    assert.equal(opens[0]?.env.COLONIA_URL, undefined);
    assert.equal(opens[0]?.env.ELECTRON_RUN_AS_NODE, undefined);
    assert.equal(opens[0]?.env.APPIMAGE_EXTRACT_AND_RUN, undefined);
  } finally {
    await f.close();
  }
});

test("an existing app is preserved and opened without network or a second installation", async () => {
  const f = fixture();
  try {
    fs.mkdirSync(path.dirname(f.app));
    fs.writeFileSync(f.app, "existing");
    f.installer.start();
    assert.equal((await f.installer.wait()).phase, "ready");
    assert.equal(f.requests.length, 0);
    assert.equal(fs.readFileSync(f.app, "utf8"), "existing");
    assert.equal(f.opens().length, 1);
  } finally {
    await f.close();
  }
});

test("temporary cleanup failure cannot crash the daemon and retry opens the installed app", async (t) => {
  const f = fixture();
  const remove = fs.rmSync;
  const leftovers: fs.PathLike[] = [];
  t.mock.method(fs, "rmSync", (file: fs.PathLike, options?: fs.RmOptions) => {
    if (path.basename(String(file)).startsWith("colonia-desktop-install-")) {
      leftovers.push(file);
      throw new Error("Temporary download is locked");
    }
    return remove(file, options);
  });
  try {
    f.installer.start();
    assert.equal((await f.installer.wait()).phase, "failed");
    assert.match(f.installer.status().error ?? "", /locked/);
    assert.equal(f.installer.status().installed, true);
    f.installer.start();
    assert.equal((await f.installer.wait()).phase, "ready");
  } finally {
    t.mock.restoreAll();
    for (const file of leftovers) remove(file, { recursive: true, force: true });
    await f.close();
  }
});

test("a bad checksum never installs or launches and the next attempt recovers", async () => {
  let broken = true;
  const f = fixture({
    fetch: async (input, init) =>
      String(input).endsWith(".sha256") && broken ? new Response("0".repeat(64)) : f.fakeFetch(input, init),
  });
  try {
    f.installer.start();
    assert.equal((await f.installer.wait()).phase, "failed");
    assert.match(f.installer.status().error ?? "", /checksum/);
    assert.equal(fs.existsSync(f.app), false);
    assert.equal(f.calls.length, 0);
    broken = false;
    f.installer.start();
    assert.equal((await f.installer.wait()).phase, "ready");
    assert.equal(f.installer.status().error, undefined);
  } finally {
    await f.close();
  }
});

test("download errors, absent checksums and oversized payloads remain retryable without launching", async () => {
  for (const failure of ["network", "checksum", "size"] as const) {
    const f = fixture({
      fetch: async (input, init) => {
        if (failure === "network") throw new Error("network unavailable");
        if (failure === "checksum" && String(input).includes("/releases?"))
          return Response.json([
            {
              tag_name: "v2.9.1",
              assets: [{ name: "Colonia-2.9.1-linux-x64.AppImage", browser_download_url: "https://releases.example/app" }],
            },
          ]);
        if (failure === "size" && !String(input).includes("/releases?") && !String(input).endsWith(".sha256"))
          return new Response("x", { headers: { "content-length": String(2 ** 31) } });
        return f.fakeFetch(input, init);
      },
    });
    try {
      f.installer.start();
      assert.equal((await f.installer.wait()).phase, "failed");
      assert.equal(fs.existsSync(f.app), false);
      assert.equal(f.calls.length, 0);
    } finally {
      await f.close();
    }
  }
});

test("cancel aborts an active download and a later install still completes", async () => {
  let release = false;
  let entered: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const f = fixture({
    fetch: async (input, init) => {
      if (!release && !String(input).includes("/releases?")) {
        entered?.();
        return new Promise((_resolve, reject) =>
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }),
        );
      }
      return f.fakeFetch(input, init);
    },
  });
  try {
    assert.equal((await f.installer.cancel()).phase, "idle");
    f.installer.start();
    await started;
    const cancelled = await f.installer.cancel();
    assert.equal(cancelled.phase, "idle");
    assert.equal(cancelled.error, undefined);
    assert.equal(cancelled.received, 0);
    assert.equal(cancelled.total, undefined);
    assert.equal(fs.existsSync(f.app), false);
    release = true;
    f.installer.start();
    assert.equal((await f.installer.wait()).phase, "ready");
    assert.equal(f.installer.status().error, undefined);
  } finally {
    await f.close();
  }
});

test("a cancelled download still reports a temporary cleanup failure", async (t) => {
  let entered: (() => void) | undefined;
  const downloading = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const f = fixture({
    fetch: async (input, init) => {
      if (String(input).includes("/releases?")) return f.fakeFetch(input, init);
      entered?.();
      return new Promise((_resolve, reject) =>
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }),
      );
    },
  });
  const remove = fs.rmSync;
  const leftovers: fs.PathLike[] = [];
  t.mock.method(fs, "rmSync", (file: fs.PathLike, options?: fs.RmOptions) => {
    if (path.basename(String(file)).startsWith("colonia-desktop-install-")) {
      leftovers.push(file);
      throw new Error("Temporary download is locked");
    }
    return remove(file, options);
  });
  try {
    f.installer.start();
    await downloading;
    const cancelled = await f.installer.cancel();
    assert.equal(cancelled.phase, "failed");
    assert.match(cancelled.error ?? "", /locked/);
    assert.equal(f.calls.length, 0);
  } finally {
    t.mock.restoreAll();
    for (const file of leftovers) remove(file, { recursive: true, force: true });
    await f.close();
  }
});

test("cancel closes a partial HTTP download, removes its files and permits a fresh install", {
  timeout: 10_000,
}, async (t) => {
  const bytes = Buffer.from("verified desktop binary");
  const name = "Colonia-2.9.1-linux-x64.AppImage";
  let partial = true;
  let received: (() => void) | undefined;
  const progress = new Promise<void>((resolve) => {
    received = resolve;
  });
  let disconnected: (() => void) | undefined;
  const closed = new Promise<void>((resolve) => {
    disconnected = resolve;
  });
  const work: string[] = [];
  const makeTemp = fs.mkdtempSync;
  t.mock.method(fs, "mkdtempSync", (prefix: string) => {
    const dir = makeTemp(prefix);
    if (path.basename(dir).startsWith("colonia-desktop-install-")) work.push(dir);
    return dir;
  });
  const server = createServer((req, res) => {
    if (req.url?.startsWith("/releases?")) {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify([
          {
            tag_name: "v2.9.1",
            assets: [name, `${name}.sha256`].map((asset) => ({ name: asset, browser_download_url: `${url}/${asset}` })),
          },
        ]),
      );
    } else if (req.url?.endsWith(".sha256")) {
      res.end(createHash("sha256").update(bytes).digest("hex"));
    } else {
      res.setHeader("content-length", bytes.length);
      if (partial) {
        res.once("close", () => disconnected?.());
        res.write(bytes.subarray(0, 4));
      } else res.end(bytes);
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}`;
  const f = fixture({
    feed: url,
    fetch,
    changed: (status) => {
      if (status.received > 0) received?.();
    },
  });
  try {
    f.installer.start();
    await progress;
    assert.equal(f.installer.status().received, 4);
    const result = await f.installer.cancel();
    await closed;
    assert.equal(result.phase, "idle");
    assert.equal(result.error, undefined);
    assert.equal(result.received, 0);
    assert.equal(result.total, undefined);
    assert.equal(f.calls.length, 0);
    assert.equal(fs.existsSync(f.app), false);
    assert.equal(work.length, 1);
    for (const dir of work) assert.equal(fs.existsSync(dir), false);
    partial = false;
    f.installer.start();
    assert.equal((await f.installer.wait()).phase, "ready");
    assert.deepEqual(fs.readFileSync(f.app), bytes);
    for (const dir of work) assert.equal(fs.existsSync(dir), false);
  } finally {
    await f.close();
    const closing = once(server, "close");
    server.close();
    server.closeAllConnections();
    await closing;
  }
});

test("cancel leaves an OS installation and its launch running", async () => {
  let installer: ReturnType<typeof createDesktopInstaller>;
  let installing: ReturnType<typeof installer.cancel> | undefined;
  const phases: string[] = [];
  const f = fixture({
    changed: (status) => {
      phases.push(status.phase);
      if (status.phase === "installing") installing = installer.cancel();
    },
    run: async (_command, _args, options) => {
      assert.equal(installer.status().phase, "opening");
      assert.equal((await installer.cancel()).phase, "opening");
      assert.equal(options.signal.aborted, false);
    },
  });
  installer = f.installer;
  try {
    installer.start();
    assert.equal((await installer.wait()).phase, "ready");
    assert.ok(phases.includes("installing"));
    assert.ok(phases.includes("opening"));
    assert.equal((await installing)?.phase, "installing");
    assert.equal((await installer.cancel()).phase, "ready");
  } finally {
    await f.close();
  }
});

test("closing the core cancels an active download and leaves no installed app", async () => {
  let entered: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const f = fixture({
    fetch: async (_input, init) => {
      entered?.();
      return new Promise((_resolve, reject) =>
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }),
      );
    },
  });
  try {
    f.installer.start();
    await started;
    await f.installer.close();
    assert.equal(f.installer.status().phase, "failed");
    assert.equal(fs.existsSync(f.app), false);
  } finally {
    await f.close();
  }
});

test("a headless or SSH session never starts desktop installation", async () => {
  const f = fixture({ env: {} });
  try {
    assert.equal(f.installer.status().available, false);
    assert.throws(() => f.installer.start(), /graphical/);
    assert.equal(f.requests.length, 0);
  } finally {
    await f.close();
  }
  assert.equal(hasDesktop("linux", { DISPLAY: ":1", SSH_CONNECTION: "forwarded" }), false);
  assert.equal(
    desktopDataDir("darwin", {}, "/home/user"),
    path.join("/home/user", "Library", "Application Support", "@colonia", "desktop"),
  );
  assert.equal(
    desktopDataDir("linux", { XDG_CONFIG_HOME: "/custom" }, "/home/user"),
    path.join("/custom", "@colonia", "desktop"),
  );
});

test("a disabled release feed never fetches a missing desktop", async () => {
  const f = fixture({ feed: "off" });
  try {
    assert.equal(f.installer.status().available, false);
    assert.throws(() => f.installer.start(), /graphical/);
    assert.equal(f.requests.length, 0);
  } finally {
    await f.close();
  }
});

test("macOS installs the verified zip into the user Applications folder, without a DMG drag step", async () => {
  const f = fixture({
    platform: "darwin",
    env: {},
    target: undefined,
    fetch: async (input) => {
      if (String(input).includes("/releases?"))
        return Response.json([
          {
            tag_name: "v2.9.1",
            assets: ["Colonia-2.9.1-mac-x64.zip", "Colonia-2.9.1-mac-x64.zip.sha256"].map((name) => ({
              name,
              browser_download_url: `https://releases.example/${name}`,
            })),
          },
        ]);
      return String(input).endsWith(".sha256")
        ? new Response(createHash("sha256").update("zip").digest("hex"))
        : new Response("zip");
    },
    run: async (command, args) => {
      f.calls.push({ command, args, env: {} });
      if (args[0] === "-x") {
        const executable = path.join(args[3] as string, "Colonia.app/Contents/MacOS/Colonia");
        fs.mkdirSync(path.dirname(executable), { recursive: true });
        fs.writeFileSync(executable, "app");
      } else if (command.endsWith("ditto")) fs.cpSync(args[0] as string, args[1] as string, { recursive: true });
    },
  });
  try {
    f.installer.start();
    assert.equal((await f.installer.wait()).phase, "ready");
    assert.equal(fs.readFileSync(path.join(f.home, "Applications/Colonia.app/Contents/MacOS/Colonia"), "utf8"), "app");
    assert.deepEqual(f.calls.at(-1)?.args, ["-a", path.join(f.home, "Applications/Colonia.app")]);
    assert.ok(!f.calls.some((c) => c.command.includes("xattr")));
  } finally {
    await f.close();
  }
});

test("Windows waits for its installer before launching the installed executable", async () => {
  const f = fixture({
    platform: "win32",
    env: {},
    target: undefined,
    fetch: async (input) => {
      if (String(input).includes("/releases?"))
        return Response.json([
          {
            tag_name: "v2.9.1",
            assets: ["Colonia-2.9.1-win-x64.exe", "Colonia-2.9.1-win-x64.exe.sha256"].map((name) => ({
              name,
              browser_download_url: `https://releases.example/${name}`,
            })),
          },
        ]);
      return String(input).endsWith(".sha256")
        ? new Response(createHash("sha256").update("exe").digest("hex"))
        : new Response("exe");
    },
    run: async (command, args) => {
      f.calls.push({ command, args, env: {} });
      if (args.includes("/S")) {
        fs.mkdirSync(path.dirname(f.app));
        fs.writeFileSync(f.app, "installed");
      }
    },
  });
  try {
    f.installer.start();
    assert.equal((await f.installer.wait()).phase, "ready");
    assert.deepEqual(f.calls[0]?.args, ["/S"]);
    assert.equal(f.calls[1]?.command, f.app);
  } finally {
    await f.close();
  }
});

type Open = { args: string[]; env: NodeJS.ProcessEnv; output?: string | undefined; settle?: number | undefined };

/** Opens an installed AppImage on a described Linux machine; the fake app prints `says` and fails until `works`. */
async function linuxOpen(files: string[], says: string, works: (call: Open) => boolean) {
  const opens: Open[] = [];
  const notes: string[] = [];
  let app = "";
  const run: ProcessRunner = async (command, args, options) => {
    if (command !== app) throw new Error("ENOENT");
    if (args.includes("--appimage-extract")) {
      const dir = path.join(options.cwd ?? "", "squashfs-root/usr/share/icons/hicolor/1024x1024/apps");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "colonia.png"), "png");
      return;
    }
    const call = { args, env: options.env, output: options.output, settle: options.settle };
    opens.push(call);
    if (works(call)) return;
    if (options.output) fs.writeFileSync(options.output, says);
    throw new Error("Desktop failed to start (1)");
  };
  const host: LinuxHost = {
    read: (file) =>
      file === "/etc/os-release"
        ? "ID=ubuntu\nID_LIKE=debian\n"
        : fs.existsSync(file)
          ? fs.readFileSync(file, "utf8")
          : undefined,
    exists: (file) => files.includes(file),
    list: (dir) => files.filter((f) => f.startsWith(`${dir}/`)).map((f) => f.slice(dir.length + 1)),
    head: () => "libfuse.so.2",
  };
  const f = fixture({ run, host, note: (text) => notes.push(text) });
  app = f.app;
  fs.mkdirSync(path.dirname(f.app));
  fs.writeFileSync(f.app, "existing");
  f.installer.start();
  const status = await f.installer.wait();
  const data = path.join(f.home, ".local", "share");
  return {
    f,
    opens,
    notes,
    status,
    launcher: fs.readFileSync(path.join(data, "applications", "colonia.desktop"), "utf8"),
    icon: path.join(data, "icons", "hicolor", "512x512", "apps", "colonia.png"),
    mime: path.join(data, "mime", "packages", "colonia.xml"),
  };
}

const MOUNTS = ["/dev/fuse", "/usr/bin/fusermount", "/usr/lib/x86_64-linux-gnu/libfuse.so.2.9.9"];

test("a Linux machine that mounts AppImages opens it plainly, with its own icon and file types", async () => {
  const r = await linuxOpen(MOUNTS, "", () => true);
  try {
    assert.equal(r.status.phase, "ready");
    assert.equal(r.opens.length, 1);
    assert.equal(r.opens[0]?.env.APPIMAGE_EXTRACT_AND_RUN, undefined);
    assert.deepEqual(r.notes, []);
    assert.equal(fs.readFileSync(r.icon, "utf8"), "png");
    assert.ok(r.launcher.includes(`\nIcon=${r.icon}\n`));
    assert.match(fs.readFileSync(r.mime, "utf8"), /<glob pattern="\*\.coloniaart"\/>/);
  } finally {
    await r.f.close();
  }
});

test("without libfuse 2 the AppImage runs unpacked, says so once with the command, and so does the menu entry", async () => {
  const r = await linuxOpen(["/dev/fuse", "/usr/bin/fusermount3"], "", () => true);
  try {
    assert.equal(r.status.phase, "ready");
    assert.equal(r.opens.length, 1);
    assert.equal(r.opens[0]?.env.APPIMAGE_EXTRACT_AND_RUN, "1");
    assert.ok((r.opens[0]?.settle ?? 0) > 1500, "unpacking gets time before the start counts");
    assert.equal(r.notes.length, 1);
    assert.match(r.notes[0] ?? "", /sudo apt install libfuse2t64 fuse3/);
    assert.match(r.launcher, /^Exec=env APPIMAGE_EXTRACT_AND_RUN=1 /m);
  } finally {
    await r.f.close();
  }
});

test("a mount failure the check did not foresee falls back to unpacked instead of failing", async () => {
  const says =
    "fuse: failed to open /dev/fuse: Permission denied\nCannot mount AppImage, please check your FUSE setup.";
  const r = await linuxOpen(MOUNTS, says, (c) => c.env.APPIMAGE_EXTRACT_AND_RUN === "1");
  try {
    assert.equal(r.status.phase, "ready");
    assert.deepEqual(
      r.opens.map((c) => [c.env.APPIMAGE_EXTRACT_AND_RUN, Boolean(c.output)]),
      [
        [undefined, false],
        [undefined, true],
        ["1", false],
      ],
    );
    assert.match(r.launcher, /^Exec=env APPIMAGE_EXTRACT_AND_RUN=1 /m);
    assert.equal(r.notes.length, 1);
  } finally {
    await r.f.close();
  }
});

test("a blocked sandbox is explained and never worked around", async () => {
  const says =
    "FATAL:setuid_sandbox_host.cc:166] The SUID sandbox helper binary was found, but is not configured correctly.";
  const r = await linuxOpen(MOUNTS, says, () => false);
  try {
    assert.equal(r.status.phase, "failed");
    assert.match(r.status.error ?? "", /stops the sandbox/);
    assert.equal(r.opens.length, 2);
    for (const call of r.opens) {
      assert.deepEqual(call.args, ["--colonia-adopt-local"]);
      assert.equal(call.env.ELECTRON_DISABLE_SANDBOX, undefined);
    }
    assert.doesNotMatch(r.launcher, /no-sandbox/);
  } finally {
    await r.f.close();
  }
});
