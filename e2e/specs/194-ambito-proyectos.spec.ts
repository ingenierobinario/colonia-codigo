import type { Result } from "../../packages/protocol/src/index.ts";
import { expect, rpc, test } from "./kit.ts";

const name = "Seguimiento semanal de solicitudes internacionales con un título largo y legible";

test("el resumen carga el editor del proyecto la primera vez que se abre", async ({ page }) => {
  const { project } = await rpc<Result<"projects.create">>("projects.create", { name: "Proyecto de lectura" });
  await rpc("setup.finish");
  let editorRequests = 0;
  page.on("request", (request) => {
    if (/\/assets\/ProjectSettings-[\w-]+\.js$/.test(new URL(request.url()).pathname)) editorRequests++;
  });
  await page.goto(`/#project=${project.id}`);
  const settings = page.getByRole("button", { name: /configuración del proyecto|project settings/i });
  await expect(settings).toBeVisible();
  expect(editorRequests).toBe(0);
  await settings.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(editorRequests).toBe(1);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await settings.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(editorRequests).toBe(1);
});

for (const language of ["es", "en"] as const) {
  test(`desde el proyecto se encuentran sus skills y sus Flows en ${language}`, async ({ page }) => {
    await rpc("setup.finish");
    const { project } = await rpc<Result<"projects.create">>("projects.create", { name: `Seguimiento ${language}` });
    await rpc("flows.set", {
      id: `seguimiento-${project.id}`,
      projectId: project.id,
      name,
      enabled: false,
      predicates: [],
      tableKey: "latest",
      action: { kind: "none" },
    });
    await page.addInitScript((language) => {
      localStorage.setItem("colonia.prefs", JSON.stringify({ language }));
    }, language);
    await page.goto(`/#project=${project.id}`);
    await page.getByRole("tab", { name: /skills/i }).click();
    await expect(page.getByRole("radio", { name: /^Skills/ })).toBeChecked();
    await page.getByRole("tab", { name: /flows/i }).click();
    await page.getByRole("main").getByRole("button", { name: "Flows", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`scope=${project.id}`));
    const row = page.locator(".flowrow").filter({ hasText: name });
    await expect(row).toBeVisible();
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      for (const width of [390, 768, 960, 1200, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        const geometry = await row.evaluate((element) => {
          const title = element.querySelector<HTMLElement>(".flowrow__text strong");
          const open = element.querySelector<HTMLElement>(".flowrow__open");
          const actions = element.querySelector<HTMLElement>(".flowrow__actions");
          if (!title || !open || !actions) throw new Error("Faltan controles en la fila del Flow");
          return {
            titleFits: title.scrollWidth <= title.clientWidth + 1,
            openFits: open.scrollWidth <= open.clientWidth + 1,
            actionsFit: actions.getBoundingClientRect().right <= element.getBoundingClientRect().right + 1,
            pageFits: document.documentElement.scrollWidth <= window.innerWidth + 1,
          };
        });
        expect(geometry, `${language} ${colorScheme} ${width}`).toEqual({
          titleFits: true,
          openFits: true,
          actionsFit: true,
          pageFits: true,
        });
      }
    }
  });
}

test("los nombres y funciones del equipo se leen completos en el resumen", async ({ page }) => {
  const { project } = await rpc<Result<"projects.create">>("projects.create", { name: "Gestión internacional" });
  await rpc("setup.finish");
  await rpc("agents.create", {
    project_id: project.id,
    slug: "coordinacion",
    name: "Coordinación internacional",
    role: "Seguimiento de solicitudes y comunicación con clientes internacionales",
  });
  await page.goto(`/#project=${project.id}`);
  const pill = page.getByRole("button", { name: /Coordinación internacional.*Seguimiento de solicitudes/ });
  await expect(pill).toBeVisible();
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    for (const width of [390, 768, 960, 1200, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const geometry = await pill.evaluate((el) => {
        const overview = el.closest(".overview");
        const fields = [...el.querySelectorAll(".overview__pillname,.overview__pillrole")];
        return {
          labels: fields.length,
          readable: fields.every((field) => field.scrollWidth <= field.clientWidth + 1),
          fits: !!overview && overview.scrollWidth <= overview.clientWidth + 1 && el.scrollWidth <= el.clientWidth + 1,
        };
      });
      expect(geometry, `${colorScheme} ${width}`).toEqual({ labels: 2, readable: true, fits: true });
    }
  }
});
