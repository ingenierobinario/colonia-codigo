import fs from "node:fs";
import path from "node:path";

// Type declarations, source maps, build caches and tool configs: nothing the core loads at run time. Docs stay: a
// package's README is often the only place that carries its licence or the notices of what it bundles.
const declaration = /\.d\.[mc]?ts$/i;
const sourceMap = /\.([mc]?js|[mc]?ts|css)\.map$/i;
const tooling = /^(\.eslintrc|\.nycrc|\.prettierrc)|^\.editorconfig$|^\.npmignore$/i;

/** Whether a file inside node_modules is never used at run time (by its base name). */
export function prunable(name: string): boolean {
  return (
    declaration.test(name) || sourceMap.test(name) || name.toLowerCase().endsWith(".tsbuildinfo") || tooling.test(name)
  );
}

/** Removes the prunable files under a staged node_modules; returns how many files and bytes went. */
export function pruneModules(nodeModules: string): { files: number; bytes: number } {
  let files = 0;
  let bytes = 0;
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && prunable(entry.name)) {
        bytes += fs.statSync(full).size;
        fs.rmSync(full);
        files++;
      }
    }
  };
  if (fs.existsSync(nodeModules)) walk(nodeModules);
  return { files, bytes };
}
