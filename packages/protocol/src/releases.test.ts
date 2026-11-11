import assert from "node:assert/strict";
import { test } from "node:test";
import {
  compareVersions,
  coreBundleName,
  desktopAssetFor,
  fetchReleases,
  localizedChanges,
  newerReleases,
  nodeOs,
  parseSha256,
  platformOf,
  releaseBody,
  releaseChanges,
  targetOf,
} from "./releases.ts";

const asset = (name: string) => ({ name, browser_download_url: `https://example.com/${name}` });

test("release targets select the requested platform and arch, or use this machine only when unset", () => {
  for (const [os, platform] of [
    ["linux", "linux"],
    ["mac", "darwin"],
    ["win", "win32"],
  ] as const) {
    for (const arch of ["x64", "arm64"] as const) {
      assert.deepEqual(targetOf(`${os}-${arch}`, "unsupported", "unknown"), { os, arch });
      assert.equal(nodeOs({ os, arch }), platform);
      assert.deepEqual(targetOf(undefined, platform, arch), { os, arch });
    }
  }
  for (const spec of ["linux", "linux-ia32", "freebsd-x64", "linux-x64-extra", "mac-arm64-"])
    assert.equal(targetOf(spec, "linux", "x64"), undefined, spec);
  assert.equal(targetOf(undefined, "freebsd", "x64"), undefined);
});

test("versions compare by x.y.z, a dev build by the tag it came from", () => {
  assert.ok(compareVersions("2.1.10", "2.1.9") > 0);
  assert.ok(compareVersions("v2.0.3", "2.1.0") < 0);
  assert.equal(compareVersions("2.1.2-dev.40+d85585f", "2.1.2"), 0);
  assert.equal(compareVersions("nonsense", "2.0.0"), 0);
});

test("only published vX.Y.Z releases newer than this one count, newest first", () => {
  const list = [
    { tag_name: "v2.3.0", draft: true, assets: [] },
    { tag_name: "v2.2.0-beta.1", prerelease: true, assets: [] },
    {
      tag_name: "v2.1.0",
      body: "## What's Changed\n* feat: sidebar sections by @someone in https://x/1\n- fix: `colonia` on PATH\n",
      assets: [asset("a")],
    },
    { tag_name: "v2.2.0", body: "", assets: [] },
    { tag_name: "v1.123.1", assets: [] },
    { tag_name: "android-latest", assets: [] },
    { tag_name: "v2.0.3", assets: [] },
  ];
  const out = newerReleases(list, "2.0.3");
  assert.deepEqual(
    out.map((r) => r.version),
    ["2.2.0", "2.1.0"],
  );
  assert.deepEqual(out[1]?.notes, ["feat: sidebar sections", "fix: colonia on PATH"]);
  assert.deepEqual(out[1]?.assets, [{ name: "a", url: "https://example.com/a" }]);
  assert.deepEqual(newerReleases({ message: "rate limited" }, "2.0.0"), []);
});

test("each platform finds its own installer and daemon bundle", () => {
  const assets = [
    "Colonia-2.2.0-linux-x86_64.AppImage",
    "Colonia-2.2.0-mac-arm64.dmg",
    "Colonia-2.2.0-mac-arm64.zip",
    "Colonia-2.2.0-win-x64.exe",
  ].map((n) => ({
    name: n,
    url: n,
  }));
  const linux = platformOf("linux", "x64");
  const mac = platformOf("darwin", "arm64");
  assert.ok(linux && mac);
  assert.equal(desktopAssetFor(assets, "2.2.0", linux)?.name, "Colonia-2.2.0-linux-x86_64.AppImage");
  assert.equal(desktopAssetFor(assets, "2.2.0", mac)?.name, "Colonia-2.2.0-mac-arm64.dmg");
  assert.equal(desktopAssetFor(assets, "2.2.1", mac), undefined);
  assert.equal(desktopAssetFor(assets, "2.2.0", mac, "zip")?.name, "Colonia-2.2.0-mac-arm64.zip");
  assert.equal(coreBundleName("2.2.0", linux), "colonia-core-2.2.0-linux-x64.tar.gz");
  assert.equal(platformOf("freebsd", "x64"), undefined);
  assert.equal(platformOf("linux", "ia32"), undefined);
});

test("the feed is a GitHub repo, or the base URL of a feed shaped like its API", async () => {
  const asked: string[] = [];
  const fake = (async (url: string) => {
    asked.push(url);
    return new Response("[]");
  }) as typeof fetch;
  await fetchReleases("acme/colonia", fake);
  await fetchReleases("http://127.0.0.1:7499/", fake);
  assert.deepEqual(asked, [
    "https://api.github.com/repos/acme/colonia/releases?per_page=100",
    "http://127.0.0.1:7499/releases?per_page=100",
  ]);
});

test("a .sha256 file gives its digest", () => {
  const hex = "a".repeat(64);
  assert.equal(parseSha256(`${hex}  colonia-core-2.2.0-linux-x64.tar.gz\n`), hex);
  assert.equal(parseSha256("not a digest"), undefined);
});

