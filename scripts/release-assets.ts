// What a release carries, from one list: each build runner checks its own slice of out/, the publish job checks the
// whole set and every checksum before anything is public. Names come from the functions the updater and the installers
// use, so a rename breaks this check instead of the people updating.
// Usage: node scripts/release-assets.ts <version> <dir> [--platform <os>-<arch>]
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { coreBundleName, type Platform, parseSha256, targetOf } from "../packages/protocol/src/releases.ts";

/** The platforms a release is built for. The matrix of publicar-version.yml mirrors this list. */
export const RELEASE_PLATFORMS: Platform[] = [
  { os: "mac", arch: "arm64" },
  { os: "mac", arch: "x64" },
  { os: "linux", arch: "x64" },
  { os: "linux", arch: "arm64" },
  { os: "win", arch: "x64" },
];
const INSTALLER_EXT = { mac: "dmg", linux: "AppImage", win: "exe" } as const;
/** electron-builder names the x64 AppImage x86_64; every other file keeps x64. */
const installerArch = (p: Platform) => (p.os === "linux" && p.arch === "x64" ? "x86_64" : p.arch);

/** One platform's installer, zip and core bundle, each with its .sha256. */
export function platformAssets(version: string, p: Platform): string[] {
  const files = [
    `Colonia-${version}-${p.os}-${installerArch(p)}.${INSTALLER_EXT[p.os]}`,
    `Colonia-${version}-${p.os}-${p.arch}.zip`,
    coreBundleName(version, p),
  ];
  return files.flatMap((f) => [f, `${f}.sha256`]);
}

/** Every file of a release: each platform's slice plus the two install scripts. */
export const expectedAssets = (version: string, platforms = RELEASE_PLATFORMS) => [
  ...platforms.flatMap((p) => platformAssets(version, p)),
  "install.sh",
  "install.ps1",
];

/** What is missing from `present`, and (only when `exact`) what is there without being expected. */
export function checkAssets(expected: string[], present: string[], exact: boolean) {
  const have = new Set(present);
  const want = new Set(expected);
  return {
    missing: expected.filter((n) => !have.has(n)),
    unexpected: exact ? present.filter((n) => !want.has(n)) : [],
  };
}

/** Files among `names` (in `dir`) whose content does not match the `.sha256` beside them, or that have none. */
export function badChecksums(dir: string, names: string[]): string[] {
  const bad: string[] = [];
  for (const name of names) {
    if (name.endsWith(".sha256") || name.startsWith("install.")) continue;
    const file = path.join(dir, name);
    const sumFile = `${file}.sha256`;
    if (!fs.existsSync(file)) continue;
    if (!fs.existsSync(sumFile)) {
      bad.push(`${name}: no .sha256`);
      continue;
    }
    const want = parseSha256(fs.readFileSync(sumFile, "utf8"));
    const got = createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    if (want !== got) bad.push(`${name}: checksum does not match`);
  }
  return bad;
}

/** The CLI: prints each problem on its own line; returns the exit code. */
export function check(argv: readonly string[], log = console.log): number {
  const [version, dir, flag, spec] = argv;
  if (!version || !dir || (flag !== undefined && flag !== "--platform")) {
    log("usage: node scripts/release-assets.ts <version> <dir> [--platform <os>-<arch>]");
    return 2;
  }
  const platform = flag ? targetOf(spec, "", "") : undefined;
  if (flag && !platform) {
    log(`unknown platform: ${spec ?? ""}`);
    return 2;
  }
  const expected = platform ? platformAssets(version, platform) : expectedAssets(version);
  const present = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => fs.statSync(path.join(dir, n)).isFile()) : [];
  const { missing, unexpected } = checkAssets(expected, present, !platform);
  const problems = [
    ...missing.map((n) => `missing: ${n}`),
    ...unexpected.map((n) => `unexpected: ${n}`),
    ...badChecksums(dir, expected),
  ];
  for (const p of problems) log(p);
  if (!problems.length) log(`${expected.length} files present, every checksum matches`);
  return problems.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = check(process.argv.slice(2));
}
