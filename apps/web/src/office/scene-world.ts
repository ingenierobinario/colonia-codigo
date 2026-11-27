import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { sceneLayout } from "./scene-layout.ts";
import { box, character, desk, plant } from "./scene-models.ts";

export type SceneRoom = { id: string; agents: { id: string; blob: string }[] };

export function createOfficeWorld(rooms: SceneRoom[], canvas: HTMLCanvasElement) {
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xfff7e6, 0x708b83, 2.5));
  const sunlight = new THREE.DirectionalLight(0xfff2d5, 3);
  sunlight.position.set(12, 25, 10);
  sunlight.castShadow = true;
  sunlight.shadow.mapSize.set(1024, 1024);
  scene.add(sunlight);
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 400);
  const controls = new OrbitControls(camera, canvas);
  controls.maxPolarAngle = Math.PI / 2.2;
  controls.minDistance = 5;
  controls.maxDistance = 180;
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  const layouts = sceneLayout(rooms);
  const width = Math.max(10, ...layouts.map((room) => room.x + room.width));
  const depth = Math.max(8, ...layouts.map((room) => room.z + room.depth));
  const center = new THREE.Vector3(width / 2, 0, depth / 2);
  controls.target.copy(center);
  camera.position.copy(center).add(new THREE.Vector3(1, 1.2, 1.4).multiplyScalar(Math.max(width, depth) * 0.8));
  box(scene, [width + 2, 0.3, depth + 2], [width / 2, -0.35, depth / 2], 0x789489);
  const characters: { id: string; model: ReturnType<typeof character>; x: number; z: number; phase: number }[] = [];
  const roomLabels: { id: string; point: THREE.Vector3 }[] = [];
  for (const [index, layout] of layouts.entries()) {
    const room = rooms[index];
    if (!room) continue;
    const group = new THREE.Group();
    group.position.set(layout.x, 0, layout.z);
    scene.add(group);
    box(
      group,
      [layout.width, 0.15, layout.depth],
      [layout.width / 2, -0.1, layout.depth / 2],
      index % 2 ? 0xd7dfcf : 0xe6d5b8,
    );
    box(group, [layout.width, 1.6, 0.16], [layout.width / 2, 0.75, 0], 0xf6eee0);
    box(group, [0.16, 1.6, layout.depth], [0, 0.75, layout.depth / 2], 0xe8e2d5);
    for (let z = 1; z < layout.depth; z++) box(group, [layout.width, 0.005, 0.015], [layout.width / 2, 0, z], 0xc7bda8);
    plant(group, layout.width - 0.65, 0.7);
    plant(group, 0.7, layout.depth - 0.7);
    box(group, [1.8, 1.1, 0.45], [1.6, 0.55, 0.35], 0x8a9f91);
    for (let book = 0; book < 7; book++)
      box(group, [0.12, 0.36, 0.25], [1 + book * 0.2, 1.3, 0.35], book % 2 ? 0xd99c71 : 0x4c7778);
    roomLabels.push({ id: room.id, point: new THREE.Vector3(layout.x + layout.width / 2, 2.4, layout.z) });
    for (const [i, station] of layout.stations.entries()) {
      const agent = room.agents[i];
      if (!agent) continue;
      desk(group, station.x, station.z);
      const model = character(agent.blob);
      const x = layout.x + station.x;
      const z = layout.z + station.z + 1;
      model.group.position.set(x, 0.25, z);
      scene.add(model.group);
      characters.push({ id: agent.id, model, x, z, phase: i * 2.3 + index });
    }
  }
  return { scene, camera, controls, characters, roomLabels };
}
