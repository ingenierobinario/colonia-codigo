import { randomUUID } from "node:crypto";
import { expect, open, rpc, test } from "./kit.ts";

for (const language of ["en", "es"] as const) {
  for (const mode of ["light", "dark"] as const) {
    for (const width of [1280, 390]) {
      test(`a long agent role and project name fit beside chat controls (${language}, ${mode}, ${width})`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 800 });
        await page.addInitScript(
          ({ language, mode }) => {
            const prefs = JSON.parse(localStorage.getItem("colonia.prefs") ?? "{}");
            localStorage.setItem("colonia.prefs", JSON.stringify({ ...prefs, language }));
            localStorage.setItem("colonia.mode", mode);
          },
          { language, mode },
        );
        await rpc("setup.finish");
        const { project } = await rpc<{ project: { id: string } }>("projects.create", {
          name: "Customer research and documentation for the next product release",
        });
        const agent = await rpc<{ id: string }>("agents.create", {
          slug: `header-${randomUUID().slice(0, 8)}`,
          name: "Marina",
          role: "Customer research, documentation, and release planning across all projects",
        });
        const thread = await rpc<{ id: string }>("threads.create", {
          kind: "loose",
          project_id: project.id,
          agent_id: agent.id,
          title: "Release research",
        });
        await open(page, `#thread=${thread.id}${width > 780 ? "&panel=files" : ""}`);
        const header = page.locator(".chat__header");
        await expect(header.locator(".chat__name")).toHaveText("Marina");
        const geometry = await header.evaluate((element) => {
          const rect = (selector: string) => {
            const found = element.querySelector(selector);
            if (!found) throw new Error(`Missing ${selector}`);
            const bounds = found.getBoundingClientRect();
            return {
              left: bounds.left,
              right: bounds.right,
              width: bounds.width,
              top: bounds.top,
              bottom: bounds.bottom,
            };
          };
          return {
            name: rect(".chat__name"),
            role: rect(".chat__title .colonia-tag"),
            titles: rect(".chat__titles"),
            crumb: rect(".chat__crumbproject"),
            tools: rect(".chat__tools"),
            header: {
              right: element.getBoundingClientRect().right,
              top: element.getBoundingClientRect().top,
              bottom: element.getBoundingClientRect().bottom,
            },
          };
        });
        await page.screenshot({ path: test.info().outputPath("header.png") });
        expect(geometry.name.width).toBeGreaterThan(40);
        if (width > 780) expect(geometry.role.right).toBeLessThanOrEqual(geometry.titles.right + 1);
        expect(geometry.crumb.right).toBeLessThanOrEqual(geometry.titles.right + 1);
        expect(geometry.titles.right).toBeLessThanOrEqual(geometry.tools.left);
        expect(geometry.tools.right).toBeLessThanOrEqual(geometry.header.right);
        expect(geometry.titles.top).toBeGreaterThanOrEqual(geometry.header.top);
        expect(geometry.titles.bottom).toBeLessThanOrEqual(geometry.header.bottom);
      });
    }
  }
}
