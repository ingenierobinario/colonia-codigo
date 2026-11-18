// Ejecutar solo en el runner macOS efímero. La versión pública instala y relanza por sí misma el paquete del commit.
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import type { DesktopUpdate } from "../apps/web/src/colonia-desktop.d.ts";
import { appBinary, unzipCommand } from "./smoke-artifacts.ts";

type Health = { name: string; version: string; code_sha: string; home_id: string; started_at: string };
export function updatedCore(previous: Health, current: Health | undefined, expected: { version: string; sha: string }) {
  return (
    current?.name === "colonia-core" &&
    current.version === expected.version &&
    current.code_sha === expected.sha &&
    Boolean(previous.home_id) &&
    current.home_id === previous.home_id &&
    Date.parse(current.started_at) > Date.parse(previous.started_at)
  );
}

async function waitFor<T>(description: string, read: () => Promise<T | undefined>): Promise<T> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const result = await read();
    if (result !== undefined) return result;
    await sleep(500);
  }
  throw new Error(`Tiempo agotado esperando ${description}`);
}

async function smoke() {
  const { RUNNER_TEMP, RUNNER_ENVIRONMENT, COLONIA_VERSION, PREVIOUS_VERSION, PREVIOUS_ZIP, GITHUB_SHA } = process.env;
  assert(
    process.platform === "darwin" && process.arch === "arm64" && RUNNER_ENVIRONMENT === "github-hosted" && RUNNER_TEMP,
    "Se necesita el runner efímero macos-15",
  );
  assert(COLONIA_VERSION && PREVIOUS_VERSION && PREVIOUS_ZIP && GITHUB_SHA);
  const expected = { version: COLONIA_VERSION, sha: GITHUB_SHA.slice(0, 12) };
  const dir = fs.mkdtempSync(path.join(RUNNER_TEMP, "colonia-humo-mac-"));
  const p = { os: "mac", arch: "arm64" } as const;
  const bundle = path.join(dir, "Colonia.app");
  const feedUrl = "http://127.0.0.1:17480";
  const coreUrl = "http://127.0.0.1:17440";
  const debugUrl = "http://127.0.0.1:17443";
  const settings = {
    COLONIA_HOME: path.join(dir, "colonia"),
    COLONIA_DESKTOP_DATA: path.join(dir, "escritorio"),
    COLONIA_PORT: "17440",
    COLONIA_CONNECTION: "local",
    COLONIA_RELEASES: feedUrl,
    DO_NOT_TRACK: "1",
    COLONIA_TELEMETRY: "off",
    COLONIA_RUNTIME_SKILLS: "off",
    COLONIA_SECRETS: "file",
    COLONIA_QUIT_CONFIRM: "off",
  };
  const health = async (): Promise<Health | undefined> => {
    const response = await fetch(`${coreUrl}/health`, { signal: AbortSignal.timeout(2500) }).catch(() => undefined);
    if (response?.ok) return (await response.json()).result;
  };
  const cleanup: Array<() => unknown> = [];
  try {
    const [cmd, args] = unzipCommand(p, PREVIOUS_ZIP, dir);
    execFileSync(cmd, args);
    execFileSync("codesign", ["--verify", "--deep", "--strict", bundle]);
    const feed = spawn(process.execPath, ["scripts/install/feed.ts", "out", "--port", "17480"], {
      env: { ...process.env, COLONIA_FEED_HOST: "127.0.0.1" },
      stdio: "inherit",
      windowsHide: true,
    });
    cleanup.push(() => feed.kill());
    await waitFor("el feed temporal", async () => {
      const response = await fetch(`${feedUrl}/releases`).catch(() => undefined);
      if (
        response?.ok &&
        (await response.json()).some((r: { tag_name: string }) => r.tag_name === `v${COLONIA_VERSION}`)
      )
        return true;
    });
    // El actualizador abre la candidata con LaunchServices. Tanto el primer arranque como el relanzamiento deben usar el mismo perfil de prueba.
    for (const [key, value] of Object.entries(settings)) {
      const old = spawnSync("launchctl", ["getenv", key], { encoding: "utf8", windowsHide: true }).stdout.trimEnd();
      execFileSync("launchctl", ["setenv", key, value]);
      cleanup.push(() =>
        old ? execFileSync("launchctl", ["setenv", key, old]) : execFileSync("launchctl", ["unsetenv", key]),
      );
    }
    const old = spawn(
      path.join(dir, appBinary(p)),
      ["--remote-debugging-address=127.0.0.1", "--remote-debugging-port=17443"],
      {
        env: { ...process.env, ...settings },
        stdio: "inherit",
        windowsHide: true,
      },
    );
    cleanup.push(() => old.kill());
    const previous = await waitFor("el motor público", health);
    assert.equal(previous.name, "colonia-core");
    assert.equal(previous.version, PREVIOUS_VERSION);
    assert.equal(fs.readFileSync(path.join(settings.COLONIA_HOME, "home-id"), "utf8").trim(), previous.home_id);
    const browser = await chromium.connectOverCDP(debugUrl, { timeout: 45_000 });
    const panel = await waitFor("el panel de la aplicación pública", async () => {
      for (const page of browser.contexts().flatMap((ctx) => ctx.pages())) {
        if (new URL(page.url()).origin !== coreUrl) continue;
        if (await page.evaluate(() => window.coloniaDesktop?.updateStatus?.()).catch(() => undefined)) return page;
      }
    });
    const status: DesktopUpdate | undefined = await panel.evaluate(() => window.coloniaDesktop?.updateStatus?.(true));
    assert.equal(status?.current, PREVIOUS_VERSION);
    assert.equal(status?.latest, COLONIA_VERSION, JSON.stringify(status));
    assert.equal(status?.install, "auto");
    const stage = await panel.evaluate(() => window.coloniaDesktop?.installUpdate?.());
    assert(stage?.ok && stage.ready, JSON.stringify(stage));
    assert.equal((await panel.evaluate(() => window.coloniaDesktop?.updateStatus?.()))?.ready, COLONIA_VERSION);
    // La ventana y su contexto desaparecen durante un reinicio exitoso. Un rechazo explícito sí se propaga.
    const restart = await panel
      .evaluate(() => window.coloniaDesktop?.restartToUpdate?.())
      .catch((error: Error) => {
        if (!/closed|destroyed/i.test(error.message)) throw error;
      });
    if (restart) assert(restart.ok, JSON.stringify(restart));
    const next = await waitFor("el motor actualizado con el mismo perfil", async () => {
      const current = await health();
      return updatedCore(previous, current, expected) ? current : undefined;
    });
    assert(old.pid);
    const pid = Number(
      execFileSync("swift", ["scripts/smoke-mac-window.swift", bundle, String(old.pid)], {
        encoding: "utf8",
        timeout: 120_000,
      }).trim(),
    );
    assert(Number.isSafeInteger(pid) && pid > 1 && pid !== old.pid);
    cleanup.push(() => process.kill(pid, "SIGTERM"));
    execFileSync("codesign", ["--verify", "--deep", "--strict", bundle]);
    console.log(
      `Actualización macOS verificada: ${previous.version} → ${next.version}, commit ${next.code_sha}, mismo perfil y ventana visible (PID ${pid}).`,
    );
  } finally {
    for (const finish of cleanup.reverse()) {
      try {
        finish();
      } catch (err) {
        console.error("Limpieza del runner:", err);
      }
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await smoke();
