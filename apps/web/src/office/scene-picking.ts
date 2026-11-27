import * as THREE from "three";

export function pickOfficeAgent(
  canvas: HTMLCanvasElement,
  camera: THREE.Camera,
  models: { id: string; model: { group: THREE.Group } }[],
  onPick: (id: string) => void,
) {
  const ray = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let down: { x: number; y: number } | undefined;
  const start = (event: PointerEvent) => {
    if (event.button === 0) down = { x: event.clientX, y: event.clientY };
  };
  const end = (event: PointerEvent) => {
    const origin = down;
    down = undefined;
    if (!origin || event.button !== 0 || Math.hypot(origin.x - event.clientX, origin.y - event.clientY) > 5) return;
    const rect = canvas.getBoundingClientRect();
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, 1 - ((event.clientY - rect.top) / rect.height) * 2);
    ray.setFromCamera(pointer, camera);
    const hit = ray.intersectObjects(
      models.map((person) => person.model.group),
      true,
    )[0];
    if (!hit) return;
    let current: THREE.Object3D | null = hit.object;
    while (current) {
      const found = models.find((person) => person.model.group === current);
      if (found) {
        onPick(found.id);
        return;
      }
      current = current.parent;
    }
  };
  const cancel = () => {
    down = undefined;
  };
  canvas.addEventListener("pointerdown", start);
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", cancel);
  return () => {
    canvas.removeEventListener("pointerdown", start);
    canvas.removeEventListener("pointerup", end);
    canvas.removeEventListener("pointercancel", cancel);
  };
}
