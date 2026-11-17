// ENLACE-TEMPORAL-1 · The official cloudflared binary for a Cloudflare Quick Tunnel, fetched once into Colonia's data
// folder: a pinned release, checked against its sha256 before it ever runs. No account, nothing for the owner to install.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** The pinned release; bump it together with every digest below (GitHub lists them on the release's assets). */
export const CLOUDFLARED_VERSION = "2026.10.7";

type Asset = { file: string; sha256: string; tgz?: boolean };
const ASSETS: Record<string, Asset> = {
  "win32-x64": {
    file: "cloudflared-windows-amd64.exe",
    sha256: "2493dbc168923bb3e59e5e7716f71deced92992eea9acd6e9d74f84ac7751343",
  },
  // There is no arm64 build for Windows: the x64 one runs under Windows' own emulation.
  "win32-arm64": {
    file: "cloudflared-windows-amd64.exe",
    sha256: "2493dbc168923bb3e59e5e7716f71deced92992eea9acd6e9d74f84ac7751343",
  },
  "linux-x64": {
    file: "cloudflared-linux-amd64",
    sha256: "1f99fb518b83dec2ba8d870a7cc991d82a77e6196295a3d2754ba17ab9f91872",
  },
  "linux-arm64": {
    file: "cloudflared-linux-arm64",
    sha256: "3df43aedc9ff291d1735b5cb576cb97e0b157488796db2e32b28aecabb445775",
  },
  "darwin-x64": {
    file: "cloudflared-darwin-amd64.tgz",
    sha256: "02f3edfd87684dd5b705607688e4eb4b323f6e777b81e7b3a85af556aa356848",
    tgz: true,
  },
  "darwin-arm64": {
    file: "cloudflared-darwin-arm64.tgz",
    sha256: "3586ccf397e98e5f437e60e7c307ca6ac463e110580503af8bb8e6f9ebf831bd",
    tgz: true,
  },
};

export const cloudflaredAsset = (platform: string = process.platform, arch: string = process.arch) =>
  ASSETS[`${platform}-${arch}`];

const sha256File = (file: string) =>
  new Promise<string>((resolve, reject) => {
    const hash = createHash("sha256");
    fs.createReadStream(file)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });

const untar = (archive: string, dir: string) =>
  new Promise<void>((resolve, reject) =>
    execFile("tar", ["-xzf", archive, "-C", dir, "cloudflared"], (err) => (err ? reject(err) : resolve())),
  );

let pending: Promise<string> | undefined;

/**
 * The path of a verified cloudflared under `<home>/bin`, downloading it the first time. Throws when this computer has
 * no build, the download fails, or what arrived is not exactly the published file.
 */
export function ensureCloudflared(home: string, fetchFn: typeof fetch = fetch): Promise<string> {
  pending ??= fetchCloudflared(home, fetchFn).finally(() => {
    pending = undefined;
  });
  return pending;
}

async function fetchCloudflared(home: string, fetchFn: typeof fetch): Promise<string> {
  const asset = cloudflaredAsset();
  if (!asset) throw new Error(`no cloudflared build for ${process.platform}-${process.arch}`);
  const dir = path.join(home, "bin");
  const bin = path.join(dir, `cloudflared-${CLOUDFLARED_VERSION}${process.platform === "win32" ? ".exe" : ""}`);
  const stamp = `${bin}.sha256`;
  // The binary that was checked when it arrived; a damaged or replaced one is fetched again.
  if (fs.existsSync(bin) && fs.existsSync(stamp) && fs.readFileSync(stamp, "utf8").trim() === asset.sha256) {
    if (asset.tgz || (await sha256File(bin)) === asset.sha256) return bin;
  }
  fs.mkdirSync(dir, { recursive: true });
  const url = `https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/${asset.file}`;
  const res = await fetchFn(url, { redirect: "follow", signal: AbortSignal.timeout(180_000) });
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  const body = Buffer.from(await res.arrayBuffer());
  const got = createHash("sha256").update(body).digest("hex");
  if (got !== asset.sha256) throw new Error("download does not match the published cloudflared");
  const tmp = `${bin}.${process.pid}.part`;
  try {
    if (asset.tgz) {
      const archive = `${tmp}.tgz`;
      fs.writeFileSync(archive, body);
      const out = `${tmp}.d`;
      fs.mkdirSync(out, { recursive: true });
      try {
        await untar(archive, out);
        fs.renameSync(path.join(out, "cloudflared"), tmp);
      } finally {
        fs.rmSync(archive, { force: true });
        fs.rmSync(out, { recursive: true, force: true });
      }
    } else fs.writeFileSync(tmp, body);
    fs.chmodSync(tmp, 0o755);
    fs.renameSync(tmp, bin);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  fs.writeFileSync(stamp, asset.sha256);
  return bin;
}

/** The trycloudflare address in one line of cloudflared's log, if that line has it. */
export function cloudflaredLine(line: string): string | undefined {
  // Its own service (api.trycloudflare.com) shows up in error lines too: a tunnel's name always has dashes.
  return /https:\/\/[a-z0-9]+(?:-[a-z0-9]+)+\.trycloudflare\.com\b/i.exec(line)?.[0]?.toLowerCase();
}
