import { createHash } from "node:crypto";
import fs from "node:fs";
import { parseSha256, type Release, type ReleaseAsset } from "@colonia/protocol";
import { download } from "./download.ts";

/** Stream verification so a large update never occupies its full size in the desktop process. */
export async function fileDigest(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

export async function fetchChecked(release: Release, asset: ReleaseAsset, file: string): Promise<void> {
  const sum = release.assets.find((a) => a.name === `${asset.name}.sha256`);
  const sumFile = `${file}.sha256`;
  try {
    if (!sum) throw new Error(`${asset.name} has no .sha256`);
    await download(sum.url, sumFile, { maxBytes: 4096 });
    const want = parseSha256(await fs.promises.readFile(sumFile, "utf8"));
    if (!want) throw new Error(`${asset.name} does not match its .sha256`);
    await download(asset.url, file);
    if (want !== (await fileDigest(file))) throw new Error(`${asset.name} does not match its .sha256`);
  } catch (error) {
    await fs.promises.rm(file, { force: true });
    throw error;
  } finally {
    await fs.promises.rm(sumFile, { force: true });
  }
}
