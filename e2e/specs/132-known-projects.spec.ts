// A project knows other projects and sits under one in the sidebar; a Flow reads from several (DECISIONS.md#d-191).
// The owner sets all of it with clicks: project settings, the sidebar's tree at every width (beside the icon rail when
// it is narrow), the Flow editor's top bar and the import screen, where a link nobody has here is linked on the spot.
// A choice that would close a loop is listed but off and says why. PROJECT_SHOTS=<folder> saves each step, light and
// dark, at five widths.
import fs from "node:fs";
import path from "node:path";
import type { Locator, Page } from "@playwright/test";
import type { Result } from "../../packages/protocol/src/index.ts";
import { expect, open, rpc, test } from "./kit.ts";

const shots = process.env.PROJECT_SHOTS;
async function shot(page: Page, name: string) {
  if (!shots) return;
  fs.mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: path.join(shots, `${name}.png`) });
}

type Graph = NonNullable<Result<"flows.graph_get">["published"]>;
const intake: Graph = {
  schemaVersion: 2,
  nodes: [
    { id: "hook", kind: "webhook", label: "New lead" },
    {
      id: "save",
      kind: "table_write",
      label: "Save the lead",
      table: "leads",
      key: "latest",
      value: { kind: "event", path: [] },
    },
  ],
  edges: [{ source: "hook", target: "save" }],
  layout: [
    { node: "hook", x: 0, y: 0 },
    { node: "save", x: 280, y: 0 },
  ],
};

type Listed = { id: string; name: string; knows?: string[]; parent?: string };
const projectOf = async (id: string) =>
  (await rpc<{ projects: Listed[] }>("projects.list", {})).projects.find((p) => p.id === id);
const create = async (name: string) => (await rpc<{ project: { id: string } }>("projects.create", { name })).project.id;
/** Brings it to the middle of what scrolls it: the settings dialog keeps its buttons over the end of its body. */
const reach = async (target: Locator) => {
  await target.evaluate((el) => el.scrollIntoView({ block: "center" }));
  return target;
};
const sideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

