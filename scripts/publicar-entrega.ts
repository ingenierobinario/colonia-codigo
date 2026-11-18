import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isReleaseTag } from "./release-check.ts";

type Result = { status: number | null; stdout: string; stderr: string };
type Gh = (args: string[]) => Result;
type Entrega = { tag: string; repo: string; files: string[]; notes: string; prueba: boolean };

export function publicarEntrega({ tag, repo, files, notes, prueba }: Entrega, gh: Gh) {
  if (!isReleaseTag(tag)) throw new Error("Etiqueta de versión no válida");
  const ref = [tag, "-R", repo];
  const view = gh(["release", "view", ...ref, "--json", "isDraft,isPrerelease"]);
  const checked = (args: string[]) => {
    const r = gh(args);
    if (r.status !== 0) throw new Error(r.stderr.trim() || "La entrega no se ha completado.");
  };
  if (view.status !== 0) {
    if (!/release not found|HTTP 404/i.test(view.stderr))
      throw new Error(view.stderr.trim() || "No se pudo consultar la versión.");
    checked([
      "release",
      "create",
      ...ref,
      ...files,
      "--target",
      "main",
      "--title",
      `Colonia ${tag.slice(1)}`,
      "--notes-file",
      notes,
      ...(prueba ? ["--prerelease"] : []),
    ]);
    return;
  }
  const state = JSON.parse(view.stdout) as { isDraft?: boolean; isPrerelease?: boolean };
  if (state.isDraft !== true && state.isPrerelease !== true)
    throw new Error("Esta versión ya es estable. Usa una nueva versión para distribuir otros instaladores.");
  checked(["release", "upload", ...ref, ...files, "--clobber"]);
  checked(["release", "edit", ...ref, "--draft=false", `--prerelease=${prueba}`, "--notes-file", notes]);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [tag, repo, dir, notes, mode] = process.argv.slice(2);
  if (!tag || !repo || !dir || !notes || (mode !== "prueba" && mode !== "estable"))
    throw new Error("Faltan los datos de la entrega.");
  const files = fs.readdirSync(dir).map((name) => path.join(dir, name));
  publicarEntrega({ tag, repo, files, notes, prueba: mode === "prueba" }, (args) => {
    const result = spawnSync("gh", args, { encoding: "utf8" });
    if (result.error) throw result.error;
    return result;
  });
}
