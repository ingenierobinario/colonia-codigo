import { expect, rpc, test } from "./kit.ts";

test("al abrir el panel, la conexión se inicia antes que las listas laterales y comparte la consulta de estado", async ({
  page,
}) => {
  await rpc("setup.finish");
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    const calls: string[] = [];
    Object.assign(window, { llamadasInicio: calls });
    window.fetch = (...args) => {
      const input = args[0];
      const path = new URL(input instanceof Request ? input.url : input.toString(), location.href).pathname;
      if (path.startsWith("/rpc/")) calls.push(path.slice(5));
      return original(...args);
    };
  });
  const updates = page.waitForResponse((r) => new URL(r.url()).pathname === "/rpc/system.updates");
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await updates;
  await expect(page.getByRole("textbox", { name: /^Escríbele a|^Message/ })).toBeVisible();
  const calls = await page.evaluate(() => (window as Window & { llamadasInicio?: string[] }).llamadasInicio ?? []);
  expect(calls.indexOf("system.ping")).toBeGreaterThanOrEqual(0);
  const health = calls.indexOf("system.health");
  expect(health).toBeGreaterThan(calls.indexOf("system.ping"));
  for (const method of ["equipos.list", "system.news", "owner.get"])
    expect(calls.indexOf(method)).toBeGreaterThan(health);
  expect(calls.filter((method) => method === "system.health")).toHaveLength(1);
});
