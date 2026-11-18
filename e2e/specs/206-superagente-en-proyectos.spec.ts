import type { Locator } from "@playwright/test";
import type { Result } from "../../packages/protocol/src/index.ts";
import { expect, rpc, test } from "./kit.ts";

// Incluye letras, controles visibles al pasar el cursor y el límite del área desplazable.
async function geometry(row: Locator, rail: boolean) {
  await row.hover();
  await expect
    .poll(() =>
      row.evaluate((el, rail) => {
        const box = el.getBoundingClientRect();
        const avatar = el.querySelector(".colonia-tile")?.getBoundingClientRect();
        const badge = el
          .querySelector(rail ? ".sidebar-navrow__global-icon > svg" : ".sidebar-navrow__global-role")
          ?.getBoundingClientRect();
        const label = el.querySelector(".colonia-nav__label");
        const nameText = label?.firstChild;
        if (!avatar || !badge || (!rail && !nameText)) return ["faltan elementos"];
        const boxes = [avatar, badge];
        if (nameText) {
          const range = document.createRange();
          range.selectNodeContents(nameText);
          boxes.push(...range.getClientRects());
        }
        if (!rail) {
          const options = el.querySelector(".sidebar-navrow__actions")?.getBoundingClientRect();
          if (options) boxes.push(options);
        }
        const faults: string[] = [];
        for (const [i, a] of boxes.entries()) {
          if (
            a.width < 1 ||
            a.height < 1 ||
            a.left < box.left - 1 ||
            a.right > box.right + 1 ||
            a.top < box.top - 1 ||
            a.bottom > box.bottom + 1
          )
            faults.push("recorte");
          for (const b of boxes.slice(i + 1)) {
            if (a.right > b.left + 1 && b.right > a.left + 1 && a.bottom > b.top + 1 && b.bottom > a.top + 1)
              faults.push("solapamiento");
          }
        }
        const sidebar = el.closest(".sidebar__scroll, .morelist");
        if (
          (sidebar && sidebar.scrollWidth > sidebar.clientWidth + 1) ||
          document.documentElement.scrollWidth > innerWidth + 1 ||
          box.left < -1 ||
          box.right > innerWidth + 1
        )
          faults.push("desbordamiento");
        return faults;
      }, rail),
    )
    .toEqual([]);
}

for (const language of ["es", "en"] as const) {
  test(`distingue al superagente global y conserva el nombre y la imagen · ${language}`, async ({ page }) => {
    test.setTimeout(90_000);
    await rpc("setup.finish");
    const { base } = await rpc<Result<"projects.list">>("projects.list");
    const name =
      language === "es"
        ? "Dirección internacional de los proyectos y operaciones estratégicas de Colonia"
        : "InternationalProjectsAndStrategicOperationsCoordinationAcrossColonia";
    const role = language === "es" ? "Superagente global" : "Global super-agent";
    const { project: parent } = await rpc<Result<"projects.create">>("projects.create", {
      name: `Operaciones ${language}`,
    });
    const { project: child } = await rpc<Result<"projects.create">>("projects.create", {
      name: `Seguimiento ${language}`,
    });
    try {
      await rpc("projects.update", { project: child.id, parent: parent.id });
      await rpc("projects.update_base", { name, mark: { emoji: "🧭" } });
      await page.addInitScript((language) => {
        localStorage.setItem(
          "colonia.prefs",
          JSON.stringify({ language, sidebarW: 200, sidebarRows: { projects: 12 } }),
        );
      }, language);
      await Promise.all([
        page.waitForResponse((r) => new URL(r.url()).pathname === "/rpc/projects.list" && r.ok()),
        page.goto("/"),
      ]);
      const sidebar = page.locator(".sidebar");
      const row = sidebar.locator('[data-project-id="~default"]');
      const nav = row.getByRole("button", { name, exact: true });
      const treeButton = sidebar.locator(".sidebar__tree");
      const fold = page.getByRole("button", {
        name: language === "es" ? "Plegar la barra" : "Fold the sidebar",
        exact: true,
      });
      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme });
        await expect(page.locator(".colonia[data-colonia-mode]").first()).toHaveAttribute(
          "data-colonia-mode",
          colorScheme,
        );
        for (const width of [390, 768, 960, 1200, 1440]) {
          await page.setViewportSize({ width, height: 990 });
          await expect(nav).toBeVisible();
          await expect(nav).toHaveAttribute("aria-description", role);
          await expect(row.locator(".colonia-tile")).toHaveText("🧭");
          await expect(sidebar.locator(`[data-project-id="${parent.id}"] .sidebar-navrow__global-role`)).toHaveCount(0);
          if (width === 1440) {
            await expect(row.locator(".sidebar-navrow__global-role")).toHaveText(role);
            await geometry(row, false);
            await fold.click();
          }
          await expect(sidebar).toHaveClass(/is-rail/);
          await geometry(row, true);
          await nav.hover();
          const tip = page.locator(".colonia-tooltip[data-open]");
          await expect(tip).toHaveText(`${name} · ${role}`);
          await expect
            .poll(
              () =>
                tip.evaluate((el) => {
                  const rect = el.getBoundingClientRect();
                  return Math.max(0, -rect.left, rect.right - innerWidth, el.scrollWidth - el.clientWidth);
                }),
              { message: `Etiqueta del superagente a ${width} px en ${language}` },
            )
            .toBeLessThanOrEqual(1);
          await treeButton.click();
          const expanded = page.getByTestId("project-tree").locator('[data-project-id="~default"]');
          await expect(expanded.locator(".sidebar-navrow__global-role")).toHaveText(role);
          await geometry(expanded, false);
          await page.keyboard.press("Escape");
          if (width === 1440)
            await page
              .getByRole("button", {
                name: language === "es" ? "Desplegar la barra" : "Unfold the sidebar",
                exact: true,
              })
              .click();
        }
      }
      await nav.click();
      await expect(page).toHaveURL((url) => new URLSearchParams(url.hash.slice(1)).get("project") === "~default");
    } finally {
      await rpc("projects.update_base", { name: base.name, mark: base.mark ?? null });
      await rpc("projects.unregister", { project: child.id });
      await rpc("projects.unregister", { project: parent.id });
    }
  });
}
