import fs from "node:fs";
import path from "node:path";
import { build, type Plugin } from "esbuild";

/** Where the staged core's single file goes, relative to the staged root (core-process.ts starts it when it is there). */
export const CORE_BUNDLE = path.join("apps", "core", "core.mjs");

/**
 * ARRANQUE-RAPIDO-1: the core as ONE JavaScript file. Started as TypeScript it is ~700 modules that Node reads, strips
 * and compiles one by one; on Windows each file also goes past the antivirus, and the first start after an update
 * (compile cache cold) took 30-100 s before /health answered. Third-party packages stay in node_modules (imported by
 * name); only Colonia's own code goes in.
 *
 * Each module still sees its own place on disk: `import.meta.dirname` / `import.meta.url` are rewritten to the path the
 * original file has next to the bundle (the sources stay staged: workers, runners and assets are read from there).
 */
export async function stageCore(root: string, outfile = path.join(root, CORE_BUNDLE)): Promise<void> {
  const bundleDir = path.dirname(outfile);
  const rel = (file: string) => path.relative(bundleDir, file).split(path.sep).join("/");
  const ownMeta: Plugin = {
    name: "own-import-meta",
    setup(b) {
      b.onLoad({ filter: /\.ts$/ }, (args) => {
        const source = fs.readFileSync(args.path, "utf8");
        if (!source.includes("import.meta")) return { contents: source, loader: "ts" };
        const file = JSON.stringify(rel(args.path));
        const contents = source
          .replaceAll("import.meta.dirname", `__coloniaDir(${file})`)
          .replaceAll("import.meta.filename", `__coloniaFile(${file})`)
          .replaceAll("import.meta.url", `__coloniaUrl(${file})`)
          // Only the bundle's entry is "main": a module run on its own (pty-host.ts) is started from its source file.
          .replaceAll("import.meta.main", "false");
        return { contents, loader: "ts" };
      });
    },
  };
  await build({
    entryPoints: [path.join(root, "apps", "core", "src", "main.ts")],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    plugins: [
      {
        name: "colonia-inline",
        setup(b) {
          // Installed packages load from node_modules as before; @colonia/* (workspace sources) go in.
          b.onResolve({ filter: /^[^./]/ }, (args) =>
            args.path.startsWith("@colonia/") || /^[A-Za-z]:/.test(args.path)
              ? undefined
              : { path: args.path, external: true },
          );
          b.onResolve({ filter: /^@colonia\// }, async (args) => {
            if (args.pluginData === "inline") return undefined;
            const r = await b.resolve(args.path, {
              kind: args.kind,
              resolveDir: args.resolveDir,
              importer: args.importer,
              pluginData: "inline",
            });
            // Staged, @colonia/protocol is already JavaScript in node_modules: it stays a package import.
            return r.path.endsWith(".ts") ? r : { path: args.path, external: true };
          });
        },
      },
      ownMeta,
    ],
    banner: {
      js: [
        'import { fileURLToPath as __coloniaF, pathToFileURL as __coloniaP } from "node:url";',
        'import { createRequire as __coloniaR } from "node:module";',
        'import __coloniaPath from "node:path";',
        "const __coloniaHere = __coloniaPath.dirname(__coloniaF(import.meta.url));",
        "const __coloniaFile = (r) => __coloniaPath.resolve(__coloniaHere, r);",
        "const __coloniaDir = (r) => __coloniaPath.dirname(__coloniaFile(r));",
        "const __coloniaUrl = (r) => __coloniaP(__coloniaFile(r)).href;",
        "const require = __coloniaR(import.meta.url);",
      ].join("\n"),
    },
    logLevel: "warning",
  });
}

if (import.meta.main) {
  const root = path.resolve(process.argv[2] ?? path.join(import.meta.dirname, "../../.."));
  await stageCore(root, process.argv[3] ? path.resolve(process.argv[3]) : undefined);
  console.log(`core bundled: ${process.argv[3] ?? path.join(root, CORE_BUNDLE)}`);
}
