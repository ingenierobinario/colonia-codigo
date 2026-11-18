import assert from "node:assert/strict";
import { execFile, execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { tempDir } from "../apps/core/src/testkit/platform.ts";
import { coreBundleName, platformOf } from "../packages/protocol/src/releases.ts";

const script = path.resolve(import.meta.dirname, "install/install.sh");

/** A bundle with only what install.sh checks: colonia/node/bin/node, executable. */
function bundle(dir: string, version: string, os: NodeJS.Platform = process.platform): string {
  const platform = platformOf(os, process.arch);
  assert.ok(platform);
  const src = path.join(dir, `src-${version}`);
  fs.mkdirSync(path.join(src, "colonia", "node", "bin"), { recursive: true });
  fs.writeFileSync(path.join(src, "colonia", "node", "bin", "node"), `#!/bin/sh\necho ${version}\n`, { mode: 0o755 });
  const name = coreBundleName(version, platform);
  execFileSync("tar", ["-czf", name, "colonia"], { cwd: src });
  return path.join(src, name);
}

test("installing over an existing Colonia makes the new version current", async () => {
  // install.sh is the Linux and macOS installer; Windows runs install.ps1, which swaps a junction instead.
  if (process.platform === "win32") return;
  await using dir = tempDir("colonia-install-sh-");
  const home = path.join(dir.path, "home");
  const app = path.join(dir.path, "app");
  // Stand-ins for what the Colonia v1 cleanup calls, so the test never stops or removes anything on this machine.
  const bin = path.join(dir.path, "bin");
  fs.mkdirSync(bin);
  for (const tool of ["pkill", "launchctl", "systemctl", "npm", "loginctl"])
    fs.writeFileSync(path.join(bin, tool), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  const env = { HOME: home, COLONIA_APP: app, PATH: `${bin}:/usr/bin:/bin` };
  const install = (version: string) =>
    execFileSync("bash", [script, "--file", bundle(dir.path, version), "--no-service"], { env, stdio: "pipe" });

  install("2.12.1");
  assert.equal(fs.readlinkSync(path.join(app, "current")), path.join("versions", "2.12.1"));
  install("2.12.2");
  assert.equal(fs.readlinkSync(path.join(app, "current")), path.join("versions", "2.12.2"));
  assert.equal(execFileSync(path.join(app, "current", "node", "bin", "node"), { encoding: "utf8" }).trim(), "2.12.2");
  assert.deepEqual(fs.readdirSync(path.join(app, "versions", "2.12.1")), ["node"]);
});

/** Stand-ins for the system tools install.sh calls, so a test never touches this machine's services. */
function quietTools(dir: string): string {
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  for (const tool of ["pkill", "launchctl", "systemctl", "npm", "loginctl"])
    fs.writeFileSync(path.join(bin, tool), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  return bin;
}

test("a musl system is told the bundle cannot run there before anything is installed", async () => {
  if (process.platform !== "linux") return;
  await using dir = tempDir("colonia-install-musl-");
  const home = path.join(dir.path, "home");
  const app = path.join(dir.path, "app");
  const root = path.join(dir.path, "root");
  fs.mkdirSync(path.join(root, "lib"), { recursive: true });
  fs.writeFileSync(path.join(root, "lib", "ld-musl-x86_64.so.1"), "");
  const env = { HOME: home, COLONIA_APP: app, COLONIA_ROOT: root, PATH: `${quietTools(dir.path)}:/usr/bin:/bin` };
  const run = () =>
    execFileSync("bash", [script, "--file", bundle(dir.path, "2.12.1"), "--no-service"], { env, stdio: "pipe" });
  assert.throws(run, (err: { stderr: Buffer }) => /musl \(Alpine\)[\s\S]*glibc container/.test(String(err.stderr)));
  assert.equal(fs.existsSync(app), false);

  // musl installed beside glibc (a Debian with the musl package) is an ordinary glibc system.
  fs.mkdirSync(path.join(root, "lib64"));
  fs.writeFileSync(path.join(root, "lib64", "ld-linux-x86-64.so.2"), "");
  run();
  assert.equal(fs.readlinkSync(path.join(app, "current")), path.join("versions", "2.12.1"));
});

test("uninstalling on Linux takes the desktop app and its entries with it, and leaves another app's alone", async () => {
  if (process.platform !== "linux") return;
  await using dir = tempDir("colonia-uninstall-sh-");
  const home = path.join(dir.path, "home");
  const app = path.join(dir.path, "app");
  const env = { HOME: home, COLONIA_APP: app, PATH: `${quietTools(dir.path)}:/usr/bin:/bin` };
  const image = path.join(home, "Applications", "Colonia.AppImage");
  const data = path.join(home, ".local", "share");
  const entry = path.join(data, "applications", "colonia.desktop");
  const left = [
    image,
    entry,
    path.join(data, "icons", "hicolor", "512x512", "apps", "colonia.png"),
    path.join(data, "mime", "packages", "colonia.xml"),
    path.join(home, ".config", "autostart", "colonia.desktop"),
  ];
  const plant = (exec: string) => {
    for (const file of left) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, file === entry ? `[Desktop Entry]\nExec="${exec}" %U\n` : "");
    }
  };
  const uninstall = () => execFileSync("bash", [script, "--uninstall"], { env, stdio: "pipe" });

  plant(image);
  uninstall();
  assert.deepEqual(
    left.filter((file) => fs.existsSync(file)),
    [],
  );

  // An entry that starts something else (a package from the distribution) is not this installer's to remove.
  plant("/opt/Colonia/colonia");
  uninstall();
  assert.deepEqual(
    left.filter((file) => fs.existsSync(file)),
    left.slice(0, 4),
  );
});

/** Runs install.sh with `home` as HOME, a PATH without its ~/.local/bin, and `shell` as the login shell. */
async function installInto(
  home: string,
  shell: string,
  extra: (bin: string) => void = () => {},
  os: NodeJS.Platform = process.platform,
) {
  await using dir = tempDir("colonia-install-path-");
  const bin = quietTools(dir.path);
  extra(bin);
  const env = { HOME: home, SHELL: shell, COLONIA_APP: path.join(dir.path, "app"), PATH: `${bin}:/usr/bin:/bin` };
  return spawnSync("bash", [script, "--file", bundle(dir.path, "2.12.1", os), "--no-service"], {
    env,
    encoding: "utf8",
  });
}
const MARK = "# Added by the Colonia installer";
const marks = (file: string) => fs.readFileSync(file, "utf8").split(MARK).length - 1;

test("a home without shell startup files gets one, and is told to open a new terminal", async () => {
  if (process.platform === "win32") return;
  await using home = tempDir("colonia-home-");
  const r = await installInto(home.path, "/bin/zsh");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(marks(path.join(home.path, ".zshrc")), 1);
  assert.match(r.stderr, /not on your PATH yet\. Open a new terminal/);
  await installInto(home.path, "/bin/zsh");
  assert.equal(marks(path.join(home.path, ".zshrc")), 1, "a second install adds nothing");
});

test("a startup file that already puts ~/.local/bin on the PATH is left as it is", async () => {
  if (process.platform === "win32") return;
  await using home = tempDir("colonia-home-");
  const rc = path.join(home.path, ".zshrc");
  fs.writeFileSync(rc, 'export PATH="$HOME/.local/bin:$PATH"\n');
  assert.equal((await installInto(home.path, "/bin/zsh")).status, 0);
  assert.equal(fs.readFileSync(rc, "utf8"), 'export PATH="$HOME/.local/bin:$PATH"\n');
});

test("bash on a Mac gets the line in the login file it reads, without a new .bash_profile", async () => {
  if (process.platform === "win32") return;
  await using home = tempDir("colonia-home-");
  fs.writeFileSync(path.join(home.path, ".bash_login"), "");
  const r = await installInto(
    home.path,
    "/bin/bash",
    (bin) =>
      fs.writeFileSync(
        path.join(bin, "uname"),
        '#!/bin/sh\n[ "$1" = -s ] && { echo Darwin; exit 0; }\nexec /usr/bin/uname "$@"\n',
        {
          mode: 0o755,
        },
      ),
    "darwin",
  );
  assert.equal(r.status, 0, r.stderr);
  assert.equal(marks(path.join(home.path, ".bash_login")), 1);
  assert.equal(fs.existsSync(path.join(home.path, ".bash_profile")), false);
});

test("a startup file that cannot be written does not stop the install", async () => {
  if (process.platform === "win32" || process.getuid?.() === 0) return;
  await using home = tempDir("colonia-home-");
  const rc = path.join(home.path, ".zshrc");
  fs.writeFileSync(rc, "");
  fs.chmodSync(rc, 0o444);
  const r = await installInto(home.path, "/bin/zsh");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /could not write/);
});

