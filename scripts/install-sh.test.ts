import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
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
