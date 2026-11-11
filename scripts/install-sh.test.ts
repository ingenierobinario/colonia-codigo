import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { tempDir } from "../apps/core/src/testkit/platform.ts";
import { coreBundleName, platformOf } from "../packages/protocol/src/releases.ts";

const script = path.resolve(import.meta.dirname, "install/install.sh");

/** A bundle with only what install.sh checks: colonia/node/bin/node, executable. */
function bundle(dir: string, version: string): string {
  const platform = platformOf(process.platform, process.arch);
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
  assert.deepEqual(left.filter((file) => fs.existsSync(file)), []);

  // An entry that starts something else (a package from the distribution) is not this installer's to remove.
  plant("/opt/Colonia/colonia");
  uninstall();
  assert.deepEqual(left.filter((file) => fs.existsSync(file)), left.slice(0, 4));
});
