// ARRANQUE-RAPIDO-1: how long each part of a start took (ms since the process began), written once on the
// "colonia core listening" line, so a slow start in an owner's core.log says where the time went.
import { performance } from "node:perf_hooks";

const marks: Record<string, number> = {};

export function markStartup(phase: string): void {
  if (!(phase in marks)) marks[phase] = Math.round(performance.now());
}

export function startupPhases(): Record<string, number> {
  return { ...marks };
}
