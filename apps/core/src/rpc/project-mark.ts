// A project's tile as the owner drew it. Its picture is a file of its own: a temporary upload the tile takes, so no
// chat or task shares it, and Colonia deletes it when the tile changes to another.
import fs from "node:fs";
import { PROJECT_IMAGE_BYTES, type ProjectMark } from "@colonia/protocol";
import type { Store } from "../domain/store.ts";
import { badRequest } from "../errors.ts";

const glyphs = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** The tile to keep for what the owner sent (undefined = the initial again), refused when it cannot be drawn. */
function checked(
  store: Store,
  current: ProjectMark | undefined,
  next: ProjectMark | null,
  what: string,
): ProjectMark | undefined {
  if (!next || !Object.keys(next).length) return undefined;
  if (next.emoji && [...glyphs.segment(next.emoji)].length !== 1) throw badRequest("a project's tile shows one emoji");
  if (next.image && next.image !== current?.image) {
    const m = store.media.get(next.image);
    // Only an upload nothing else shows yet: the tile may delete it later without asking who else uses it.
    if (m?.kind !== "image" || !store.taskAttachments.pending(m.id))
      throw badRequest(`${what} is an image uploaded for it`);
    if (m.bytes > PROJECT_IMAGE_BYTES) throw badRequest(`${what} is at most ${PROJECT_IMAGE_BYTES / 1024} KB`);
  }
  return next;
}

/** Changes a tile through `write`: takes its new picture and deletes the one it replaces. */
export function changeMark(
  store: Store,
  current: ProjectMark | undefined,
  next: ProjectMark | null,
  write: (mark: ProjectMark | undefined) => void,
  /** Whose picture, for the refusals (FOTO-DUENO-1 reuses it for the owner's). */
  what = "a project's picture",
): void {
  const mark = checked(store, current, next, what);
  const replaced = current?.image && current.image !== mark?.image ? store.media.get(current.image) : undefined;
  store.tx(() => {
    if (mark?.image && mark.image !== current?.image) store.taskAttachments.take(mark.image);
    // Temporary again, so the sweep of uploads deletes it if its file cannot be removed right now.
    if (replaced && !store.taskAttachments.pending(replaced.id)) store.taskAttachments.stage(replaced.id);
    write(mark);
  });
  if (!replaced) return;
  try {
    fs.rmSync(replaced.path, { force: true });
    store.media.remove(replaced.id);
  } catch {
    /* The next sweep of temporary uploads retries. */
  }
}
