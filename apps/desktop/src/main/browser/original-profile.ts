import path from "node:path";
import type { FuenteImportar } from "../migrar/navegadores.ts";

const executables = { chrome: "Google Chrome", brave: "Brave Browser", edge: "Microsoft Edge", firefox: "firefox" };

/** El proceso principal resuelve tanto el ejecutable instalado como el perfil local elegido por el propietario. */
export function originalProfileCommand(source: FuenteImportar, executable: string, system: NodeJS.Platform) {
  const command =
    system === "darwin" ? path.join(executable, "Contents", "MacOS", executables[source.navegador]) : executable;
  const args =
    source.familia === "firefox"
      ? ["-profile", source.dir, "-new-window", "about:blank"]
      : [`--profile-directory=${source.perfil}`, "--new-window", "about:blank"];
  return { command, args };
}
