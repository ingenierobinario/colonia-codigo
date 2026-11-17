import type { Result } from "../../packages/protocol/src/index.ts";
import { expect, rpc, test } from "./kit.ts";

for (const language of ["es", "en"] as const) {
  test(`el organigrama muestra el área y el rol sin cambiar la supervisión · ${language}`, async ({ page }) => {
    await rpc("setup.finish");
    const { project } = await rpc<Result<"projects.create">>("projects.create", {
      name: `Organigrama ${language}`,
      kind: "company",
    });
    const area = "Planificación internacional y control de operaciones";
    const role = "Coordinación de expedientes y auditoría de operaciones internacionales";
    await rpc("org.set", {
      project: project.id,
      organization: {
        areas: [{ slug: "operaciones", name: area }],
        roles: [{ slug: "coordinacion", name: role, area: "operaciones" }],
      },
    });
    const lead = await rpc<Result<"agents.create">>("agents.create", {
      project_id: project.id,
      slug: "direccion",
      name: "Dirección",
      orchestrator: true,
      area: "operaciones",
      role,
    });
    const member = await rpc<Result<"agents.create">>("agents.create", {
      project_id: project.id,
      slug: "asistente",
      name: "Asistente",
      parent: "direccion",
    });
    await rpc("agents.create", {
      project_id: project.id,
      slug: "analista",
      name: "Analista",
      parent: "direccion",
      area: "operaciones",
      role: "Análisis",
    });
    await page.addInitScript(
      (language) => localStorage.setItem("colonia.prefs", JSON.stringify({ language, sidebarCollapsed: true })),
      language,
    );
    let orgRequests = 0;
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/rpc/org.get") orgRequests++;
    });
    await Promise.all([
      page.waitForResponse((response) => new URL(response.url()).pathname === "/rpc/org.get" && response.ok()),
      page.goto(`/#project=${project.id}&tab=team`),
    ]);
    const nodes = page.locator(".teamcanvas__node");
    const leadNode = nodes.filter({ hasText: "Dirección" });
    const memberNode = nodes.filter({ hasText: "Asistente" });
    await expect(leadNode.locator("dl dd")).toHaveText([area, role]);
    expect(orgRequests, "Una consulta de áreas y roles al abrir el organigrama").toBe(1);
    await expect(memberNode.locator("dl dd")).toHaveText(
      language === "es" ? ["Sin área", "Sin rol"] : ["No area", "No role"],
    );
    await expect(page.locator(`.teamcanvas__edge[data-parent="${lead.id}"][data-child="${member.id}"]`)).toHaveCount(1);
    await expect(page.locator(".teamcanvas__pill").filter({ hasText: area })).toBeVisible();
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      for (const width of [390, 768, 960, 1200, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        // El observador del lienzo recibe el nuevo ancho después de los callbacks de animación.
        // Comprobamos la geometría que se dibuja cuando se aplica el ajuste al ancho disponible.
        await expect
          .poll(
            () =>
              nodes.evaluateAll((cards) => {
                const elements = [...cards, ...document.querySelectorAll(".teamcanvas__pill")];
                const boxes = elements.map((item) => ({
                  name: item.getAttribute("data-agent") ?? item.textContent,
                  rect: item.getBoundingClientRect(),
                }));
                const fields = cards.flatMap((card) => [
                  ...card.querySelectorAll<HTMLElement>("dd, dt, .colonia-agentnode__name"),
                ]);
                const scroller = document.querySelector<HTMLElement>(".teamcanvas__scroll");
                const stage = document.querySelector<HTMLElement>(".teamcanvas__stage");
                if (!scroller || !stage) return { missing: "lienzo" };
                return {
                  cards: cards.length,
                  widthError: Math.round(
                    Math.abs(stage.getBoundingClientRect().width - Math.min(stage.offsetWidth, scroller.clientWidth)),
                  ),
                  scrollOverflow: Math.max(0, scroller.scrollWidth - scroller.clientWidth),
                  clippedFields: fields
                    .filter(
                      (field) =>
                        field.scrollWidth > field.clientWidth + 1 || field.scrollHeight > field.clientHeight + 1,
                    )
                    .map((field) => field.textContent),
                  overlaps: boxes.flatMap(({ name, rect: a }, i) =>
                    boxes
                      .slice(i + 1)
                      .filter(
                        ({ rect: b }) =>
                          a.right > b.left + 1 && b.right > a.left + 1 && a.bottom > b.top + 1 && b.bottom > a.top + 1,
                      )
                      .map((b) => [name, b.name]),
                  ),
                  offscreen: boxes
                    .filter(({ rect }) => rect.left < -1 || rect.right > innerWidth + 1)
                    .map(({ name, rect }) => ({ name, left: rect.left, right: rect.right })),
                  pageOverflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
                };
              }),
            { message: `${language} · ${width} · ${colorScheme}` },
          )
          .toEqual({
            cards: 3,
            widthError: 0,
            scrollOverflow: 0,
            clippedFields: [],
            overlaps: [],
            offscreen: [],
            pageOverflow: 0,
          });
      }
    }
  });
}
