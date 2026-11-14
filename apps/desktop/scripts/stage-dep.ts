import fs from "node:fs";
import path from "node:path";
import { build } from "esbuild";

/**
 * PERF-6: leaves an installed dependency as one JavaScript file. The core loads it at every start, and a package of
 * hundreds of small files costs a stat and an open each (kysely: 254 files, ~500 ms on Windows; ~15 ms as one file).
 * Only for a package with no dependencies that is imported by its bare name and by the core alone.
 */
export async function stageSingleFile(dir: string): Promise<void> {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as {
    name: string;
    version: string;
    license?: string;
    dependencies?: Record<string, string>;
  };
  if (Object.keys(manifest.dependencies ?? {}).length) throw new Error(`${manifest.name} has dependencies of its own`);
  const tmp = `${dir}.bundle`;
  fs.rmSync(tmp, { recursive: true, force: true });
  await build({
    // The package's own entry, as Node resolves its bare name.
    stdin: { contents: `export * from ${JSON.stringify(manifest.name)};`, resolveDir: dir, loader: "js" },
    outfile: path.join(tmp, "index.js"),
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    logLevel: "warning",
  });
  for (const name of fs.readdirSync(dir)) {
    if (/^(licen[cs]e|notice)/i.test(name)) fs.copyFileSync(path.join(dir, name), path.join(tmp, name));
  }
  fs.writeFileSync(
    path.join(tmp, "package.json"),
    JSON.stringify(
      {
        name: manifest.name,
        version: manifest.version,
        ...(manifest.license ? { license: manifest.license } : {}),
        type: "module",
        exports: "./index.js",
      },
      null,
      2,
    ),
  );
  fs.rmSync(dir, { recursive: true, force: true });
  fs.renameSync(tmp, dir);
}

/** The installed packages (other than `name`) that ask for `name`: with any, it cannot be reduced to its bare entry. */
export function dependents(nodeModules: string, name: string): string[] {
  const found: string[] = [];
  const look = (dir: string) => {
    const file = path.join(dir, "package.json");
    if (!fs.existsSync(file)) return;
    const pkg = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, Record<string, string> | string>;
    if (pkg.name === name) return;
    for (const key of ["dependencies", "peerDependencies", "optionalDependencies"]) {
      const deps = pkg[key];
      if (deps && typeof deps === "object" && name in deps) found.push(String(pkg.name));
    }
  };
  for (const entry of fs.existsSync(nodeModules) ? fs.readdirSync(nodeModules) : []) {
    const dir = path.join(nodeModules, entry);
    if (entry.startsWith("@")) for (const sub of fs.readdirSync(dir)) look(path.join(dir, sub));
    else look(dir);
  }
  return [...new Set(found)];
}
