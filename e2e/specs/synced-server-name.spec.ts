import { expect, rpc, test } from "./kit.ts";

for (const language of ["en", "es"] as const) {
  test(`rename a synchronized server in ${language}`, async ({ page }, info) => {
    await rpc("setup.finish");
    await page.addInitScript((language) => {
      localStorage.setItem("colonia.prefs", JSON.stringify({ language }));
    }, language);
    let alias = "";
    let fail = true;
    const writes: unknown[] = [];
    const status = () => ({
      paired: true,
      reachable: true,
      connected: true,
      mismatch: false,
      pending: 0,
      saved: 0,
      role: "secundario",
      every_min: 5,
      peer: {
        id: "paired-server",
        name: alias || "container-host",
        hostname: "container-host",
        alias: alias || undefined,
        kind: "servidor",
        platform: "linux",
        version: "2.36.76",
      },
    });
    await page.route("**/rpc/sync.status", (route) => route.fulfill({ json: { ok: true, result: status() } }));
    await page.route("**/rpc/equipos.discover", (route) =>
      route.fulfill({ json: { ok: true, result: { equipos: [], tailscale: false } } }),
    );
    await page.route("**/rpc/sync.rename_peer", (route) => {
      const params = route.request().postDataJSON();
      writes.push(params);
      if (fail) return route.fulfill({ json: { ok: false, error: { code: "bad_request", message: "Save failed" } } });
      alias = params.alias;
      return route.fulfill({ json: { ok: true, result: status() } });
    });
    await page.goto("/#view=equipos");
    const card = page.locator(".eq-synced");
    const edit = card.locator(".eq-title__edit");
    const capture = async (state: string) => {
      for (const width of [1200, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await card.scrollIntoViewIfNeeded();
        await page.screenshot({ path: info.outputPath(`server-name-${language}-${state}-${width}.png`) });
      }
    };
    await edit.click();
    await card.getByRole("textbox").fill("Canceled name");
    await page.keyboard.press("Escape");
    expect(writes).toEqual([]);
    await expect(card.locator(".eq-title__name")).toHaveText("container-host");
    await edit.click();
    await card.getByRole("textbox").fill("Acme server");
    await card.getByRole("textbox").press("Enter");
    await expect(card.locator(".eq-rename__error")).toBeVisible();
    await expect(card.getByRole("textbox")).toHaveValue("Acme server");
    await capture("error");
    fail = false;
    await card.getByRole("textbox").press("Enter");
    await expect(card.locator(".eq-title__name")).toHaveText("Acme server");
    expect(writes.at(-1)).toEqual({ id: "paired-server", alias: "Acme server" });
    await page.reload();
    await expect(card.locator(".eq-title__name")).toHaveText("Acme server");
    await expect(page.locator(".sidebar").getByRole("button", { name: "Acme server", exact: true })).toBeVisible();
    await page.locator(".sidebar").getByRole("button", { name: "Acme server", exact: true }).click({ button: "right" });
    await page.getByRole("menuitem", { name: language === "es" ? /nombre/ : /name/i }).click();
    await expect(card.getByRole("textbox")).toHaveValue("Acme server");
    for (const width of [1200, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await card.scrollIntoViewIfNeeded();
      expect(
        await card.evaluate((el) =>
          [...el.querySelectorAll("input:not([type=radio]), button")].every((child) => {
            const r = child.getBoundingClientRect();
            return r.left >= 0 && r.right <= innerWidth + 1;
          }),
        ),
      ).toBe(true);
      await page.screenshot({ path: info.outputPath(`server-name-${language}-${width}.png`) });
    }
    await card.getByRole("textbox").fill("");
    await capture("empty");
    await card.getByRole("textbox").press("Enter");
    await expect(card.locator(".eq-title__name")).toHaveText("container-host");
  });
}
