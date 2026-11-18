import fs from "node:fs";
import path from "node:path";
import type { Locator } from "@playwright/test";
import type { Result } from "../../packages/protocol/src/index.ts";
import { expect, open, rpc, test, world } from "./kit.ts";

async function fits(panel: Locator) {
  return panel.evaluate((box) => {
    const area = box.getBoundingClientRect();
    return (
      document.documentElement.scrollWidth <= innerWidth &&
      area.left >= 0 &&
      area.right <= innerWidth + 1 &&
      [...box.querySelectorAll("h3, button, li, label, p, span, legend")].every((el) => {
        const rect = el.getBoundingClientRect();
        return (
          rect.left >= area.left - 1 &&
          rect.right <= area.right + 1 &&
          el.scrollWidth <= el.clientWidth + 1 &&
          el.scrollHeight <= el.clientHeight + 1
        );
      })
    );
  });
}

// Una lista poblada permite comprobar tanto una fila visible como un proyecto dentro de «N más».
const otherProjects: string[] = [];
test.beforeAll(async () => {
  for (let index = 0; index < 5; index++) {
    const { project } = await rpc<Result<"projects.create">>("projects.create", {
      name: `Carpeta de muestra ${index + 1}`,
    });
    otherProjects.push(project.id);
  }
});
test.afterAll(async () => {
  for (const project of otherProjects) await rpc("projects.unregister", { project });
});

for (const lang of ["es", "en"] as const) {
  for (const mode of ["light", "dark"] as const) {
    test(`archivos elegidos antes de guardar, publicar e importar · ${lang} · ${mode}`, async ({ page }) => {
      test.setTimeout(90_000);
      const es = lang === "es";
      await rpc("setup.finish");
      const name = `Paquete ${lang} ${mode}`;
      const { project } = await rpc<Result<"projects.create">>("projects.create", { name });
      const projectOrder = mode === "light" ? [project.id, ...otherProjects] : [...otherProjects, project.id];
      await page.addInitScript(
        ({ lang, mode, projectOrder }) => {
          localStorage.setItem(
            "colonia.prefs",
            JSON.stringify({ language: lang, projectOrder, sidebarRows: { projects: 5 } }),
          );
          localStorage.setItem("colonia.mode", mode);
        },
        { lang, mode, projectOrder },
      );
      await page.emulateMedia({ colorScheme: mode });
      const rel = `planos/planificación-${"abc".repeat(22)}.txt`;
      const payload = Buffer.from("Documento de prueba\r\n");
      const root = project.path;
      if (!root) throw new Error("Falta la carpeta temporal del proyecto");
      fs.mkdirSync(path.join(root, "planos"));
      // Los sistemas de archivos pueden devolver el acento como un carácter o como dos.
      const diskPath = mode === "dark" ? rel.normalize("NFD") : rel;
      fs.writeFileSync(path.join(root, diskPath), payload);
      fs.writeFileSync(path.join(root, "ajeno.txt"), "sin elegir");
      let copy: string | undefined;
      try {
        await open(page, `#project=${project.id}`);
        const row = page.getByRole("group", { name, exact: true });
        if (mode === "dark") {
          await page.getByRole("button", { name: es ? /^\d+ más$/ : /^\d+ more$/ }).click();
        }
        await row.click({ button: "right" });
        await page.getByRole("menuitem", { name: es ? "Compartir proyecto" : "Share project" }).click();
        const dialog = page.getByRole("dialog");
        const picker = dialog.getByTestId("share-work-files");
        const title = picker.getByRole("heading");
        await expect(title).toContainText("0");
        await picker
          .getByRole("button", { name: es ? "Elegir archivos del proyecto" : "Choose project files" })
          .click();
        await picker.getByRole("button", { name: "planos" }).click();
        await picker.getByRole("checkbox").check();
        await expect(title).toContainText("1");
        const chosen = picker.getByRole("listitem");
        await expect.poll(async () => (await chosen.innerText()).normalize("NFC")).toBe(rel);
        await picker.getByRole("checkbox").uncheck();
        await expect(title).toContainText("0");
        await picker.getByRole("checkbox").check();
        for (const width of [390, 768, 960, 1200, 1440]) {
          await page.setViewportSize({ width, height: 900 });
          await expect.poll(() => fits(picker), { message: `selector · ${width}` }).toBe(true);
        }
        const downloaded = page.waitForEvent("download");
        await dialog.getByRole("button", { name: es ? "Guardar en un fichero" : "Save to a file" }).click();
        const file = await (await downloaded).path();
        if (!file) throw new Error("Falta el archivo descargado");
        const saved = fs.readFileSync(file);
        const files = JSON.parse(saved.toString("utf8")).organization.files;
        expect(files).toEqual([{ path: rel, data: payload.toString("base64") }]);
        await page.route("**/rpc/webhooks.get", (route) =>
          route.fulfill({
            json: {
              ok: true,
              result: {
                mode: "custom",
                url: "https://colonia.example.invalid",
                url_may_change: false,
                port: 0,
                tailscale: { installed: false, connected: false },
                ngrok: { installed: false },
              },
            },
          }),
        );
        const publish = es ? "Publicar" : "Publish";
        await dialog.getByRole("radio", { name: publish, exact: true }).click();
        const response = page.waitForResponse((r) => r.url().endsWith("/rpc/projects.share"));
        await dialog.getByRole("button", { name: publish, exact: true }).click();
        const { result } = await (await response).json();
        const token = String(result.path).match(/^\/p\/([a-f0-9]{32})$/)?.[1];
        if (!token) throw new Error("Falta el identificador de la copia publicada");
        const fixture = await world.info();
        const published = JSON.parse(
          fs.readFileSync(path.join(fixture.home, "shared-projects", `${token}.json`), "utf8"),
        );
        expect(published.organization.files).toEqual(files);
        await expect(dialog.getByTestId("work-files-published").getByRole("listitem")).toHaveText(rel);
        await page.keyboard.press("Escape");
        await page
          .getByRole("button", { name: es ? "Nuevo proyecto" : "New project" })
          .first()
          .click();
        await page.getByRole("button", { name: es ? "Importar proyecto" : "Import project" }).click();
        await page
          .getByTestId("pshare-file")
          .setInputFiles({ name: "proyecto.json", mimeType: "application/json", buffer: saved });
        const included = page.getByTestId("work-files-included");
        await expect(included.getByRole("listitem")).toHaveText(rel);
        for (const width of [390, 768, 960, 1200, 1440]) {
          await page.setViewportSize({ width, height: 900 });
          await expect.poll(() => fits(included), { message: `importación · ${width}` }).toBe(true);
        }
        await dialog.getByLabel(es ? "Nombre" : "Name", { exact: true }).fill(`${name} copia`);
        const applied = page.waitForResponse((r) => r.url().endsWith("/rpc/projects.import"));
        await dialog.getByRole("button", { name: es ? "Importar" : "Import", exact: true }).click();
        const imported = (await (await applied).json()).result.project;
        copy = imported.id;
        expect(fs.readFileSync(path.join(imported.path, rel))).toEqual(payload);
        expect(fs.existsSync(path.join(imported.path, "ajeno.txt"))).toBe(false);
      } finally {
        if (copy) await rpc("projects.unregister", { project: copy });
        await rpc("projects.share", { project: project.id, shared: false });
        await rpc("projects.unregister", { project: project.id });
      }
    });
  }
}
