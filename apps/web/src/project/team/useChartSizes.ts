import { type RefObject, useLayoutEffect, useState } from "react";
import { NODE, type TeamLayout } from "./teamLayout.ts";

type Sizes = { heights: Map<string, number>; scaleY: number };

// Las tarjetas y los rótulos crecen con el texto y la tipografía. La medida en píxeles de diseño es independiente del zoom.
export function useChartSizes(stage: RefObject<HTMLDivElement | null>, layout: TeamLayout): Sizes {
  const [sizes, setSizes] = useState<Sizes>(() => ({ heights: new Map(), scaleY: 1 }));
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el || !layout.nodes.length) return;
    const cards = [...el.querySelectorAll<HTMLElement>("[data-agent]")];
    const labels = [...el.querySelectorAll<HTMLElement>(".teamcanvas__pill")];
    const measure = () => {
      const heights = new Map(cards.map((card) => [card.dataset.agent ?? "", card.offsetHeight]));
      const scaleY = Math.max(
        1,
        ...Array.from(heights.values(), (h) => h / NODE.h),
        ...labels.map((label) => (label.offsetHeight + 8) / NODE.gapY),
      );
      setSizes((old) =>
        old.scaleY === scaleY &&
        old.heights.size === heights.size &&
        [...heights].every(([id, h]) => old.heights.get(id) === h)
          ? old
          : { heights, scaleY },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    for (const element of [...cards, ...labels]) observer.observe(element);
    return () => observer.disconnect();
  }, [stage, layout]);
  return sizes;
}
