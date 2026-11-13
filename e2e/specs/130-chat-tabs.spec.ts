// PESTANAS-CHAT-1 — chats open in tabs: a tab of its own from the row (Ctrl, middle button, its menu), and from
// there closing, switching, reordering, and finding them again after a reload.
import type { Page } from "@playwright/test";
import { expect, open, rpc, test } from "./kit.ts";

const tabs = (page: Page) => page.getByRole("tab");
const names = (page: Page) => page.locator(".chattabs__title").allTextContents();
const row = (page: Page, title: string) => page.locator(".workspace").getByRole("button", { name: title }).first();
const fitsThePage = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test("chats open in tabs, which close, switch, reorder and come back after a reload", async ({ page }, info) => {
  for (const title of ["Tab uno", "Tab dos", "Tab tres"])
    await rpc("threads.create", { kind: "loose", agent_id: "scout", title });
  await open(page, "#thread=home");
  // One chat on screen: no bar, and a plain click keeps it that way.
  await expect(page.locator(".chattabs")).toHaveCount(0);
  await row(page, "Tab tres").click();
  await expect(page.locator(".chattabs")).toHaveCount(0);
  await page.evaluate(() => {
    window.location.hash = "#thread=home";
  });

  await row(page, "Tab uno").click({ modifiers: ["ControlOrMeta"] });
  await expect(tabs(page)).toHaveCount(2);
  await row(page, "Tab dos").click({ button: "middle" });
  await expect(tabs(page)).toHaveCount(3);
  expect((await names(page)).slice(1)).toEqual(["Tab uno", "Tab dos"]);
  await expect(page.getByRole("tab", { selected: true })).toHaveText("Tab dos");
  await expect(page.getByRole("textbox", { name: "Escríbele a Scout…" })).toBeVisible();

  // Three tabs at the widths the panel is used at, light and dark: the page never scrolls sideways.
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.reload();
    for (const width of [390, 960, 1200]) {
      await page.setViewportSize({ width, height: 800 });
      await expect(tabs(page)).toHaveCount(3);
      await expect(page.getByRole("tab", { selected: true })).toBeInViewport();
      expect(await fitsThePage(page), `no sideways scroll at ${width}px (${scheme})`).toBe(true);
      await tabs(page).nth(1).click();
      await expect(page.getByRole("tab", { selected: true })).toHaveText("Tab uno");
      await tabs(page).nth(2).click();
      await expect(page.getByRole("tab", { selected: true })).toHaveText("Tab dos");
      await page.screenshot({ path: info.outputPath(`tabs-${scheme}-${width}.png`) });
    }
  }
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 1280, height: 800 });

  // A plain click goes on in the tab on screen; the row's menu gives the chat one of its own.
  await row(page, "Tab tres").click();
  expect((await names(page)).slice(1)).toEqual(["Tab uno", "Tab tres"]);
  await row(page, "Tab dos").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Abrir en pestaña nueva" }).click();
  expect((await names(page)).slice(1)).toEqual(["Tab uno", "Tab tres", "Tab dos"]);

  // Dragged onto the first of the three, the last one takes its place.
  await tabs(page).nth(3).dragTo(tabs(page).nth(1));
  expect((await names(page)).slice(1)).toEqual(["Tab dos", "Tab uno", "Tab tres"]);

  // Closing the tab on screen shows a neighbour; the middle button closes one that is not.
  await expect(page.getByRole("tab", { selected: true })).toHaveText("Tab dos");
  await page.locator(".chattabs__tab.is-active").getByRole("button", { name: "Cerrar pestaña" }).click();
  await expect(tabs(page)).toHaveCount(3);
  await expect(page.getByRole("tab", { selected: true })).toHaveText("Tab uno");
  await tabs(page).nth(2).click({ button: "middle" });
  expect((await names(page)).slice(1)).toEqual(["Tab uno"]);

  // The "+" starts a new chat in a tab of its own, and all of them are there after a reload.
  await page.getByRole("button", { name: "Pestaña nueva" }).click();
  await expect(tabs(page)).toHaveCount(3);
  await expect(page).toHaveURL(/thread=new/);
  await tabs(page).nth(1).click();
  await page.reload();
  await expect(tabs(page)).toHaveCount(3);
  await expect(page.getByRole("tab", { selected: true })).toHaveText("Tab uno");

  // Back to a single chat, the bar goes.
  await tabs(page).nth(2).click({ button: "middle" });
  await tabs(page).nth(0).click({ button: "middle" });
  await expect(page.locator(".chattabs")).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Escríbele a Scout…" })).toBeVisible();
});