test("--equipo y --huella van juntos y exigen el servicio: se rechaza antes de instalar nada", () => {
  const run = (...args: string[]) =>
    spawnSync("bash", [script, ...args], { encoding: "utf8", env: { ...process.env, HOME: os.tmpdir() } });
  const solo = run("--equipo", "ws://10.0.0.2:4100");
  assert.notEqual(solo.status, 0);
  assert.match(solo.stderr, /--equipo and --huella go together/);
  const sinServicio = run("--equipo", "ws://10.0.0.2:4100", "--huella", "abcdef0123456789", "--no-service");
  assert.notEqual(sinServicio.status, 0);
  assert.match(sinServicio.stderr, /needs the service/);
});

test("EQUIPO-ARGS-1: una dirección o una huella con caracteres de consola se rechaza antes de instalar nada", () => {
  const run = (...args: string[]) =>
    spawnSync("bash", [script, ...args], { encoding: "utf8", env: { ...process.env, HOME: os.tmpdir() } });
  for (const mala of [
    "ws://10.0.0.2:4100;touch /tmp/x",
    "ws://h&calc",
    'ws://h"x',
    "ws://h$(id)",
    "ws://h x",
    "ws://h`id`",
  ]) {
    const r = run("--equipo", mala, "--huella", "abcdef0123456789");
    assert.notEqual(r.status, 0, mala);
    assert.match(r.stderr, /--equipo is not an address/, mala);
  }
  const h = run("--equipo", "ws://10.0.0.2:4100", "--huella", "abcd;rm -rf");
  assert.match(h.stderr, /--huella is not a fingerprint/);
  const [ok] = ["ws://[fd7a::1]:4100", "http://mi-pc.tailnet.ts.net:4100/equipo"];
  assert.doesNotMatch(
    run("--equipo", ok, "--huella", "abcd-ef01-2345-6789", "--no-service").stderr,
    /is not an address/,
  );
});

