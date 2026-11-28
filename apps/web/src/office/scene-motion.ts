import type { sceneLayout } from "./scene-layout.ts";

type Point = { x: number; z: number };
type Layout = ReturnType<typeof sceneLayout>;
type Presence = "working" | "waiting" | "queued" | "idle" | "offline";
type Walker = {
  id: string;
  room: string;
  home: Point;
  exit: Point[];
  point: Point;
  yaw: number;
  route: Point[];
  segment: number;
  state: "desk" | "out" | "coffee" | "back";
  slot?: number;
  next: number;
  wait: number;
};
export const officeExtent = (rooms: Layout) => ({
  width: Math.max(10, ...rooms.map((room) => room.x + room.width)),
  depth: Math.max(8, ...rooms.map((room) => room.z + room.depth)),
});

/** Leave the chair from its side, use the row aisle, then the corridor outside the room's open right edge. */
export function officeWalkers(rooms: Layout): Walker[] {
  const { depth } = officeExtent(rooms);
  return rooms.flatMap((room) => {
    const corridor =
      Math.max(...rooms.filter((other) => other.x === room.x).map((other) => other.x + other.width)) + 0.75;
    return room.stations.map((station, i) => {
      const home = { x: room.x + station.x, z: room.z + station.z + 1 };
      return {
        id: station.id,
        room: room.id,
        home,
        point: { ...home },
        yaw: 0,
        exit: [
          home,
          { x: home.x + 0.8, z: home.z },
          { x: home.x + 0.8, z: home.z + 0.85 },
          { x: corridor, z: home.z + 0.85 },
          { x: corridor, z: depth + 1.25 },
        ],
        route: [],
        segment: 0,
        state: "desk" as const,
        next: 1.5 + i * 4,
        wait: 0,
      };
    });
  });
}

function move(walker: Walker, distance: number) {
  while (distance > 0 && walker.segment < walker.route.length - 1) {
    const next = walker.route[walker.segment + 1];
    if (!next) break;
    const dx = next.x - walker.point.x;
    const dz = next.z - walker.point.z;
    const length = Math.hypot(dx, dz);
    if (length > 0.001) walker.yaw = Math.atan2(dx, dz);
    if (length <= distance) {
      walker.point = { ...next };
      walker.segment++;
      distance -= length;
    } else {
      walker.point.x += (dx * distance) / length;
      walker.point.z += (dz * distance) / length;
      distance = 0;
    }
  }
}

function returnToDesk(walker: Walker) {
  walker.route = [{ ...walker.point }, ...walker.route.slice(0, walker.segment + 1).reverse()];
  walker.segment = 0;
  walker.state = "back";
}

/** Ambient activity uses its own paused clock; work and approval states always come from the core. */
export function officeMotion(rooms: Layout) {
  const walkers = officeWalkers(rooms);
  const { width, depth } = officeExtent(rooms);
  let last: number | undefined;
  let elapsed = 0;
  return {
    walkers,
    time: () => elapsed,
    resetClock() {
      last = undefined;
    },
    update(time: number, enabled: boolean, presence: ReadonlyMap<string, { presence: Presence }>) {
      if (!enabled) {
        last = undefined;
        return;
      }
      const dt = last === undefined ? 0 : Math.max(0, Math.min(0.25, (time - last) / 1000));
      last = time;
      elapsed += dt;
      const active = walkers.filter((walker) => walker.state !== "desk");
      const slots = new Set(active.map((walker) => walker.slot));
      const occupied = new Set(active.map((walker) => walker.room));
      for (const [index, walker] of walkers.entries()) {
        const state = presence.get(walker.id)?.presence ?? "offline";
        if (state === "offline") continue;
        if (state !== "idle" && (walker.state === "out" || walker.state === "coffee")) returnToDesk(walker);
        if (walker.state === "desk" && state === "idle" && elapsed >= walker.next && !occupied.has(walker.room)) {
          const slot = [0, 1, 2, 3].find((candidate) => !slots.has(candidate));
          if (slot !== undefined) {
            walker.slot = slot;
            slots.add(slot);
            occupied.add(walker.room);
            walker.route = [
              ...walker.exit,
              { x: width / 2 + (slot - 1.5) * 1.4, z: depth + 1.25 },
              { x: width / 2 + (slot - 1.5) * 1.4, z: depth + 2.4 },
            ];
            walker.segment = 0;
            walker.state = "out";
          }
        }
        if (walker.state === "out" || walker.state === "back") {
          move(walker, dt * 2);
          if (walker.segment === walker.route.length - 1) {
            if (walker.state === "out") {
              walker.state = "coffee";
              walker.wait = 4 + (index % 3);
              walker.yaw = 0;
            } else {
              walker.state = "desk";
              walker.slot = undefined;
              walker.next = elapsed + 20 + (index % 17);
            }
          }
        } else if (walker.state === "coffee") {
          walker.wait -= dt;
          if (walker.wait <= 0) returnToDesk(walker);
        }
      }
    },
  };
}
