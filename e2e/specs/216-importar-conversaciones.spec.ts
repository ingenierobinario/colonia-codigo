import type { Locator, Page } from "@playwright/test";
import type { Result } from "../../packages/protocol/src/index.ts";
import { expect, open, rpc, test } from "./kit.ts";

const labels = {
  en: {
    title: "Import conversations",
    initial: "New chat",
    target: "Destination project",
    confirm: "Import selected",
    open: "Open chat",
    ready: "Preview",
    results: "Import results",
  },
  es: {
    title: "Importar conversaciones",
    initial: "Nuevo chat",
    target: "Proyecto de destino",
    confirm: "Importar selección",
    open: "Abrir chat",
    ready: "Vista previa",
    results: "Resultado de la importación",
  },
};

async function showImporter(page: Page, language: keyof typeof labels) {
  const { title, initial } = labels[language];
  await page.getByRole("combobox", { name: initial, exact: true }).first().click();
  await page.getByRole("option", { name: title }).click();
  return page.getByRole("dialog", { name: title });
}

const body = (id: string, name: string, text: string) => ({
  uuid: id,
  name,
  chat_messages: [
    { uuid: "q", sender: "human", text },
    { uuid: "a", sender: "assistant", text: "Respuesta de prueba" },
  ],
});
const title = `Acta ${"interdepartamental".repeat(6)}`;
const filename = `conversaciones-${"internacionales".repeat(6)}.json`;
// ZIP deflactado con zipfile de Python: conversations.json contiene las mismas dos conversaciones ficticias.
const zip = Buffer.from(
  "UEsDBBQAAAAIAAAAIVig2OgoxAAAAAsCAAASAAAAY29udmVyc2F0aW9ucy5qc29utZAxTwMxDIX/ipW5oEps3ViYEWIrFXokD2rpLpfGzqkC9b+j3HJlBkZ/lp/9ef8VWtMUdhI+tdwgOsJGQsbIzu6jQzQ7a2JBdYzMjuH/SF8ej/DXkWb4oIWd7NcbT71vzIm1l8c2InfkPHsHzzz7JKdGMUrlrAZhFppTklqZTF3n6TZcNrKmLsprKszUHNmvk59opdEckiilNr4hXA4/YhItdpN6/cGHxrrMDBDjwBj1pW2373fL3b9Qfaw6I01/ZnL4BlBLAQIUABQAAAAIAAAAIVig2OgoxAAAAAsCAAASAAAAAAAAAAAAAACAAQAAAABjb252ZXJzYXRpb25zLmpzb25QSwUGAAAAAAEAAQBAAAAA9AAAAAAA",
  "base64",
);
const transcript = (name: string, contents: unknown) => ({
  name,
  mimeType: "application/json",
  buffer: Buffer.from(JSON.stringify(contents)),
});

async function geometry(dialog: Locator) {
  return dialog.evaluate((el) => {
    const width = document.documentElement.clientWidth;
    const box = el.getBoundingClientRect();
    const rows = [...el.querySelectorAll(".import-chats__file")];
    const measured = [
      ...el.querySelectorAll(
        "h2,h3,p,.colonia-choice__label,.colonia-choice__desc,.colonia-select__value,.colonia-dialog__footer button",
      ),
    ];
    const clipped = measured
      .filter((node) => {
        const range = document.createRange();
        range.selectNodeContents(node);
        const bounds = node.getBoundingClientRect();
        return [...range.getClientRects()].some(
          (r) =>
            r.width > 0 &&
            (r.left < Math.max(0, bounds.left, box.left) - 1 || r.right > Math.min(width, bounds.right, box.right) + 1),
        );
      })
      .map((el) => el.className || el.tagName);
    return {
      overflow: document.documentElement.scrollWidth - width,
      clipped,
      overlap: rows.some(
        (row, i) => i > 0 && (rows[i - 1]?.getBoundingClientRect().bottom ?? 0) > row.getBoundingClientRect().top + 1,
      ),
    };
  });
}

