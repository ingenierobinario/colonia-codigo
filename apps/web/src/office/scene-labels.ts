import * as THREE from "three";
import { arrangeOfficeLabels, type OfficeLabel } from "./label-layout.ts";

export function officeLabels(camera: THREE.Camera, host: HTMLElement) {
  const point = new THREE.Vector3();
  let width = 0;
  let height = 0;
  let placements: ReturnType<typeof arrangeOfficeLabels> = new Map();
  let pending: (OfficeLabel & { node: HTMLElement; active: boolean })[] = [];
  return {
    begin(nextWidth: number, nextHeight: number) {
      width = nextWidth;
      height = nextHeight;
      pending = [];
    },
    place(node: HTMLElement | null, position: THREE.Vector3) {
      if (!node) return;
      point.copy(position).project(camera);
      const visible = point.z < 1 && point.z > -1 && Math.abs(point.x) < 0.9 && point.y > -0.9 && point.y < 0.85;
      if (!visible) {
        if (node.style.visibility !== "hidden") node.style.visibility = "hidden";
        if (!node.inert) node.inert = true;
        return;
      }
      const id = node.dataset.person ? `person:${node.dataset.person}` : `room:${node.dataset.room}`;
      const active = node.matches(":hover, :focus-visible");
      const previous = active ? placements.get(id) : undefined;
      pending.push({
        id,
        node,
        active,
        x: previous ? previous.x + node.offsetWidth / 2 : ((point.x + 1) * width) / 2,
        y: previous ? previous.y + node.offsetHeight : ((1 - point.y) * height) / 2,
        width: node.offsetWidth,
        height: node.offsetHeight,
      });
    },
    paint() {
      pending.sort((a, b) => Number(b.active) - Number(a.active));
      const zoom = host.closest(".virtual-office")?.querySelector(".office-zoom")?.getBoundingClientRect();
      const origin = host.getBoundingClientRect();
      const obstacles = zoom
        ? [{ x: zoom.left - origin.left, y: zoom.top - origin.top, width: zoom.width, height: zoom.height }]
        : [];
      placements = arrangeOfficeLabels(pending, width, height, obstacles);
      for (const { id, node } of pending) {
        const rect = placements.get(id);
        const visibility = rect ? "visible" : "hidden";
        if (node.style.visibility !== visibility) node.style.visibility = visibility;
        if (node.inert === Boolean(rect)) node.inert = !rect;
        if (!rect) continue;
        const transform = `translate(${rect.x}px, ${rect.y}px)`;
        if (node.style.transform !== transform) node.style.transform = transform;
      }
    },
  };
}
