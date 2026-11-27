import * as THREE from "three";
import { batchStationaryParts } from "./scene-batch.ts";

export function box(
  parent: THREE.Object3D,
  size: [number, number, number],
  at: [number, number, number],
  color: number,
) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(...size),
    new THREE.MeshStandardMaterial({ color, roughness: 0.8 }),
  );
  mesh.position.set(...at);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function ball(parent: THREE.Object3D, size: [number, number, number], at: [number, number, number], color: number) {
  const small = Math.max(size[0], size[2]) < 0.25;
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(1, small ? 8 : 16, small ? 6 : 12),
    new THREE.MeshStandardMaterial({ color, roughness: 0.7 }),
  );
  mesh.scale.set(...size);
  mesh.position.set(...at);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

export function desk(parent: THREE.Object3D, x: number, z: number) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  parent.add(group);
  box(group, [2.2, 0.12, 1.1], [0, 0.95, 0], 0xcda979);
  for (const dx of [-0.9, 0.9]) for (const dz of [-0.4, 0.4]) box(group, [0.09, 0.9, 0.09], [dx, 0.45, dz], 0x4d5d56);
  box(group, [0.08, 0.3, 0.08], [0, 1.15, -0.2], 0x344b4f);
  box(group, [0.9, 0.55, 0.08], [0, 1.5, -0.2], 0x344b4f);
  box(group, [0.78, 0.43, 0.02], [0, 1.5, -0.15], 0x82c7b3);
  box(group, [0.6, 0.025, 0.22], [0, 1.03, 0.24], 0xe6ece5);
  box(group, [0.18, 0.25, 0.18], [0.8, 1.13, 0.1], 0xf5eadd);
  box(group, [0.7, 0.12, 0.7], [0, 0.48, 1], 0x6f8f7b);
  box(group, [0.7, 0.55, 0.12], [0, 0.78, 1.3], 0x6f8f7b);
  box(group, [0.12, 0.45, 0.12], [0, 0.22, 1], 0x344b4f);
}

export function plant(parent: THREE.Object3D, x: number, z: number) {
  box(parent, [0.55, 0.55, 0.55], [x, 0.28, z], 0xc28767);
  for (let i = 0; i < 5; i++) {
    const angle = i * 2.4;
    const leaf = ball(parent, [0.18, 0.6, 0.15], [x + Math.sin(angle) * 0.2, 0.9, z + Math.cos(angle) * 0.2], 0x527d5c);
    leaf.rotation.z = Math.sin(angle) * 0.5;
  }
}

export function character(avatar: string) {
  const group = new THREE.Group();
  const human = avatar.startsWith("person-");
  const animal = ["fox", "cat", "dog", "rabbit", "bear", "frog"].includes(avatar);
  const palettes = [0x4f8c79, 0x7764ac, 0x448ca4, 0xc98549, 0xc96f78];
  const seed = [...avatar].reduce((value, letter) => (value * 31 + letter.charCodeAt(0)) >>> 0, 0);
  const person = Number(avatar.replace("person-", "")) || 1;
  const skin = [0xf0c7a2, 0xd5a17b, 0x996b4d, 0x754c35][(person - 1) % 4] ?? 0xd5a17b;
  const color = animal
    ? ({ fox: 0xd98b43, cat: 0x8e969a, dog: 0xb48a62, rabbit: 0xd7c8b8, bear: 0x8a614a, frog: 0x7ba458 }[avatar] ??
      0x678b79)
    : (palettes[seed % palettes.length] ?? 0x4f8c79);
  ball(group, [0.34, 0.46, 0.29], [0, 0.65, 0], color);
  ball(group, [0.3, 0.3, 0.28], [0, 1.03, 0], human ? skin : color);
  if (!human) ball(group, [0.27, 0.35, 0.14], [0, 0.64, 0.23], 0xfff4df);
  if (human) {
    ball(group, [0.31, 0.15, 0.28], [0, 1.23, -0.03], person % 3 ? 0x493b37 : 0xb98242);
    if (person % 2 === 0) ball(group, [0.32, 0.3, 0.15], [0, 1.02, -0.2], 0x493b37);
  }
  for (const x of [-0.11, 0.11]) {
    ball(group, [0.075, 0.095, 0.05], [x, 1.08, 0.25], 0xfff9ef);
    ball(group, [0.032, 0.05, 0.027], [x, 1.08, 0.29], 0x263a3c);
    ball(group, [0.12, 0.08, 0.2], [x * 1.5, 0.18, 0.09], human ? 0x39444e : 0xe4ad56);
    if (animal && avatar !== "frog")
      ball(group, [0.11, avatar === "rabbit" ? 0.33 : 0.17, 0.1], [x * 1.8, 1.32, 0], color);
  }
  if (!human) ball(group, [0.09, 0.06, 0.12], [0, 0.94, 0.3], animal ? 0x493b37 : 0xe4ad56);
  batchStationaryParts(group);
  const arms = [-1, 1].map((side) => {
    const arm = ball(group, [0.1, 0.3, 0.13], [side * 0.34, 0.7, 0], color);
    arm.rotation.z = side * 0.25;
    return arm;
  });
  return { group, arms };
}
