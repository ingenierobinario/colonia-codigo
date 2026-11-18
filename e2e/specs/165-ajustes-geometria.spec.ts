import type { Page } from "@playwright/test";
import { expect, open, openSettings, rpc, test } from "./kit.ts";

// AJUSTES-GEOMETRIA-1: cada sección de Configuración, en claro y oscuro, a los cinco anchos del owner. Se mide, no se
// mira: nada se sale de su caja ni del diálogo, ningún nombre ni desplegable queda cortado con «…», dos cajas
// hermanas no se pisan, no hay scroll horizontal, y no sale texto en inglés ni console.error al recorrerlas.

const WIDTHS = [390, 768, 960, 1200, 1440];
const SCHEMES = ["light", "dark"] as const;

// Los nombres y descripciones de modelos (.catalog__model) son datos del propio motor, no cadenas del panel.
// Palabras en inglés que delatan una cadena sin traducir (en palabra entera, sensible a mayúsculas donde importa).
const ENGLISH =
  /\b(Settings|Loading|Cancel|Save|Delete|Enabled|Disabled|Failed|not installed|not signed in|no key|could not refresh|Unknown|None|Search|Close|Add|Remove|Connect|Disconnect|Learn more|Show more|Select|Choose|Upload|Download|Password|Username|Untitled|Coming soon|Not connected|Retry)\b/;

type Defect = string;

async function measure(page: Page): Promise<Defect[]> {
  return page.evaluate((englishSrc) => {
    const english = new RegExp(englishSrc);
    const out: string[] = [];
    const dialog = document.querySelector<HTMLElement>(".colonia-dialog.config");
    if (!dialog) return ["sin diálogo"];
    const root = dialog.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth > vw + 1)
      out.push(`scroll horizontal de la página (${document.documentElement.scrollWidth} > ${vw})`);
    if (root.right > vw + 1 || root.left < -1)
      out.push(`el diálogo se sale de la ventana (${Math.round(root.left)}–${Math.round(root.right)} de ${vw})`);
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return false;
      const s = getComputedStyle(el);
      return s.visibility !== "hidden" && s.display !== "contents" && Number(s.opacity) > 0;
    };
    const label = (el: Element) => {
      const txt = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40);
      const cls = (el.getAttribute("class") || el.tagName.toLowerCase()).split(" ")[0];
      return `${cls}«${txt}»`;
    };
    // Contenedores que recortan a propósito (listas con scroll propio): lo de dentro puede quedar fuera de vista.
    const clipped = (el: Element) => {
      for (let p = el.parentElement; p && p !== dialog; p = p.parentElement) {
        const s = getComputedStyle(p);
        if (/(auto|scroll|hidden|clip)/.test(s.overflowX)) return p;
      }
      return null;
    };
    const scope = [...dialog.querySelectorAll<HTMLElement>(".config__content *, .config__pick *")].filter(
      (el) => !el.closest("svg"),
    );
    const seen = new Set<string>();
    const push = (m: string) => {
      if (!seen.has(m)) {
        seen.add(m);
        out.push(m);
      }
    };
    for (const el of scope) {
      // Un nombre aplastado a una columna de 0 px (lo que le pasaba al agente a 390).
      const z = el.getBoundingClientRect();
      if (
        z.width < 2 &&
        z.height >= 8 &&
        el.children.length === 0 &&
        (el.textContent || "").trim() &&
        getComputedStyle(el).visibility !== "hidden"
      )
        push(`texto aplastado a ${Math.round(z.width)} px: ${label(el)}`);
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      const clip = clipped(el);
      const box = clip ? clip.getBoundingClientRect() : root;
      if (!clip || !/(auto|scroll)/.test(getComputedStyle(clip).overflowX)) {
        if (r.right > box.right + 1 || r.left < box.left - 1)
          push(
            `se sale de su caja: ${label(el)} (${Math.round(r.left)}–${Math.round(r.right)} en ${Math.round(box.left)}–${Math.round(box.right)})`,
          );
      }
      // Scroll horizontal dentro de un bloque que no es una lista desplazable a propósito.
      if (
        /(auto|scroll)/.test(s.overflowX) &&
        el.scrollWidth > el.clientWidth + 1 &&
        !el.matches("pre, pre *, code, textarea, .colonia-scroll-x, [data-scroll-x]")
      )
        push(`scroll horizontal en ${label(el)} (${el.scrollWidth} > ${el.clientWidth})`);
      // Texto cortado con «…»: nombres, títulos, botones y desplegables.
      if (s.textOverflow === "ellipsis" && el.scrollWidth > el.clientWidth + 1 && !el.closest("[data-truncate-ok]"))
        push(`texto cortado: ${label(el)} (${el.scrollWidth} > ${el.clientWidth})`);
      // Botón o control encogido por debajo de su contenido (el texto se desborda o se parte letra a letra).
      const decoration = [...el.children].some((k) => getComputedStyle(k).position === "absolute");
      if (
        el.matches("button, [role=button], [role=combobox]") &&
        !decoration &&
        el.scrollWidth > el.clientWidth + 1 &&
        s.overflowX === "visible"
      )
        push(`control más estrecho que su texto: ${label(el)} (${el.scrollWidth} > ${el.clientWidth})`);
      if (el.children.length === 0 && (el.textContent || "").trim()) {
        const t = (el.textContent || "").trim();
        // Una palabra partida en varias líneas: alto de más para una sola palabra corta.
        const range = document.createRange();
        range.selectNodeContents(el);
        const lines = new Set([...range.getClientRects()].map((q) => Math.round(q.top))).size;
        if (!/\s/.test(t) && t.length <= 24 && lines > 1)
          push(`palabra partida en líneas: ${label(el)} (${Math.round(r.width)}×${Math.round(r.height)})`);
        if (
          english.test(t) &&
          !el.closest("code, pre, kbd, input, textarea, [translate=no], .colonia-mono, .catalog__model")
        )
          push(`texto en inglés: ${label(el)}`);
      }
    }
    // Hermanos que se pisan (en filas y rejillas).
    const parents = new Set<Element>();
    for (const el of scope) if (el.children.length > 1) parents.add(el);
    for (const p of parents) {
      if (!visible(p)) continue;
      const kids = [...p.children].filter(
        (k) => visible(k) && getComputedStyle(k).position !== "absolute" && getComputedStyle(k).position !== "fixed",
      );
      for (const [index, first] of kids.entries()) {
        const a = first.getBoundingClientRect();
        for (const second of kids.slice(index + 1)) {
          const b = second.getBoundingClientRect();
          const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (w > 2 && h > 2) push(`se pisan: ${label(first)} y ${label(second)} (${Math.round(w)}×${Math.round(h)})`);
        }
      }
    }
    return out;
  }, ENGLISH.source);
}

