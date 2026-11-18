// A connection drawn in the Flow editor can be taken away: clicking it marks it and shows a bin, and Delete does the
// same. A connection that would close a loop is never made.
import type { Locator, Page } from "@playwright/test";
import type { Result } from "../../packages/protocol/src/index.ts";
import { expect, open, rpc, test, until } from "./kit.ts";

/** Pulsa el trazo visible una vez que el lienzo se ha colocado tras el arrastre. */
async function pick(page: Page, link: Locator) {
  const point = await until(() =>
    link.evaluate(async (edge) => {
      const path = edge.querySelector<SVGPathElement>(".react-flow__edge-path");
      const before = path?.getScreenCTM();
      if (!path || !before || !path.getTotalLength()) return false;
      await new Promise(requestAnimationFrame);
      const after = path.getScreenCTM();
      if (!after || before.toString() !== after.toString()) return false;
      for (const fraction of [0.5, 0.25, 0.75]) {
        const { x, y } = path.getPointAtLength(path.getTotalLength() * fraction).matrixTransform(after);
        if (edge.contains(document.elementFromPoint(x, y))) return { x, y };
      }
      return false;
    }),
  );
  await page.mouse.click(point.x, point.y);
}

test("a connection is picked and removed from the canvas, and a loop is never drawn", async ({ page }) => {
  await rpc("setup.finish", {});
  const project = (await rpc<{ project: { id: string } }>("projects.create", { name: "Acme links" })).project.id;
  await page.addInitScript(() => localStorage.setItem("colonia.prefs", JSON.stringify({ language: "es" })));
  const graph: NonNullable<Result<"flows.graph_get">["draft"]> = {
    schemaVersion: 2,
    nodes: [
      { id: "webhook-1", kind: "webhook", label: "Entrada" },
      {
        id: "vars-1",
        kind: "vars",
        label: "Variables",
        vars: [{ name: "nivel", value: { kind: "literal", value: 1 } }],
      },
      {
        id: "js-1",
        kind: "js",
        label: "Código",
        code: "return 1",
        input: { kind: "event", path: [] },
        timeoutMs: 2000,
      },
    ],
    edges: [
      { source: "webhook-1", target: "vars-1" },
      { source: "vars-1", target: "js-1" },
    ],
    layout: [
      { node: "webhook-1", x: 0, y: 0 },
      { node: "vars-1", x: 310, y: 120 },
      { node: "js-1", x: 620, y: 30 },
    ],
  };
  const made = await rpc<Result<"flows.create">>("flows.create", { project, name: "Conexiones", graph });
  await open(page, `#view=flows&scope=${project}&flow=${made.flow.id}&edit=1`);
  const editor = page.locator(".fe");
  await editor.getByRole("button", { name: "Encuadrar" }).click();
  const edges = editor.locator(".react-flow__edge");
  await expect(edges).toHaveCount(2);

  // Joining the last step back to the second one would close a loop: nothing is added.
  await editor
    .locator('.react-flow__node[data-id="js-1"] .react-flow__handle.source')
    .dragTo(editor.locator('.react-flow__node[data-id="vars-1"] .react-flow__handle.target'));
  await expect(edges).toHaveCount(2);

  // A click marks the connection and shows its bin; the bin takes it away.
  const link = editor.locator('.react-flow__edge[data-id="vars-1:js-1"]');
  await pick(page, link);
  await expect(link).toHaveClass(/is-picked/);
  await editor.getByRole("button", { name: "Quitar conexión" }).click();
  await expect(edges).toHaveCount(1);
  await expect(link).toHaveCount(0);

  // Delete removes a picked one too.
  const first = editor.locator('.react-flow__edge[data-id="webhook-1:vars-1"]');
  await pick(page, first);
  await expect(first).toHaveClass(/is-picked/);
  await page.keyboard.press("Delete");
  await expect(edges).toHaveCount(0);
});
