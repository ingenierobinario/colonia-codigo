import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

type Batch = { source: THREE.Mesh; geometries: THREE.BufferGeometry[] };

/** Our opaque, untextured parts differ only in color, roughness and shadows; bake their local placement. */
export function batchStationaryParts(root: THREE.Group) {
  root.updateWorldMatrix(true, true);
  const inverse = root.matrixWorld.clone().invert();
  const batches = new Map<string, Batch>();
  const sources: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>[] = [];
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !(object.material instanceof THREE.MeshStandardMaterial)) return;
    const geometry = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone();
    geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, object.matrixWorld));
    geometry.deleteAttribute("uv");
    geometry.clearGroups();
    const colors = new Float32Array(geometry.getAttribute("position").count * 3);
    for (let i = 0; i < colors.length; i += 3) object.material.color.toArray(colors, i);
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const key = `${object.material.roughness}:${object.castShadow}:${object.receiveShadow}`;
    const batch: Batch = batches.get(key) ?? { source: object, geometries: [] };
    batch.geometries.push(geometry);
    batches.set(key, batch);
    sources.push(object);
  });
  for (const { source, geometries } of batches.values()) {
    const geometry = mergeGeometries(geometries);
    if (!geometry) throw new Error("Office geometry cannot be combined");
    const material = (source.material as THREE.MeshStandardMaterial).clone();
    material.color.set(0xffffff);
    material.vertexColors = true;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = source.castShadow;
    mesh.receiveShadow = source.receiveShadow;
    root.add(mesh);
    for (const part of geometries) part.dispose();
  }
  for (const source of sources) {
    source.removeFromParent();
    source.geometry.dispose();
    source.material.dispose();
  }
}
