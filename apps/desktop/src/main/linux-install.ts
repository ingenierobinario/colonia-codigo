// How this Linux Colonia was installed. The detection is shared with the installer (packages/install); here it only
// runs its queries without freezing the main process.
import {
  linuxInstall as detect,
  type LinuxInstall,
  PACKAGE_DIR,
  type PackageRun,
  packageCommand,
} from "../../../../packages/install/src/linux-package.ts";
import { runCommand } from "./run-command.ts";

export { type LinuxInstall, PACKAGE_DIR, packageCommand };

const defaultRun: PackageRun = (command, args) => runCommand(command, args, { timeout: 10_000 });

export function linuxInstall(
  env: NodeJS.ProcessEnv = process.env,
  execPath = process.execPath,
  run: PackageRun = defaultRun,
): Promise<LinuxInstall> {
  return detect(env, execPath, run);
}
