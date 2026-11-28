import type * as THREE from "three";
import { box, plant } from "./scene-models.ts";

/** The shared coffee counter and lounge sit beyond every room's aisle. */
export function lounge(parent: THREE.Object3D, width: number, depth: number) {
  const center = width / 2;
  box(parent, [width, 0.15, 5.7], [center, -0.1, depth + 3], 0xd4dfd9);
  box(parent, [6.8, 0.85, 0.7], [center, 0.43, depth + 3.5], 0x7e9b8b);
  box(parent, [7, 0.12, 0.95], [center, 0.91, depth + 3.5], 0xe6d6b9);
  box(parent, [0.8, 0.7, 0.55], [center, 1.3, depth + 3.5], 0x40575a);
  box(parent, [0.6, 0.12, 0.08], [center, 1.35, depth + 3.18], 0xa9cbbb);
  box(parent, [0.08, 0.25, 0.13], [center, 1.12, depth + 3.15], 0x344b4f);
  for (const x of [-2.4, -1.4, 1.4, 2.4]) {
    box(parent, [0.22, 0.25, 0.22], [center + x, 1.1, depth + 3.4], 0xfff4df);
    box(parent, [0.1, 0.12, 0.1], [center + x + 0.14, 1.12, depth + 3.4], 0xfff4df);
  }
  for (const side of [-1, 1]) {
    const x = center + side * 2.5;
    box(parent, [2, 0.42, 0.85], [x, 0.3, depth + 5], 0xc68d71);
    box(parent, [2, 0.7, 0.22], [x, 0.65, depth + 5.4], 0xc68d71);
    for (const dx of [-0.9, 0.9]) box(parent, [0.2, 0.65, 0.9], [x + dx, 0.5, depth + 5], 0xc68d71);
  }
  box(parent, [1.3, 0.12, 0.75], [center, 0.6, depth + 4.9], 0xcda979);
  box(parent, [0.12, 0.55, 0.12], [center, 0.28, depth + 4.9], 0x4d5d56);
  plant(parent, 0.6, depth + 4.8);
  plant(parent, width - 0.6, depth + 4.8);
}
