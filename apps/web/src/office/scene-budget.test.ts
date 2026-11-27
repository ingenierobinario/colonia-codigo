import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { batchStationaryParts } from "./scene-batch.ts";
import { box } from "./scene-models.ts";
import { createOfficeWorld } from "./scene-world.ts";

test("a large multi-project office bounds draw submissions while retaining every agent", (t) => {
  const canvas = Object.assign(new EventTarget(), { ownerDocument: new EventTarget(), style: {} });
  const rooms = Array.from({ length: 32 }, (_, room) => ({
    id: `room-${room}`,
    agents: Array.from({ length: room < 16 ? 3 : 0 }, (_, agent) => ({
      id: `agent-${room}-${agent}`,
      blob: ["menta", "person-1", "fox"][agent] ?? "menta",
    })),
  }));
  const world = createOfficeWorld(rooms, canvas as unknown as HTMLCanvasElement);
  try {
    let submissions = 0;
    world.scene.traverse((object) => {
      if (object instanceof THREE.Mesh)
        submissions += Array.isArray(object.material) ? object.geometry.groups.length : 1;
    });
    assert.equal(world.characters.length, 48);
    assert.equal(world.roomLabels.length, 32);
    t.diagnostic(`draw submissions: ${submissions}`);
    assert.ok(submissions <= 160, `large office requires ${submissions} draw submissions`);
    for (const person of world.characters) {
      assert.equal(person.model.arms.length, 2);
      assert.ok(new THREE.Box3().setFromObject(person.model.group).getSize(new THREE.Vector3()).length() > 1);
    }
  } finally {
    world.controls.dispose();
    world.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose();
    });
  }
});

test("batching preserves transformed geometry, colors, lighting and picking", () => {
  const parent = new THREE.Group();
  parent.position.set(3, 2, -4);
  parent.rotation.y = 0.4;
  const root = new THREE.Group();
  parent.add(root);
  const first = box(root, [2, 1, 3], [0, 0, 0], 0x527d5c);
  const child = new THREE.Group();
  child.position.set(4, 1, 0);
  child.rotation.z = 0.3;
  root.add(child);
  box(child, [1, 2, 1], [0, 0, 0], 0xc28767);
  parent.updateMatrixWorld(true);
  const before = new THREE.Box3().setFromObject(root, true);
  const origin = first.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 5, 0));
  const ray = new THREE.Raycaster(origin, new THREE.Vector3(0, -1, 0));
  const distance = ray.intersectObject(root, true)[0]?.distance;
  batchStationaryParts(root);
  parent.updateMatrixWorld(true);
  const after = new THREE.Box3().setFromObject(root, true);
  assert.ok(before.min.distanceTo(after.min) < 0.00001);
  assert.ok(before.max.distanceTo(after.max) < 0.00001);
  assert.ok(Math.abs((ray.intersectObject(root, true)[0]?.distance ?? 0) - (distance ?? 0)) < 0.00001);
  const meshes: THREE.Mesh[] = [];
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) meshes.push(object);
  });
  assert.equal(meshes.length, 1);
  const mesh = meshes[0];
  assert.ok(mesh?.material instanceof THREE.MeshStandardMaterial);
  assert.equal(mesh.geometry.getAttribute("position").count, 72);
  assert.equal(mesh.material.roughness, 0.8);
  assert.equal(mesh.castShadow, true);
  assert.equal(mesh.receiveShadow, true);
  const colors = mesh.geometry.getAttribute("color");
  for (const [vertex, color] of [
    [0, 0x527d5c],
    [36, 0xc28767],
  ] as const) {
    const actual = new THREE.Color().fromBufferAttribute(colors, vertex);
    assert.ok(Math.abs(actual.r - new THREE.Color(color).r) < 0.00001);
  }
  mesh.geometry.dispose();
  mesh.material.dispose();
});