test("el instalador Bash solo elige la estable de mayor versión, salvo al indicar una versión concreta", async () => {
  await using dir = tempDir("colonia-feed-bash-");
  const releases = [
    {
      tag_name: "v2.49.3",
      draft: false,
      prerelease: false,
      body: 'Una nota con "tag_name": "v92.0.0", corchetes [] y llaves {}',
    },
    { body: "Una previa con etiqueta numérica", prerelease: true, tag_name: "v9.10.0", draft: false },
    { tag_name: "v8.99.0", prerelease: false, draft: true },
    {
      assets: [{ tag_name: "v97.0.0", prerelease: false, draft: false }],
      prerelease: false,
      tag_name: "v2.100.0",
      draft: false,
    },
    { tag_name: "v7.0.0-rc.1", draft: false, prerelease: false },
    { tag_name: "v6.0.0", prerelease: "false", draft: false },
    { tag_name: "v5.0.0", draft: false },
    { tag_name: "v1.999.0", draft: false, prerelease: false },
  ];
  let feed = JSON.stringify(releases).replace('"tag_name":"v2.100.0"', '"tag_\\u006eame":"v2.100\\u002e0"');
  const requests: string[] = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    requests.push(url.pathname);
    if (url.pathname === "/releases") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(feed);
    } else {
      res.writeHead(404);
      res.end("Fin de la prueba de selección");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const api = `http://127.0.0.1:${address.port}`;
    const gitRoot =
      process.platform === "win32"
        ? path.resolve(execFileSync("git", ["--exec-path"], { encoding: "utf8" }).trim(), "../../..")
        : "";
    const bash = process.platform === "win32" ? path.join(gitRoot, "bin", "bash.exe") : "bash";
    const bashEnv = path.join(dir.path, "prueba.bash");
    fs.writeFileSync(bashEnv, 'uname() { case "$1" in -m) echo x86_64;; *) echo Linux;; esac; }\n');
    const home = dir.path.replaceAll("\\", "/");
    const run = async (...args: string[]) => {
      requests.length = 0;
      await assert.rejects(
        promisify(execFile)(bash, [script.replaceAll("\\", "/"), "--feed", api, "--server", "--no-service", ...args], {
          env: {
            ...process.env,
            BASH_ENV: bashEnv.replaceAll("\\", "/"),
            HOME: home,
            CURL_HOME: home,
            NO_PROXY: "127.0.0.1",
            no_proxy: "127.0.0.1",
            COLONIA_ROOT: home,
            COLONIA_APP: `${home}/app`,
          },
        }),
      );
      return [...requests];
    };
    const bundleOf = (v: string) => `/download/v${v}/colonia-core-${v}-linux-x64.tar.gz`;
    const expandedFeed = feed;
    feed = JSON.stringify(releases.slice(0, 3), null, 2);
    assert.deepEqual(await run(), ["/releases", bundleOf("2.49.3")]);
    feed = expandedFeed;
    assert.deepEqual(await run(), ["/releases", bundleOf("2.100.0")]);
    assert.deepEqual(await run("--version", "v9.10.0"), [bundleOf("9.10.0")]);
    feed = JSON.stringify([{ tag_name: "v10.0.0", draft: false, prerelease: false }, releases[3]]);
    assert.deepEqual(await run(), ["/releases", bundleOf("10.0.0")]);
    feed = JSON.stringify([releases[1], releases[2]]);
    assert.deepEqual(await run(), ["/releases"]);
    feed = `${JSON.stringify([releases[0]])} texto ajeno`;
    assert.deepEqual(await run(), ["/releases"]);
    feed = JSON.stringify([releases[0]]).slice(0, -1);
    assert.deepEqual(await run(), ["/releases"]);
    feed = '[{"tag_name":"v7.0.0","draft":false,"prerelease":true,"prerelease":false}]';
    assert.deepEqual(await run(), ["/releases"]);
    assert.equal(fs.existsSync(path.join(dir.path, "app")), false);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});
