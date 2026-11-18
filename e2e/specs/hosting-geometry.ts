import type { Locator } from "@playwright/test";
import { expect } from "./kit.ts";

export async function hostingGeometry(root: Locator) {
  for (const width of [390, 768, 960, 1200, 1440]) {
    await root.page().setViewportSize({ width, height: 900 });
    await expect
      .poll(
        () =>
          root.evaluate((el) => {
            const elements = Array.from(el.querySelectorAll("button, input, legend, code, summary, label")).filter(
              (e) => e.getBoundingClientRect().width,
            );
            const buttons = elements.filter((e) => e.tagName === "BUTTON").map((e) => e.getBoundingClientRect());
            const rows = Array.from(el.querySelectorAll(".folder-sync li"));
            const textFits = rows.every((row) => {
              const label = row.querySelector("label");
              const name = label?.querySelector("span");
              const input = label?.querySelector("input");
              const state = row.querySelector(".folder-sync__status");
              if (!name || !input || !state) return false;
              const text = document.createRange();
              text.selectNodeContents(name);
              const box = row.getBoundingClientRect();
              const mark = input.getBoundingClientRect();
              return (
                Array.from(text.getClientRects()).every(
                  (r) =>
                    r.left >= mark.right - 1 &&
                    r.right <= box.right + 1 &&
                    r.bottom <= state.getBoundingClientRect().top + 1,
                ) && state.scrollWidth <= state.clientWidth + 1
              );
            });
            return (
              textFits &&
              document.documentElement.scrollWidth <= innerWidth + 1 &&
              elements.every((e) => {
                const box = e.getBoundingClientRect();
                return (
                  box.left >= -1 &&
                  box.right <= innerWidth + 1 &&
                  (e.tagName !== "BUTTON" ||
                    (e.scrollHeight <= e.clientHeight + 1 && e.scrollWidth <= e.clientWidth + 1))
                );
              }) &&
              buttons.every((a, i) =>
                buttons
                  .slice(i + 1)
                  .every(
                    (b) =>
                      Math.min(a.right, b.right) - Math.max(a.left, b.left) <= 1 ||
                      Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) <= 1,
                  ),
              )
            );
          }),
        { message: `Controles utilizables a ${width} px` },
      )
      .toBe(true);
  }
}
