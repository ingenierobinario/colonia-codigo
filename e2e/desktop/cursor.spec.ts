import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { _electron, expect, test } from "@playwright/test";
import type { AgentCursor } from "../../apps/desktop/src/main/cursor.ts";

const root = path.resolve(import.meta.dirname, "../..");
const desktop = path.join(root, "apps/desktop");
type Main = typeof globalThis & { cursorDePrueba: Promise<AgentCursor> };
type PrimerDibujo = { x: number; y: number; animado: boolean };
type Vista = typeof globalThis & { primerDibujo?: PrimerDibujo };

test("el BrowserWindow real muestra la cara y el nombre junto a la punta y se oculta al desconectar", async () => {
  const info = test.info();
  const dir = info.outputPath("cursor");
  const home = path.join(dir, "usuario");
  fs.mkdirSync(home, { recursive: true });
  for (const file of ["cursor.html", "cursor-overlay.js", "logo-green.svg", "cursor-faces"]) {
    fs.cpSync(path.join(desktop, "dist", file), path.join(dir, file), { recursive: true });
  }
  // Se carga el mismo controlador que en la aplicación, sin instalar un puente de pruebas en el escritorio.
  const { build } = createRequire(path.join(desktop, "package.json"))("esbuild");
  const module = path.join(dir, "cursor.mjs");
  await build({
    entryPoints: [path.join(desktop, "src/main/cursor.ts")],
    outfile: module,
    platform: "node",
    format: "esm",
    bundle: true,
    external: ["electron"],
  });
  const entry = path.join(dir, "prueba.cjs");
  fs.writeFileSync(
    entry,
    `const { app } = require("electron");
    app.setPath("userData", ${JSON.stringify(home)});
    globalThis.cursorDePrueba = app.whenReady().then(async () => (await import(${JSON.stringify(pathToFileURL(module).href)})).createCursor());`,
  );
  const instance = await _electron.launch({
    args: [entry, ...(process.getuid?.() === 0 ? ["--no-sandbox"] : [])],
    ...(process.env.E2E_ELECTRON ? { executablePath: process.env.E2E_ELECTRON } : {}),
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      XDG_CONFIG_HOME: home,
      COLONIA_HOME: path.join(home, "colonia"),
    },
  });
  try {
    await instance.context().addInitScript(() => {
      new MutationObserver((changes) => {
        const cursor = document.getElementById("c");
        if (!cursor || !changes.some((m) => m.target === cursor && m.attributeName === "style")) return;
        const tip = cursor.getBoundingClientRect();
        (window as Vista).primerDibujo = {
          x: tip.x + 5,
          y: tip.y + 4,
          animado: cursor
            .getAnimations()
            .some((a) => a instanceof CSSTransition && a.transitionProperty === "transform"),
        };
      }).observe(document, { subtree: true, attributes: true, attributeFilter: ["style"] });
    });
    for (const [name, blob, edge, recorrido] of [
      ["Alba", "menta", false, "primero"],
      ["Alba", "menta", true, "movimiento"],
      ["Sol", "coral", false, "relevo"],
      ["Sol", "coral", true, "reaparición"],
    ] as const) {
      if (recorrido === "reaparición")
        await instance.evaluate(async () => (await (globalThis as Main).cursorDePrueba).hide());
      const point = await instance.evaluate(
        async ({ BrowserWindow, screen }, { name, blob, edge }) => {
          const cursor = await (globalThis as Main).cursorDePrueba;
          const b = screen.getPrimaryDisplay().bounds;
          const x = b.x + (edge ? b.width - 2 : 2);
          const y = b.y + (edge ? b.height - 2 : 2);
          const physicalBefore = screen.getCursorScreenPoint();
          await cursor.moveTo(x, y, "Documento de prueba", { id: name, name, blob });
          const win = BrowserWindow.getAllWindows().find((window) => window.isVisible());
          if (!win) throw new Error("Falta la ventana visible del puntero");
          return {
            x,
            y,
            display: b,
            content: win.getContentBounds(),
            physicalBefore,
            physicalAfter: screen.getCursorScreenPoint(),
          };
        },
        { name, blob, edge },
      );
      const view = await instance.firstWindow();
      await expect(view.locator("#name")).toHaveText(name);
      await expect(view.locator("#face")).toHaveAttribute("src", `cursor-faces/${blob}.svg`);
      await expect
        .poll(() => view.locator("#face").evaluate((img) => (img as HTMLImageElement).naturalWidth))
        .toBeGreaterThan(0);
      const size = await view.evaluate(async () => {
        const cursor = document.getElementById("c");
        if (!cursor) throw new Error("Falta el puntero");
        // El compositor puede iniciar la transición después de que Electron muestre la ventana.
        await new Promise(requestAnimationFrame);
        await Promise.all(cursor.getAnimations().map((animation) => animation.finished));
        const label = document.getElementById("l")?.getBoundingClientRect();
        const tip = cursor.getBoundingClientRect();
        if (!label) throw new Error("Falta la etiqueta en la ventana real");
        return {
          x: screenX + tip.x + 5,
          y: screenY + tip.y + 4,
          localX: tip.x + 5,
          localY: tip.y + 4,
          left: label.left,
          right: label.right,
          top: label.top,
          bottom: label.bottom,
          width: innerWidth,
          height: innerHeight,
          scroll: document.documentElement.scrollWidth,
          primerDibujo: (window as Vista).primerDibujo,
          movimientoReducido: matchMedia("(prefers-reduced-motion: reduce)").matches,
        };
      });
      await info.attach(`medidas-${recorrido}`, {
        body: JSON.stringify({ ...size, point }),
        contentType: "application/json",
      });
      const primerDibujo = size.primerDibujo;
      if (!primerDibujo) throw new Error("Falta la medida del primer fotograma del puntero");
      expect(primerDibujo.animado).toBe(recorrido === "movimiento" && !size.movimientoReducido);
      if (recorrido !== "movimiento") {
        expect(Math.abs(point.content.x + primerDibujo.x - point.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(point.content.y + primerDibujo.y - point.y)).toBeLessThanOrEqual(1);
      }
      expect(Math.abs(point.content.x + size.localX - point.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(point.content.y + size.localY - point.y)).toBeLessThanOrEqual(1);
      expect(size.localX).toBeGreaterThanOrEqual(0);
      expect(size.localY).toBeGreaterThanOrEqual(0);
      expect(size.localX).toBeLessThan(size.width);
      expect(size.localY).toBeLessThan(size.height);
      expect(Math.abs(size.x - point.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(size.y - point.y)).toBeLessThanOrEqual(1);
      expect(size.left).toBeGreaterThanOrEqual(0);
      expect(size.top).toBeGreaterThanOrEqual(0);
      expect(size.right).toBeLessThanOrEqual(size.width);
      expect(size.bottom).toBeLessThanOrEqual(size.height);
      expect(size.scroll).toBe(size.width);
    }
    expect(
      await instance.evaluate(async ({ BrowserWindow }) => {
        (await (globalThis as Main).cursorDePrueba).hide();
        return BrowserWindow.getAllWindows().some((win) => win.isVisible());
      }),
    ).toBe(false);
  } finally {
    await instance.close();
  }
});