for (const mode of ["light", "dark"] as const) {
  for (const width of [390, 768, 960, 1200, 1440]) {
    const at = `${mode} ${width}`;
    const tag = `${mode[0]}${width}`;
    test(`a project knows others, sits under one, and a Flow reads from several (${at})`, async ({ page }) => {
      test.setTimeout(180_000);
      await page.addInitScript((mode) => localStorage.setItem("colonia.mode", mode), mode);
      await page.setViewportSize({ width, height: 900 });
      await rpc("setup.finish", {});
      const hubName = `Initech hub ${tag}`;
      const docsName = `Initech docs ${tag}`;
      const brandName = `Initech brand ${tag}`;
      const copyName = `Initech copy ${tag}`;
      const missing = `Globex archive ${tag}`;
      const hub = await create(hubName);
      const docs = await create(docsName);
      const brand = await create(brandName);
      await rpc("tables.create", { project: hub, name: "leads" });
      const made = await rpc<Result<"flows.create">>("flows.create", {
        project: hub,
        name: "Lead intake",
        graph: intake,
      });

      try {
        // Project settings: none known yet, and it says what adding one does.
        await open(page, `#project=${hub}`);
        await page.getByRole("button", { name: "Configuración del proyecto" }).click();
        const dialog = page.getByRole("dialog");
        await expect(
          dialog.getByText("Ninguno todavía. Añade uno para que los agentes de aquí puedan consultarlo."),
        ).toBeVisible();
        await reach(dialog.getByRole("combobox", { name: "Añadir proyecto" }));
        await shot(page, `${tag}-1-ajustes-vacio`);

        // Two added with the picker, one taken off again.
        for (const name of [docsName, brandName]) {
          await (await reach(dialog.getByRole("combobox", { name: "Añadir proyecto" }))).click();
          const option = page.getByRole("option", { name });
          await expect(option).toBeVisible();
          if (name === docsName) await shot(page, `${tag}-2-selector`);
          await option.click();
          await expect(dialog.locator(".projpick__row", { hasText: name })).toBeVisible();
        }
        expect((await projectOf(hub))?.knows).toEqual([docs, brand]);
        // With every other project chosen there is nothing left to add, so the button is gone.
        await reach(dialog.locator(".projpick__row", { hasText: brandName }));
        await shot(page, `${tag}-3-dos-conocidos`);
        await (await reach(dialog.getByRole("button", { name: `Quitar ${brandName}` }))).click();
        await expect(dialog.locator(".projpick__row", { hasText: brandName })).toHaveCount(0);
        expect((await projectOf(hub))?.knows).toEqual([docs]);
        expect(await sideways(page)).toBeLessThanOrEqual(0);

        // The link is one way and closes no loop: the known project cannot know this one back.
        await expect(rpc("projects.update", { project: docs, knows: [hub] })).rejects.toThrow();
        // It never reaches the prompt of a project that knows nothing.
        expect((await projectOf(brand))?.knows ?? []).toEqual([]);

        // The known project is put inside this one: only where it shows in the sidebar.
        await page.keyboard.press("Escape");
        await open(page, `#project=${docs}`);
        await page.getByRole("button", { name: "Configuración del proyecto" }).click();
        // The project that already knows this one is listed but off, and says why: choosing it would close the loop.
        await (await reach(dialog.getByRole("combobox", { name: "Añadir proyecto" }))).click();
        const loop = page.getByRole("option", { name: hubName });
        await expect(loop).toHaveAttribute("aria-disabled", "true");
        await expect(loop).toHaveAttribute(
          "title",
          `${hubName} ya conoce este proyecto. Dos proyectos no pueden conocerse en círculo.`,
        );
        await expect(page.getByRole("option", { name: brandName })).not.toHaveAttribute("aria-disabled", "true");
        await shot(page, `${tag}-3b-circulo-apagado`);
        await loop.click({ force: true });
        await page.keyboard.press("Escape");
        await expect(page.getByRole("option")).toHaveCount(0);
        await expect(dialog.locator(".projpick__row")).toHaveCount(0);
        expect((await projectOf(docs))?.knows ?? []).toEqual([]);
        expect(await sideways(page)).toBeLessThanOrEqual(0);

        await (await reach(dialog.getByRole("combobox", { name: "Dentro de" }))).click();
        await page.getByRole("option", { name: hubName }).click();
        await expect.poll(async () => (await projectOf(docs))?.parent).toBe(hub);
        await reach(dialog.getByRole("combobox", { name: "Dentro de" }));
        await shot(page, `${tag}-4-dentro-de`);
        expect((await projectOf(docs))?.knows ?? []).toEqual([]);
        await page.keyboard.press("Escape");

        // The same for where it sits: a project cannot go inside one that is already inside it.
        await open(page, `#project=${hub}`);
        await page.getByRole("button", { name: "Configuración del proyecto" }).click();
        await (await reach(dialog.getByRole("combobox", { name: "Dentro de" }))).click();
        const inside = page.getByRole("option", { name: docsName });
        await expect(inside).toHaveAttribute("aria-disabled", "true");
        await expect(inside).toHaveAttribute("title", `${docsName} ya está dentro de este proyecto.`);
        await expect(page.getByRole("option", { name: brandName })).not.toHaveAttribute("aria-disabled", "true");
        await shot(page, `${tag}-4b-padre-apagado`);
        await inside.click({ force: true });
        await page.keyboard.press("Escape");
        await expect(page.getByRole("option")).toHaveCount(0);
        expect((await projectOf(hub))?.parent).toBeUndefined();
        expect(await sideways(page)).toBeLessThanOrEqual(0);
        await page.keyboard.press("Escape");
        await expect(dialog).toHaveCount(0);

        // The sidebar, when it is wide enough to show names: the project folds what is inside it.
        if (width >= 1320) {
          await open(page, `#project=${hub}`);
          const side = page.locator(".sidebar-navrow", { hasText: docsName });
          await expect(side).toHaveClass(/is-depth-1/);
          await shot(page, `${tag}-5-arbol-abierto`);
          await page.getByRole("button", { name: `Plegar lo que hay dentro de ${hubName}` }).click();
          await expect(side).toHaveCount(0);
          await shot(page, `${tag}-6-arbol-plegado`);
          await page.getByRole("button", { name: `Mostrar lo que hay dentro de ${hubName}` }).click();
          await expect(side).toBeVisible();
        } else {
          // Narrower, the sidebar is a rail of icons: the project inside another is marked, and a button opens the
          // same tree beside it, with names, where it folds, unfolds and opens a project.
          await open(page, `#project=${hub}`);
          const tile = page.locator(`.sidebar-navrow.is-rail[data-project-id="${docs}"]`);
          await expect(tile).toHaveClass(/is-under/);
          await page.getByRole("button", { name: "Ver los proyectos en árbol" }).click();
          const tree = page.getByTestId("project-tree");
          const row = tree.locator(`.sidebar-navrow[data-project-id="${docs}"]`);
          await expect(row).toHaveClass(/is-depth-1/);
          await expect(row).toContainText(docsName);
          const box = await tree.boundingBox();
          expect(box && box.x >= 0 && box.x + box.width <= width).toBe(true);
          expect(await sideways(page)).toBeLessThanOrEqual(0);
          await shot(page, `${tag}-5-arbol-abierto`);
          await tree.getByRole("button", { name: `Plegar lo que hay dentro de ${hubName}` }).click();
          await expect(row).toHaveCount(0);
          await expect(tile).toHaveCount(0);
          await shot(page, `${tag}-6-arbol-plegado`);
          await tree.getByRole("button", { name: `Mostrar lo que hay dentro de ${hubName}` }).click();
          await expect(row).toBeVisible();
          await expect(tile).toHaveClass(/is-under/);
          await row.getByRole("button", { name: docsName, exact: true }).click();
          await expect(page).toHaveURL(new RegExp(`project=${docs}`));
          await expect(tree).toHaveCount(0);
          expect(await sideways(page)).toBeLessThanOrEqual(0);
        }

        // The Flow: its own project always, another by the owner's choice, kept at once.
        await open(page, `#view=flows&scope=${hub}&flow=${made.flow.id}&edit=1`);
        const editor = page.locator(".fe");
        await expect(editor.locator(".react-flow__node")).toHaveCount(2);
        await editor.getByRole("button", { name: "Proyectos que consulta: 1" }).click();
        const know = page.locator(".fe-know");
        await expect(know.getByText("Su proyecto", { exact: true })).toBeVisible();
        await expect(
          know.getByText("Solo su proyecto, por ahora. Añade otro para que también lo consulte."),
        ).toBeVisible();
        await shot(page, `${tag}-7-flow-solo`);
        await know.getByRole("combobox", { name: "Añadir proyecto" }).click();
        await page.getByRole("option", { name: brandName }).click();
        await expect(know.locator(".projpick__row", { hasText: brandName })).toBeVisible();
        const flowOf = async () =>
          (await rpc<Result<"flows.list">>("flows.list", { project: hub })).flows.find((f) => f.id === made.flow.id);
        await expect.poll(async () => (await flowOf())?.knowledgeProjects).toEqual([brand]);
        await shot(page, `${tag}-8-flow-dos`);
        expect(await sideways(page)).toBeLessThanOrEqual(0);
        await page.keyboard.press("Escape");
        await expect(editor.getByRole("button", { name: "Proyectos que consulta: 2" })).toBeVisible();
        await shot(page, `${tag}-9-flow-barra`);

        // Importing a project that read from two others: the one found here is linked, the other is named in plain
        // words and linked right there to a project the owner chooses.
        const sent = JSON.parse((await rpc<{ content: string }>("projects.export", { project: hub })).content);
        sent.organization = { areas: [], roles: [], ...sent.organization, knows: [docsName, missing] };
        await open(page, `#project=${hub}`);
        await page.getByRole("button", { name: "Nuevo proyecto" }).first().click();
        await page.getByRole("button", { name: "Importar proyecto" }).click();
        await page
          .getByTestId("pshare-file")
          .setInputFiles({
            name: "initech.json",
            mimeType: "application/json",
            buffer: Buffer.from(JSON.stringify(sent)),
          });
        await expect(page.getByTestId("pshare-brings")).toBeVisible();
        await dialog.getByLabel("Nombre").fill(copyName);
        await dialog.getByRole("button", { name: "Importar", exact: true }).click();
        const lost = page.getByTestId("pshare-unresolved");
        await expect(lost.getByText("Proyectos que no encuentro")).toBeVisible();
        await expect(lost.locator("li")).toHaveCount(1);
        const line = lost.locator(`li[data-unresolved="${missing}"]`);
        await expect(line).toContainText(missing);
        const copyOf = async () =>
          (await rpc<{ projects: Listed[] }>("projects.list", {})).projects.find((p) => p.name === copyName);
        expect((await copyOf())?.knows).toEqual([docs]);
        await reach(line);
        await shot(page, `${tag}-10-importar-no-encontrado`);
        await line.getByRole("combobox", { name: `Enlazar ${missing} con uno de tus proyectos` }).click();
        const taken = page.getByRole("option", { name: docsName });
        await expect(taken).toHaveAttribute("aria-disabled", "true");
        await expect(taken).toHaveAttribute("title", `${docsName} ya está enlazado.`);
        await shot(page, `${tag}-11-importar-selector`);
        await page.getByRole("option", { name: brandName }).click();
        await expect(line.getByText(`Enlazado con ${brandName}`)).toBeVisible();
        await expect.poll(async () => (await copyOf())?.knows).toEqual([docs, brand]);
        await reach(line);
        await shot(page, `${tag}-12-importar-enlazado`);
        expect(await sideways(page)).toBeLessThanOrEqual(0);
      } finally {
        const copy = (await rpc<{ projects: Listed[] }>("projects.list", {})).projects.find((p) => p.name === copyName);
        if (copy) await rpc("projects.unregister", { project: copy.id }).catch(() => {});
        for (const project of [docs, brand, hub]) await rpc("projects.unregister", { project }).catch(() => {});
      }
    });
  }
}
