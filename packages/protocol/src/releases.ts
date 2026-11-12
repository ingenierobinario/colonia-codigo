// Where an installed Colonia learns that a newer one is out: the GitHub Releases of a public repo. Shared by the core (a
// server install updates itself) and the desktop app (it updates the app, which carries its own core).

/**
 * owner/repo whose Releases hold the installers and the daemon bundles. COLONIA_RELEASES overrides it (an owner/repo, or
 * the base URL of a GitHub-shaped API such as a local test feed); "off" disables.
 */
export const RELEASE_FEED = "ingenierobinario/colonia";
export const RELEASE_CHECK_EVERY_MS = 6 * 3600_000;

export type ReleaseAsset = { name: string; url: string };
/** The languages a release says its notes in. */
export type NotesLanguage = "en" | "es";
/** What a release brings, said once per language (the body's "## Español" and "## English" sections). */
export type LocalizedNotes = { en?: string[] | undefined; es?: string[] | undefined };
export type Release = { version: string; notes: string[]; localized?: LocalizedNotes; assets: ReleaseAsset[] };

/** The operating system and processor as release file names spell them (electron-builder's ${os}, Node's arch). */
export type Platform = { os: "linux" | "mac" | "win"; arch: "x64" | "arm64" };

export function platformOf(platform: string, arch: string): Platform | undefined {
  const os = platform === "linux" ? "linux" : platform === "darwin" ? "mac" : platform === "win32" ? "win" : undefined;
  return os && (arch === "x64" || arch === "arm64") ? { os, arch } : undefined;
}

/** A build target as `<os>-<arch>` (COLONIA_TARGET=linux-x64), or this machine when unset. */
export function targetOf(spec: string | undefined, platform: string, arch: string): Platform | undefined {
  if (!spec) return platformOf(platform, arch);
  const [os, cpu, ...extra] = spec.split("-");
  if (extra.length) return undefined;
  const node = os === "mac" ? "darwin" : os === "win" ? "win32" : os;
  return platformOf(node ?? "", cpu ?? "");
}

/** Node's name for a platform's operating system (what npm --os and the Node downloads say). */
export const nodeOs = (p: Platform) => (p.os === "mac" ? "darwin" : p.os === "win" ? "win32" : "linux");

/** The daemon on its own (core, terminal, panel and the Node that runs them), as install.sh/ps1 and updates fetch it. */
export const coreBundleName = (version: string, p: Platform) => `colonia-core-${version}-${p.os}-${p.arch}.tar.gz`;

/**
 * The desktop app's installer for this platform, as electron-builder names it (it says x86_64 for an x64 AppImage).
 * "deb" and "rpm": Linux's system packages, for a Colonia that came from one (each format has its own arch names).
 */
export function desktopAssetFor(
  assets: ReleaseAsset[],
  version: string,
  p: Platform,
  kind: "installer" | "zip" | "deb" | "rpm" = "installer",
): ReleaseAsset | undefined {
  if ((kind === "deb" || kind === "rpm") && p.os !== "linux") return undefined;
  const ext =
    kind === "zip"
      ? ".zip"
      : kind === "deb" || kind === "rpm"
        ? `.${kind}`
        : p.os === "linux"
          ? ".AppImage"
          : p.os === "mac"
            ? ".dmg"
            : ".exe";
  const arches =
    kind === "deb"
      ? [p.arch === "x64" ? "amd64" : "arm64"]
      : kind === "rpm"
        ? [p.arch === "x64" ? "x86_64" : "aarch64"]
        : p.arch === "x64"
          ? ["x64", "x86_64", "amd64"]
          : ["arm64", "aarch64"];
  return assets.find((a) => arches.some((arch) => a.name === `Colonia-${version}-${p.os}-${arch}${ext}`));
}

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)$/;

/** Plain x.y.z only (a pre-release or a dev build compares by its x.y.z). Negative when a is older than b. */
export function compareVersions(a: string, b: string): number {
  const pa = SEMVER.exec(a.replace(/[-+].*$/, ""));
  const pb = SEMVER.exec(b.replace(/[-+].*$/, ""));
  if (!pa || !pb) return 0;
  for (let i = 1; i <= 3; i++) {
    const d = Number(pa[i]) - Number(pb[i]);
    if (d) return d;
  }
  return 0;
}

type GithubRelease = {
  tag_name?: unknown;
  draft?: unknown;
  prerelease?: unknown;
  body?: unknown;
  assets?: Array<{ name?: unknown; browser_download_url?: unknown }>;
};

const HEADING = /^#{1,6}\s+(.+?)\s*#*$/;
const LANGUAGE_HEADINGS: Array<[NotesLanguage, RegExp]> = [
  ["en", /^(english|en)$/i],
  ["es", /^(espa[nñ]ol|spanish|castellano|es)$/i],
];

