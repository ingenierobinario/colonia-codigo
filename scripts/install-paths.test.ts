import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { tempDir } from "../apps/core/src/testkit/platform.ts";
import { desktopCandidates } from "../packages/install/src/paths.ts";
import { installDesktopFile } from "../packages/install/src/platform.ts";
import type { ProcessRunner } from "../packages/install/src/process.ts";

// The folder the installer writes the app to and the places it looks for it are two literals: this ties them.
for (const platform of ["darwin", "linux"]) {
  test(`the installer looks for the desktop app where it installs it (${platform})`, async () => {
    await using dir = tempDir("colonia-paths-");
    const home = dir.path;
    const work = path.join(home, "work");
    fs.mkdirSync(work);
    const file = path.join(work, "download");
    fs.writeFileSync(file, "app");
    // Stands in for macOS's ditto: unpacks an app on -x, copies it otherwise.
    const run: ProcessRunner = async (_command, args) => {
      if (args[0] === "-x") {
        const executable = path.join(args[3] as string, "Colonia.app", "Contents", "MacOS", "Colonia");
        fs.mkdirSync(path.dirname(executable), { recursive: true });
        fs.writeFileSync(executable, "app");
      } else fs.cpSync(args[0] as string, args[1] as string, { recursive: true });
    };
    const installed = await installDesktopFile(
      { platform, userHome: home, env: {}, run, found: () => undefined },
      file,
      work,
      AbortSignal.timeout(10_000),
    );
    assert.ok(fs.existsSync(installed));
    assert.ok(desktopCandidates(platform, {}, home).some((c) => path.resolve(c) === path.resolve(installed)));
  });
}
