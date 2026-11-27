import { expect, open, rpc, test } from "./kit.ts";

for (const failure of ["unavailable", "lost"] as const) {
  test(`the office keeps agents and chats available when graphics are ${failure}`, async ({ page }, info) => {
    await rpc("setup.finish", {});
    if (failure === "unavailable") {
      await page.addInitScript(() => {
        const original = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...args: unknown[]) {
          return kind === "webgl2" ? null : Reflect.apply(original, this, [kind, ...args]);
        } as typeof original;
      });
    }
    await open(page, "#view=office");
    if (failure === "lost") {
      await expect(page.locator(".office-3d canvas")).toBeVisible();
      await page.locator(".office-3d canvas").evaluate((element) => {
        const context = (element as HTMLCanvasElement).getContext("webgl2");
        const extension = context?.getExtension("WEBGL_lose_context");
        if (!extension) throw new Error("The browser must support the context-loss fixture");
        extension.loseContext();
      });
    }
    await expect(page.getByRole("button", { name: "Lista del equipo", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByRole("status")).toContainText("El 3D no está disponible ahora");
    await expect(page.locator(".office-3d canvas")).toHaveCount(0);
    await page.screenshot({ path: info.outputPath(`office-${failure}.png`), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator(".office-roster__person").first()).toBeVisible();
    await page.screenshot({ path: info.outputPath(`office-${failure}-phone.png`), fullPage: true });
    await page.locator(".office-roster__person").first().click();
    await expect(
      page.frameLocator(".office-drawer iframe").getByRole("textbox", { name: /^Escríbele a/ }),
    ).toBeVisible();
  });
}