const cleanBullet = (line: string) =>
  line
    .slice(2)
    .replace(/ by @\S+ in \S+$/, "")
    .replace(/\*\*|`/g, "")
    .trim();

/**
 * What the release body says, as short lines (its bullets, without the markdown). Bullets under a language heading
 * belong to that language; any other heading, or none, leaves them untagged (how releases up to 2.26.0 were written).
 */
function notesOf(body: unknown, max = 8): { notes: string[]; localized?: LocalizedNotes } {
  if (typeof body !== "string") return { notes: [] };
  const plain: string[] = [];
  const localized: LocalizedNotes = {};
  let language: NotesLanguage | undefined;
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    const heading = HEADING.exec(line)?.[1];
    if (heading !== undefined) {
      language = LANGUAGE_HEADINGS.find(([, re]) => re.test(heading))?.[0];
      continue;
    }
    if (!/^[-*] /.test(line)) continue;
    const text = cleanBullet(line);
    if (!text) continue;
    if (language) localized[language] ??= [];
    const into = language ? (localized[language] ?? plain) : plain;
    if (into.length < max) into.push(text);
  }
  if (!localized.en && !localized.es) return { notes: plain };
  // Callers that know no languages (apps up to 2.26.0 read every bullet) still get one list.
  return { notes: plain.length ? plain : (localized.en ?? localized.es ?? []), localized };
}

/** The inverse of the parser: the body a release is published with, Spanish first, one section per language. */
export function releaseBody(localized: LocalizedNotes): string {
  const section = (title: string, lines: string[] | undefined) =>
    lines?.length ? [`## ${title}\n\n${lines.map((l) => `- ${l}`).join("\n")}`] : [];
  const parts = [...section("Español", localized.es), ...section("English", localized.en)];
  return parts.length ? `${parts.join("\n\n")}\n` : "";
}

/**
 * The published releases newer than `current`, newest first, from the GitHub API's list. Drafts, pre-releases and
 * tags that are not plain vX.Y.Z (v1's own tags are older, so they never count) are left out.
 */
export function newerReleases(list: unknown, current: string): Release[] {
  if (!Array.isArray(list)) return [];
  const out: Release[] = [];
  for (const r of list as GithubRelease[]) {
    if (r.draft === true || r.prerelease === true || typeof r.tag_name !== "string") continue;
    if (!SEMVER.test(r.tag_name) || compareVersions(r.tag_name, current) <= 0) continue;
    const assets = (r.assets ?? []).flatMap((a) =>
      typeof a.name === "string" && typeof a.browser_download_url === "string"
        ? [{ name: a.name, url: a.browser_download_url }]
        : [],
    );
    out.push({ version: r.tag_name.slice(1), ...notesOf(r.body), assets });
  }
  return out.sort((a, b) => compareVersions(b.version, a.version));
}

/**
 * What the newer releases change, newest first, as a few lines (a release without bullets says its name). With a
 * language, each release answers in it when it can, and with its plain notes when it cannot.
 */
export const releaseChanges = (newer: Release[], max = 8, language?: NotesLanguage): string[] =>
  newer
    .flatMap((r) => (language && r.localized?.[language]) ?? (r.notes.length ? r.notes : [`Colonia ${r.version}`]))
    .slice(0, max);

/** The same lines once per language, for a screen to pick from; nothing when no release says them by language. */
export function localizedChanges(newer: Release[], max = 8): { en: string[]; es: string[] } | undefined {
  if (!newer.some((r) => r.localized)) return undefined;
  return { en: releaseChanges(newer, max, "en"), es: releaseChanges(newer, max, "es") };
}

/** Asks GitHub for the feed's recent releases (no token: 60 requests an hour per address is plenty). */
export async function fetchReleases(feed: string, fetchImpl: typeof fetch = fetch): Promise<unknown> {
  const base = /^https?:\/\//.test(feed) ? feed.replace(/\/+$/, "") : `https://api.github.com/repos/${feed}`;
  const r = await fetchImpl(`${base}/releases?per_page=100`, {
    headers: { accept: "application/vnd.github+json", "user-agent": "colonia-updates" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) throw new Error(`release feed ${feed}: HTTP ${r.status}`);
  return r.json();
}

/** The hex digest a `<asset>.sha256` file holds (`<hex>  <name>`, as sha256sum writes it). */
export function parseSha256(text: string): string | undefined {
  return /^[0-9a-f]{64}\b/i.exec(text.trim())?.[0].toLowerCase();
}

/**
 * A daemon installed from a bundle (install.sh/ps1) lives in COLONIA_APP: `versions/<version>/` holds each bundle as
 * unpacked, and `current` links the one that runs. Paths inside a bundle, as segments to join.
 */
export const BUNDLE = {
  current: "current",
  versions: "versions",
  node: (win: boolean) => (win ? ["node", "node.exe"] : ["node", "bin", "node"]),
  core: ["apps", "core", "src", "main.ts"],
  terminal: ["apps", "terminal", "src", "main.ts"],
} as const;
