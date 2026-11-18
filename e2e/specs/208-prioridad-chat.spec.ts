import { expect, rpc, test } from "./kit.ts";

for (const [view, path, hasChat] of [
  ["chat principal", "/", true],
  ["chat rápido", "/?quick", true],
  ["recursos", "/#view=resources", false],
] as const) {
  test(`al abrir ${view}, solo el historial visible tiene prioridad sobre los sondeos secundarios`, async ({
    page,
  }) => {
    await rpc("setup.finish");
    await page.addInitScript(() => {
      const calls: string[] = [];
      Object.assign(window, { peticionesDelPanel: calls });
      const fetch = window.fetch.bind(window);
      window.fetch = (...args) => {
        const input = args[0];
        const path = new URL(input instanceof Request ? input.url : input.toString(), location.href).pathname;
        if (path.startsWith("/rpc/")) calls.push(path.slice(5));
        return fetch(...args);
      };
    });
    const background = page.waitForResponse((r) => new URL(r.url()).pathname === "/rpc/models.config");
    // La conexión puede estar lista antes que el código de la ventana rápida en un primer arranque.
    const module = /\/assets\/QuickChat-[\w-]+\.js$/;
    const quickModule = path === "/?quick" ? page.waitForResponse(module) : undefined;
    if (path === "/?quick")
      await page.route(module, async (route) => {
        const [response] = await Promise.all([route.fetch(), background]);
        await route.fulfill({ response });
      });
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await Promise.all([background, quickModule]);
    if (hasChat) await expect(page.getByRole("textbox", { name: /^Escríbele a|^Message/ })).toBeVisible();
    const calls = await page.evaluate(
      () => (window as Window & { peticionesDelPanel?: string[] }).peticionesDelPanel ?? [],
    );
    expect(calls.filter((method) => method === "threads.get")).toHaveLength(hasChat ? 1 : 0);
    for (const method of ["browser.tabs", "jobs.list", "engines.status", "models.list", "models.config"]) {
      expect(calls.indexOf(method), method).toBeGreaterThan(calls.indexOf("threads.get"));
    }
  });
}
