import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ProcessRunner } from "./process.ts";

export async function installDesktopFile(
  opts: {
    platform: string;
    userHome: string;
    env: NodeJS.ProcessEnv;
    run: ProcessRunner;
    found: () => string | undefined;
  },
  file: string,
  work: string,
  signal: AbortSignal,
): Promise<string> {
  const { run, found } = opts;
  if (opts.platform === "win32") {
    await run(file, ["/S"], { signal, env: opts.env });
    const app = found();
    if (!app) throw new Error("The desktop installer did not finish. Try again or open the installer manually.");
    return app;
  }
  const destination = path.join(opts.userHome, "Applications", opts.platform === "darwin" ? "Colonia.app" : "Colonia.AppImage");
  const staged = `${destination}.install-${randomUUID()}`;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  try {
    if (opts.platform === "darwin") {
      const unpacked = path.join(work, "unpacked");
      await run("/usr/bin/ditto", ["-x", "-k", file, unpacked], { signal, env: opts.env });
      const source = path.join(unpacked, "Colonia.app");
      if (!fs.existsSync(path.join(source, "Contents", "MacOS", "Colonia")))
        throw new Error("The desktop archive has no Colonia app");
      await run("/usr/bin/ditto", [source, staged], { signal, env: opts.env });
      if (fs.existsSync(destination)) throw new Error("Colonia was installed by another process; retry to open it");
      fs.renameSync(staged, destination);
    } else {
      fs.copyFileSync(file, staged, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(staged, 0o755);
      fs.linkSync(staged, destination);
    }
  } finally {
    fs.rmSync(staged, { recursive: true, force: true });
  }
  return destination;
}
