import * as THREE from "three";
import { character } from "./scene-models.ts";

export type SceneCharacter = {
  id: string;
  blob: string;
  model: ReturnType<typeof character>;
  x: number;
  z: number;
  phase: number;
};

export function disposeOfficeModels(root: THREE.Object3D) {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose();
  });
}

/** Replace only the edited colleague, preserving the camera, graphics context and everyone else's resources. */
export function updateOfficeAvatars(people: SceneCharacter[], avatars: ReadonlyMap<string, string>) {
  let changed = false;
  for (const person of people) {
    const blob = avatars.get(person.id);
    if (!blob || blob === person.blob) continue;
    const previous = person.model.group;
    const next = character(blob);
    next.group.position.copy(previous.position);
    next.group.quaternion.copy(previous.quaternion);
    next.group.scale.copy(previous.scale);
    previous.parent?.add(next.group);
    previous.removeFromParent();
    disposeOfficeModels(previous);
    person.model = next;
    person.blob = blob;
    changed = true;
  }
  return changed;
}
