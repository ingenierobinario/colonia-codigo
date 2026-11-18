import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { forgetWhich, which } from "./detect.ts";
import { commandEnv } from "./env.ts";

const sources = {
  codex: { bin: "codex", url: "https://chatgpt.com/codex/install" },
  "acp:kimi": { bin: "kimi", url: "https://code.kimi.com/kimi-code/install" },
} as const;
type Id = keyof typeof sources;

async function download(id: Id) {
  const { bin, url } = sources[id];

  const win = process.platform === "win32";
  const dir = await mkdtemp(join(tmpdir(), "colonia-install-"));
  try {
    const ext = win ? ".ps1" : ".sh";
    const response = await fetch(url + ext, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error("No se pudo descargar el instalador oficial.");
    const script = join(dir, "install" + ext);
    await writeFile(script, Buffer.from(await response.arrayBuffer()));
    const args = win ? ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script] : [script];
    await promisify(execFile)(win ? "powershell.exe" : "bash", args, {
      env: { ...commandEnv(), CODEX_NON_INTERACTIVE: "true" },
      timeout: 5 * 60_000,
      windowsHide: true,
    });
    forgetWhich(bin);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function createInstaller(find = which, run = download) {
  const pending = new Map<Id, Promise<{ installed: boolean }>>();
  async function install(id: Id) {
    const { bin } = sources[id];
    if (await find(bin)) return { installed: true };
    await run(id);
    return { installed: Boolean(await find(bin)) };
  }
  return (id: Id) => {
    const running = pending.get(id);
    if (running) return running;
    const promise = install(id).finally(() => pending.delete(id));
    pending.set(id, promise);
    return promise;
  };
}
export const installEngine = createInstaller();
