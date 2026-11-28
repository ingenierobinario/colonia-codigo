import type { OfficeActivity } from "./activity.ts";
import type { SceneCharacter } from "./scene-avatars.ts";
import type { officeMotion } from "./scene-motion.ts";

export function animateOfficeCharacters(
  characters: SceneCharacter[],
  motion: ReturnType<typeof officeMotion>,
  activity: ReadonlyMap<string, OfficeActivity>,
  enabled: boolean,
) {
  const walkers = new Map(motion.walkers.map((walker) => [walker.id, walker]));
  for (const person of characters) {
    const walker = walkers.get(person.id);
    if (!walker) continue;
    const state = activity.get(person.id)?.presence ?? "offline";
    if (!enabled || state === "offline") continue;
    const walking = walker.state === "out" || walker.state === "back";
    const phase = motion.time() + person.phase;
    person.model.group.position.set(
      walker.point.x,
      0.25 + Math.sin(phase * (walking ? 10 : 3)) * (walking ? 0.06 : 0.025),
      walker.point.z,
    );
    person.model.group.rotation.y = walking
      ? walker.yaw
      : walker.state === "desk" && state === "working"
        ? Math.PI
        : Math.sin(phase * 0.5) * 0.12;
    person.model.group.rotation.z = walking ? Math.sin(phase * 10) * 0.045 : 0;
    person.model.arms.forEach((arm, i) => {
      arm.rotation.x =
        Math.sin(phase * (walking ? 10 : state === "working" ? 7 : 2) + i * Math.PI) * (walking ? 0.5 : 0.2);
    });
  }
}
