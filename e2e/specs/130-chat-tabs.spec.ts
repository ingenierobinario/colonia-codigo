// PESTANAS-CHAT-1 — chats open in tabs: closing, switching, reordering, and finding them again after a reload.
// PESTANAS-CHAT-2 — the bar is always there and a plain click on a chat gives it a tab, as files in an editor.
import type { Page } from "@playwright/test";
import { expect, open, rpc, test } from "./kit.ts";

const tabs = (page: Page) => page.getByRole("tab");
const names = (page: Page) => page.locator(".chattabs__title").allTextContents();
const row = (page: Page, title: string) => page.locator(".workspace").getByRole("button", { name: title }).first();
const fitsThePage = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const selected = (page: Page) => page.getByRole("tab", { selected: true });

test("chats open in tabs, which close, switch, reorder and come back after a reload", async ({ page }, info) => {
  for (const title of ["Tab uno", "Tab dos", "Tab tres"])
    await rpc("threads.create", { kind: "loose", agent_id: "scout", title });
  await open(page, "#thread=home");
  // One chat on screen: the bar is there already, with its tab and the "+".
  await expect(page.locator(".chattabs")).toBeVisible();
  await expect(tabs(page)).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Abrir chat nuevo" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: /^Escríbele a/ })).toBeVisible();
  await page.screenshot({ path: info.outputPath("tabs-una.png") });

  // Plain clicks, no Ctrl: each chat gets a tab of its own, after the one on screen.
  await row(page, "Tab tres").click();
  await expect(tabs(page)).toHaveCount(2);
  await row(page, "Tab uno").click();
  await expect(tabs(page)).toHaveCount(3);
  await row(page, "Tab dos").click({ button: "middle" });
  await expect(tabs(page)).toHaveCount(4);
  expect((await names(page)).slice(1)).toEqual(["Tab tres", "Tab uno", "Tab dos"]);
  await expect(selected(page)).toHaveText("Tab dos");
  await expect(page.getByRole("textbox", { name: "Escríbele a Scout…" })).toBeVisible();

  // A chat that is open already comes forward in its tab: no second one.
  await row(page, "Tab tres").click();
  await expect(selected(page)).toHaveText("Tab tres");
  await expect(tabs(page)).toHaveCount(4);
  // Only the tab on screen and the one pointed at show their X.
  await expect(page.locator(".chattabs__tab.is-active .chattabs__close")).toHaveCSS("opacity", "1");
  await page.mouse.move(640, 600);
  await expect(page.locator(".chattabs__tab:not(.is-active) .chattabs__close").last()).toHaveCSS("opacity", "0");
  await tabs(page).nth(3).hover();
  await expect(page.locator(".chattabs__tab").nth(3).locator(".chattabs__close")).toHaveCSS("opacity", "1");

  // Four tabs at the widths the panel is used at, light and dark: the page never scrolls sideways.
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.reload();
    for (const width of [390, 960, 1200]) {
      await page.setViewportSize({ width, height: 800 });
      await expect(tabs(page)).toHaveCount(4);
      await expect(selected(page)).toBeInViewport();
      expect(await fitsThePage(page), `no sideways scroll at ${width}px (${scheme})`).toBe(true);
      await tabs(page).nth(3).click();
      await expect(selected(page)).toHaveText("Tab dos");
      await expect(selected(page)).toBeInViewport();
      await tabs(page).nth(2).click();
      await expect(selected(page)).toHaveText("Tab uno");
      await page.mouse.move(width / 2, 600);
      await page.screenshot({ path: info.outputPath(`tabs-${scheme}-${width}.png`) });
    }
  }
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 1280, height: 800 });

  // A closed tab's chat opens again from its row's menu, after the one on screen.
  await tabs(page).nth(3).click({ button: "middle" });
  await expect(tabs(page)).toHaveCount(3);
  await row(page, "Tab dos").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Abrir en pestaña nueva" }).click();
  expect((await names(page)).slice(1)).toEqual(["Tab tres", "Tab uno", "Tab dos"]);
  await expect(selected(page)).toHaveText("Tab dos");

  // Dragged onto the first of the three, the last one takes its place.
  await tabs(page).nth(3).dragTo(tabs(page).nth(1));
  expect((await names(page)).slice(1)).toEqual(["Tab dos", "Tab tres", "Tab uno"]);

  // Closing the tab on screen shows a neighbour; the middle button closes one that is not.
  await page.locator(".chattabs__tab.is-active").getByRole("button", { name: "Cerrar pestaña" }).click();
  await expect(tabs(page)).toHaveCount(3);
  await expect(selected(page)).toHaveText("Tab tres");
  await row(page, "Tab dos").click();
  await tabs(page).nth(1).click({ button: "middle" });
  expect((await names(page)).slice(1)).toEqual(["Tab dos", "Tab uno"]);
  await expect(selected(page)).toHaveText("Tab dos");

  // Ctrl+1 goes to the first tab, Ctrl+9 to the last.
  await page.keyboard.press("ControlOrMeta+1");
  await expect(tabs(page).nth(0)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ControlOrMeta+9");
  await expect(selected(page)).toHaveText("Tab uno");
  await tabs(page).nth(1).click();

  // The "+" starts a new chat in a tab of its own, and all of them are there after a reload.
  await page.getByRole("button", { name: "Abrir chat nuevo" }).click();
  await expect(tabs(page)).toHaveCount(4);
  await expect(page).toHaveURL(/thread=new/);
  await expect(selected(page)).toHaveText("Nuevo chat");
  await tabs(page).nth(3).click();
  await page.reload();
  await expect(tabs(page)).toHaveCount(4);
  await expect(selected(page)).toHaveText("Tab uno");

  // Down to one tab the bar stays, and that one comes back after a reload as well.
  await tabs(page).nth(2).click({ button: "middle" });
  await tabs(page).nth(1).click({ button: "middle" });
  await tabs(page).nth(0).click({ button: "middle" });
  await expect(tabs(page)).toHaveCount(1);
  await page.reload();
  await expect(tabs(page)).toHaveCount(1);
  await expect(selected(page)).toHaveText("Tab uno");

  // Closing the last one leaves the bar, its "+" and no chat; the next chat picked starts the tabs again.
  await page.locator(".chattabs__tab.is-active").getByRole("button", { name: "Cerrar pestaña" }).click();
  await expect(tabs(page)).toHaveCount(0);
  await expect(page.locator(".chattabs")).toBeVisible();
  await expect(page.getByText("Elige un chat")).toBeVisible();
  await page.screenshot({ path: info.outputPath("tabs-ninguna.png") });
  await row(page, "Tab dos").click();
  await expect(tabs(page)).toHaveCount(1);
  await expect(selected(page)).toHaveText("Tab dos");
  await expect(page.getByRole("textbox", { name: "Escríbele a Scout…" })).toBeVisible();
});