for (const language of ["es", "en"] as const) {
  for (const mode of ["light", "dark"] as const) {
    test(`elige qué conversaciones importar y en qué proyecto · ${language} · ${mode}`, async ({ page }, info) => {
      const words = labels[language];
      await rpc("setup.finish");
      await page.addInitScript(
        ({ language, mode }) => {
          localStorage.setItem("colonia.mode", mode);
          const prefs = JSON.parse(localStorage.getItem("colonia.prefs") ?? "{}");
          localStorage.setItem("colonia.prefs", JSON.stringify({ ...prefs, language }));
        },
        { language, mode },
      );
      const { project } = await rpc<Result<"projects.create">>("projects.create", {
        name: `Archivo ${language} ${mode} ${"internacional".repeat(4)}`,
      });
      const list = async () => (await rpc<Result<"threads.list">>("threads.list", { project_id: project.id })).threads;
      try {
        await page.setViewportSize({ width: 1440, height: 900 });
        const fromProject = mode === "dark";
        await open(page, fromProject ? `#project=${project.id}` : "");
        const dialog = await showImporter(page, language);
        const choose = dialog.getByRole("combobox", { name: words.target });
        const submit = dialog.getByRole("button", { name: new RegExp(words.confirm) });
        await expect(submit).toBeDisabled();
        const id = `acta-${language}-${mode}`;
        const files = [
          mode === "dark"
            ? { name: filename.replace(".json", ".zip"), mimeType: "application/zip", buffer: zip }
            : transcript(filename, [
                body(id, title, "Texto que se revisa en este dispositivo."),
                body("descartar", "Fuera de la selección", "Privado"),
              ]),
          transcript("archivo-incompatible.json", { unknown: true }),
          ...(mode === "dark"
            ? [{ name: "resumen.md", mimeType: "text/markdown", buffer: Buffer.from("Balance de la tarea de prueba.") }]
            : []),
        ];
        const uploads: string[] = [];
        const readers: string[] = [];
        page.on("worker", (worker) => {
          if (worker.url().includes("conversation-file.worker-")) readers.push(worker.url());
        });
        page.on("request", (request) => {
          if (request.url().endsWith("/rpc/sessions.import_conversation")) uploads.push(request.postData() ?? "");
        });
        await dialog.getByTestId("chat-import-files").setInputFiles(files);
        await expect(dialog.getByRole("status")).toHaveText(words.ready);
        await expect(dialog.getByRole("alert")).toContainText(/JSON/);
        await expect(dialog.getByRole("checkbox", { name: /^Fuera de la selección/ })).not.toBeChecked();
        if (mode === "dark")
          await expect(
            dialog.getByText(language === "es" ? "Nota de Cowork" : "Cowork note", { exact: true }),
          ).toBeVisible();
        const selected = dialog.getByRole("checkbox", { name: /^Acta/ });
        await selected.check();
        if (!fromProject) {
          await expect(submit).toBeDisabled();
          await choose.click();
          await page.getByRole("option", { name: project.name, exact: true }).click();
        }
        await expect(choose).toHaveText(project.name);
        await expect(submit).toBeEnabled();
        expect(uploads).toEqual([]);
        expect((await list()).filter((th) => th.title === title)).toHaveLength(0);
        for (const width of [390, 768, 960, 1200, 1440]) {
          await page.setViewportSize({ width, height: 900 });
          await expect
            .poll(() => geometry(dialog), { message: `Geometría a ${width} px` })
            .toEqual({ overflow: 0, clipped: [], overlap: false });
          if (language === "es" && (width === 390 || width === 1440)) {
            await info.attach(`vista-previa-${width}-${mode}`, {
              body: await page.screenshot(),
              contentType: "image/png",
            });
          }
        }
        await submit.click();
        await expect(dialog.getByRole("status")).toHaveText(words.results);
        expect(uploads).toHaveLength(mode === "dark" ? 2 : 1);
        expect(uploads.join("")).not.toContain("Privado");
        expect(readers).toHaveLength(1);
        const chats = (await list()).filter((th) => th.title === title || th.title === "Fuera de la selección");
        expect(chats.map((c) => c.title)).toEqual([title]);
        const showNote = mode === "dark" && language === "en";
        const buttons = dialog.getByRole("button", { name: words.open });
        await (showNote ? buttons.last() : buttons.first()).click();
        await expect(page.getByRole("dialog", { name: words.title })).toHaveCount(0);
        const answer = page
          .locator(".transcript__row")
          .filter({ hasText: showNote ? "Balance de la tarea de prueba." : "Respuesta de prueba" });
        await expect(answer).toBeVisible();
        await expect(answer.locator(".colonia-msg__meta")).toContainText(showNote ? "Cowork · Note" : "Claude");
      } finally {
        await rpc("projects.unregister", { project: project.id });
      }
    });
  }
}
