import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { disposeOfficeModels, updateOfficeAvatars } from "./scene-avatars.ts";
import { createOfficeWorld } from "./scene-world.ts";

test("editing one avatar preserves the office and releases only that character's old graphics", () => {
  const canvas = Object.assign(new EventTarget(), { ownerDocument: new EventTarget(), style: {} });
  const world = createOfficeWorld(
    [
      {
        id: "room",
        agents: [
          { id: "one", blob: "menta" },
          { id: "two", blob: "fox" },
        ],
      },
    ],
    canvas as unknown as HTMLCanvasElement,
  );
  try {
    const [first, second] = world.characters;
    assert.ok(first && second);
    const old = first.model;
    const other = second.model;
    old.group.rotation.y = 0.7;
    const position = old.group.position.clone();
    const orientation = old.group.quaternion.clone();
    let released = 0;
    let expected = 0;
    old.group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      expected++;
      object.geometry.addEventListener("dispose", () => released++);
    });
    updateOfficeAvatars(
      world.characters,
      new Map([
        ["one", "person-2"],
        ["two", "fox"],
      ]),
    );
    assert.notEqual(first.model, old);
    assert.equal(old.group.parent, null);
    assert.equal(first.model.group.parent, world.scene);
    assert.deepEqual(first.model.group.position, position);
    assert.deepEqual(first.model.group.quaternion.toArray(), orientation.toArray());
    assert.equal(second.model, other);
    assert.equal(released, expected);
    const changed = first.model;
    updateOfficeAvatars(world.characters, new Map([["one", "person-2"]]));
    assert.equal(first.model, changed);
    assert.equal(released, expected);
  } finally {
    world.controls.dispose();
    disposeOfficeModels(world.scene);
  }
});