test("what the newer releases change: their bullets, newest first, and the name of one that has none", () => {
  const newer = newerReleases(
    [
      { tag_name: "v2.3.26", body: "**Full Changelog**: https://example.com/compare/v2.3.25...v2.3.26" },
      { tag_name: "v2.3.25", body: "- Inbox: unread chats repeat on top\n- Docs: guides in line with the code" },
    ],
    "2.3.24",
  );
  assert.deepEqual(releaseChanges(newer), [
    "Colonia 2.3.26",
    "Inbox: unread chats repeat on top",
    "Docs: guides in line with the code",
  ]);
  assert.equal(releaseChanges(newer, 2).length, 2);
});

const BILINGUAL = [
  "## Español",
  "",
  "- Cada proyecto puede llevar su propia imagen.",
  "- Las tareas cerradas se pueden reabrir.",
  "",
  "## English",
  "",
  "- Each project can have its own picture.",
  "- Closed tasks can be reopened.",
  "",
].join("\n");

test("a release that says its notes under a heading per language gives them by language", () => {
  const [r] = newerReleases([{ tag_name: "v2.27.0", body: BILINGUAL }], "2.26.0");
  assert.deepEqual(r?.localized, {
    es: ["Cada proyecto puede llevar su propia imagen.", "Las tareas cerradas se pueden reabrir."],
    en: ["Each project can have its own picture.", "Closed tasks can be reopened."],
  });
  // Who knows no languages still reads one list, not both.
  assert.deepEqual(r?.notes, r?.localized?.en);
  assert.deepEqual(releaseChanges(r ? [r] : [], 8, "es"), r?.localized?.es);
  assert.deepEqual(releaseChanges(r ? [r] : []), r?.localized?.en);
});

test("language headings are read whatever their level, case and spelling", () => {
  const body = "# ESPANOL #\n* Uno\n### Castellano\n- Dos\n#### en\n- One\n###### Spanish\n- Tres";
  const [r] = newerReleases([{ tag_name: "v2.27.0", body }], "2.26.0");
  assert.deepEqual(r?.localized, { es: ["Uno", "Dos", "Tres"], en: ["One"] });
});

test("a release written the old way has plain notes and no languages", () => {
  const [r] = newerReleases([{ tag_name: "v2.26.0", body: "- Agents keep working\n- **Faster** `inbox`" }], "2.25.0");
  assert.deepEqual(r?.notes, ["Agents keep working", "Faster inbox"]);
  assert.equal(r?.localized, undefined);
  assert.deepEqual(releaseChanges(r ? [r] : [], 8, "es"), ["Agents keep working", "Faster inbox"]);
  assert.equal(localizedChanges(r ? [r] : []), undefined);
});

test("a heading that names no language leaves its bullets untagged", () => {
  const body = "## Español\n- Uno\n## Full changelog\n- chore: bump\n## English\n- One";
  const [r] = newerReleases([{ tag_name: "v2.27.0", body }], "2.26.0");
  assert.deepEqual(r?.localized, { es: ["Uno"], en: ["One"] });
  assert.deepEqual(r?.notes, ["chore: bump"]);
});

test("a release in one language only answers in it, whatever language is asked", () => {
  const [r] = newerReleases([{ tag_name: "v2.27.0", body: "## Español\n\n- Solo en español" }], "2.26.0");
  assert.deepEqual(r?.localized, { es: ["Solo en español"] });
  assert.deepEqual(r?.notes, ["Solo en español"]);
  assert.deepEqual(releaseChanges(r ? [r] : [], 8, "en"), ["Solo en español"]);
  assert.deepEqual(localizedChanges(r ? [r] : []), { en: ["Solo en español"], es: ["Solo en español"] });
});

test("old and new releases together give a full list in each language", () => {
  const newer = newerReleases(
    [
      { tag_name: "v2.27.0", body: BILINGUAL },
      { tag_name: "v2.26.0", body: "- Agents keep working through long conversations" },
      { tag_name: "v2.25.0", body: "" },
    ],
    "2.24.0",
  );
  assert.deepEqual(localizedChanges(newer), {
    en: [
      "Each project can have its own picture.",
      "Closed tasks can be reopened.",
      "Agents keep working through long conversations",
      "Colonia 2.25.0",
    ],
    es: [
      "Cada proyecto puede llevar su propia imagen.",
      "Las tareas cerradas se pueden reabrir.",
      "Agents keep working through long conversations",
      "Colonia 2.25.0",
    ],
  });
  assert.equal(localizedChanges(newer, 3)?.es.length, 3);
});

test("the body a release is published with reads back as the same notes", () => {
  const notes = { es: ["Uno.", "Dos."], en: ["One.", "Two."] };
  const body = releaseBody(notes);
  assert.equal(body, "## Español\n\n- Uno.\n- Dos.\n\n## English\n\n- One.\n- Two.\n");
  assert.deepEqual(newerReleases([{ tag_name: "v2.27.0", body }], "2.26.0")[0]?.localized, notes);
  assert.equal(releaseBody({}), "");
  assert.equal(releaseBody({ en: ["Only English."] }), "## English\n\n- Only English.\n");
});
