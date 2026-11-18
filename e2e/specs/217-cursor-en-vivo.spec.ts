import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Locator } from "@playwright/test";
import { cursorFace } from "../../apps/desktop/scripts/cursor-face.ts";
import { BLOBS } from "../../packages/ui/src/blobs/catalog.ts";
import { expect, rpc, test } from "./kit.ts";

const widths = [390, 768, 960, 1200, 1440];
const first = { id: "uno", name: "Alba", blob: "menta" };
const second = { id: "dos", name: "Coordinación internacional de operaciones", blob: "coral" };
const image =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="800" height="500" fill="teal"/></svg>',
  );
type PointerWindow = Window & {
  drawCursor: (x: number, y: number, note: string, actor: { name: string }, blob: string) => void;
};
type Fake = Window & {
  activity?: (a: unknown) => void;
  stopped?: (stopped: boolean) => void;
  frame?: { action: number };
};

async function fits(badge: Locator, container: string) {
  await expect
    .poll(() =>
      badge.evaluate((el, selector) => {
        const limit = el.closest(selector)?.getBoundingClientRect();
        const content = document.createRange();
        content.selectNodeContents(el);
        if (!limit) return false;
        const area = [el.getBoundingClientRect(), ...content.getClientRects()];
        return (
          area.every(
            (r) =>
              r.left >= limit.left - 1 &&
              r.right <= limit.right + 1 &&
              r.top >= limit.top - 1 &&
              r.bottom <= limit.bottom + 1,
          ) && document.documentElement.scrollWidth <= innerWidth
        );
      }, container),
    )
    .toBe(true);
}

for (const lang of ["es", "en"] as const) {
  test(`el puntero del escritorio identifica al agente en los bordes · ${lang}`, async ({ page }, info) => {
    const name = lang === "es" ? second.name : "InternationalOperationsCoordinator";
    const dir = info.outputPath("cursor");
    fs.mkdirSync(path.join(dir, "cursor-faces"), { recursive: true });
    for (const file of ["cursor.html", "cursor-overlay.js", "logo-green.svg"]) {
      fs.copyFileSync(new URL("../../apps/desktop/assets/" + file, import.meta.url), path.join(dir, file));
    }
    for (const key of ["menta", "coral"] as const) {
      fs.writeFileSync(path.join(dir, "cursor-faces", key + ".svg"), cursorFace(BLOBS[key]));
    }
    await page.goto(pathToFileURL(path.join(dir, "cursor.html")).href);
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      for (const width of widths) {
        await page.setViewportSize({ width, height: 800 });
        for (const [actor, x, y] of [
          [first, 1, 1],
          [{ ...second, name }, width - 1, 799],
        ] as const) {
          await page.evaluate(
            ({ actor, x, y, lang }) =>
              (window as unknown as PointerWindow).drawCursor(
                x,
                y,
                lang === "es" ? "Revisando el documento" : "Reviewing the document",
                actor,
                actor.blob,
              ),
            { actor, x, y, lang },
          );
          await expect(page.locator("#name")).toHaveText(actor.name);
          await expect(page.locator("#face")).toHaveAttribute("src", "cursor-faces/" + actor.blob + ".svg");
          await expect
            .poll(() => page.locator("#face").evaluate((el) => (el as HTMLImageElement).naturalWidth))
            .toBeGreaterThan(0);
          await fits(page.locator("#l"), "body");
        }
      }
    }
  });
  test(`la vista en vivo identifica el clic y descarta la imagen anterior al cambiar de agente · ${lang}`, async ({
    page,
  }) => {
    test.setTimeout(90000);
    await rpc("setup.finish");
    const { id: thread } = await rpc<{ id: string }>("threads.create", { kind: "loose", agent_id: "superagent" });
    await page.addInitScript(
      ({ lang, image }) => {
        localStorage.setItem("colonia.prefs", JSON.stringify({ language: lang }));
        const w = window as Fake;
        Object.assign(window, {
          coloniaDesktop: {
            platform: "win32",
            onComputerActivity(cb: (a: unknown) => void) {
              w.activity = cb;
              return () => {
                delete w.activity;
              };
            },
            onComputerStopped(cb: (a: boolean) => void) {
              w.stopped = cb;
              return () => {
                delete w.stopped;
              };
            },
            computerFrame: async () => ({
              ...w.frame,
              data: image,
              app: "Editor",
              window: "Documento",
              bounds: { x: 0, y: 0, width: 800, height: 500 },
            }),
          },
        });
      },
      { lang, image },
    );
    await Promise.all([
      page.waitForResponse((r) => new URL(r.url()).pathname === "/rpc/threads.get" && r.ok()),
      page.goto("/#thread=" + thread),
    ]);
    await expect(page.getByRole("textbox", { name: /^Escríbele a|^Message/ })).toBeVisible();
    await expect.poll(() => page.evaluate(() => typeof (window as Fake).activity)).toBe("function");
    const send = async (actor: typeof first, action: number, x: number, y: number, frame = action) => {
      await page.evaluate(
        ({ actor, action, x, y, frame }) => {
          const w = window as Fake;
          w.frame = { action: frame };
          w.activity?.({ kind: "click", app: "Editor", window: "Documento", actor, action, x, y });
        },
        { actor, action, x, y, frame },
      );
    };
    const badge = page.locator(".screenlive__pointer-label");
    const name = lang === "es" ? second.name : "InternationalOperationsCoordinator";
    let action = 1;
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await expect(page.locator(".colonia[data-colonia-mode]").first()).toHaveAttribute(
        "data-colonia-mode",
        colorScheme,
      );
      for (const width of widths) {
        await page.setViewportSize({ width, height: 900 });
        await send(first, action++, 1, 1);
        await expect(badge).toHaveText(first.name);
        await fits(badge, ".screenlive__view");
        await send({ ...second, name }, action++, 799, 499);
        await expect(badge.locator(".colonia-blob")).toBeVisible();
        await expect(badge.locator(".colonia-blob__body")).toHaveAttribute("src", /coral/);
        await expect(badge).toHaveText(name);
        await expect(badge.locator(".screenlive__actor")).toHaveAttribute(
          "aria-label",
          (lang === "es" ? "En control: " : "In control: ") + name,
        );
        await fits(badge, ".screenlive__view");
      }
    }
    await send(first, action, 1, 1, action - 1);
    await expect(badge).toHaveCount(0);
    await expect(page.locator(".screenlive__actor")).toHaveText(first.name);
    await expect(page.locator(".screenlive__view > img")).toHaveCount(0);
    await page.evaluate(() => {
      (window as Fake).stopped?.(true);
    });
    await expect(page.locator(".screenlive__stopped")).toBeVisible();
    await expect(page.locator(".screenlive__actor")).toHaveCount(0);
    await page.evaluate(() => {
      (window as Fake).stopped?.(false);
    });
    await expect(page.locator(".screenlive")).toHaveCount(0);
  });
}