async function sectionNames(page: Page) {
  const nav = page.locator(".config__nav .config__navitem");
  await expect(nav.first()).toBeVisible();
  return (await nav.allInnerTexts()).map((t) => t.split("\n", 1)[0]?.trim() ?? "").filter(Boolean);
}

for (const scheme of SCHEMES) {
  test(`ajustes: geometría de cada sección en ${scheme}`, async ({ page }, info) => {
    test.setTimeout(300_000);
    await rpc("setup.finish");
    const errors: string[] = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 1200, height: 900 });
    await open(page);
    const settings = page.getByRole("dialog", { name: "Configuración", exact: true });
    await expect(async () => {
      if (!(await settings.isVisible())) await openSettings(page);
      await expect(settings).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 20_000 });
    const names = await sectionNames(page);
    expect(names.length).toBeGreaterThan(15);
    const defects: string[] = [];
    for (const name of names) {
      await page.setViewportSize({ width: 1200, height: 900 });
      await settings.locator(".config__nav .config__navitem", { hasText: name }).first().click();
      await page.waitForTimeout(400);
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 900 });
        await page.waitForTimeout(150);
        for (const d of await measure(page)) defects.push(`${name} · ${width} · ${scheme}: ${d}`);
      }
    }
    // La navegación propia del ancho estrecho: el desplegable de secciones lleva a cada una.
    await page.setViewportSize({ width: 390, height: 800 });
    const pick = settings.locator(".config__pick [role=combobox]");
    await expect(pick).toBeVisible();
    for (const name of names) {
      await pick.click();
      await page.getByRole("option", { name, exact: true }).click();
      await expect(pick).toContainText(name);
      for (const d of await measure(page)) defects.push(`${name} · 390-desplegable · ${scheme}: ${d}`);
    }
    await page.screenshot({ path: info.outputPath(`ajustes-${scheme}.png`) });
    for (const e of errors) defects.push(`console.error (${scheme}): ${e.slice(0, 200)}`);
    expect(defects, defects.join("\n")).toEqual([]);
  });
}
