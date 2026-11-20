import type { Frame, Page } from "@playwright/test";
import { expect, open, rpc, test } from "./kit.ts";

// APPS-RENOMBRAR-1 / APPS-REFRESCAR-1: una aplicación interna se renombra desde la barra lateral y se refresca
// desde su cabecera, sin perder lo que recuerda.
const html = `<script src="/_colonia/kit@1.js"></script>
<main class="ax-page"><output id="run"></output><output id="kept">loading</output></main>
<script>
document.getElementById("run").textContent = String(Math.random());
Colonia.store.get("kept").then(async (v) => {
  if (!v) await Colonia.store.set("kept", "sí");
  document.getElementById("kept").textContent = v ?? "nuevo";
});
</script>`;

const frames = (p: Page): Frame[] => p.frames().filter((f) => f.url().startsWith("about:srcdoc"));
const text = (p: Page, id: string) => frames(p)[0]?.evaluate((i) => document.getElementById(i)?.textContent, id);

test("una app interna se renombra desde la barra lateral y la cabecera lo refleja", async ({ page: p }) => {
  await p.setViewportSize({ width: 1600, height: 900 });
  await rpc("setup.finish", {});
  const app = await rpc<{ id: string }>("surfaces.show", { name: "radar-tech", title: "Radar tech", html, app: true });
  await open(p, `#app=${app.id}`);
  await expect(p.locator(".appscreen__title")).toHaveText("Radar tech");

  const row = p.locator(".sidebar").getByRole("button", { name: "Radar tech" });
  await row.click({ button: "right" });
  await p.getByRole("menuitem", { name: "Cambiar nombre…" }).click();
  const input = p.getByRole("textbox", { name: "Nombre de la aplicación" });
  await input.fill("Radar de tecnología");
  await p.getByRole("button", { name: "Guardar" }).click();
  await expect(p.locator(".appscreen__title")).toHaveText("Radar de tecnología");
  await expect(p.locator(".sidebar").getByRole("button", { name: "Radar de tecnología" })).toBeVisible();

  // Doble clic también abre el cambio de nombre.
  await p.locator(".sidebar").getByRole("button", { name: "Radar de tecnología" }).dblclick();
  await p.getByRole("textbox", { name: "Nombre de la aplicación" }).fill("Radar");
  await p.keyboard.press("Enter");
  await expect(p.locator(".appscreen__title")).toHaveText("Radar");

  // Persistido en core.
  const got = await rpc<{ title: string; name: string }>("surfaces.get", { surface: app.id });
  expect(got).toMatchObject({ title: "Radar", name: "radar-tech" });
  await p.reload();
  await expect(p.locator(".appscreen__title")).toHaveText("Radar");
});

test("Refrescar vuelve a ejecutar el artefacto sin perder lo que recuerda", async ({ page: p }) => {
  await rpc("setup.finish", {});
  const app = await rpc<{ id: string }>("surfaces.show", { name: "monitor", title: "Monitor", html, app: true });
  await open(p, `#app=${app.id}`);
  await expect.poll(() => text(p, "kept")).toBe("nuevo");
  const first = await text(p, "run");
  await frames(p)[0]?.evaluate(() => {
    (window as unknown as { mark: string }).mark = "antes";
  });

  const refresh = p.locator(".appscreen__head").getByRole("button", { name: "Refrescar" });
  await refresh.click();
  await expect.poll(() => text(p, "kept")).toBe("sí");
  expect(await text(p, "run")).not.toBe(first);
  expect(await frames(p)[0]?.evaluate(() => (window as unknown as { mark?: string }).mark)).toBeUndefined();
  expect(frames(p)).toHaveLength(1);
});
