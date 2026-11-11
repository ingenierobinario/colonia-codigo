// A project's tile as its owner drew it (a picture, an emoji or an icon, on a colour), or its initial when nothing
// was chosen. On the first screen: the icons arrive on demand, and a picture's tile is its colour until it loads.
import { ProjectTile, type TileTone } from "@colonia/ui";
import { useEffect, useState } from "react";
import { DEFAULT_PID, projectInitial, projectTone } from "../data/identity.ts";
import { mediaUrl } from "../data/media.ts";
import { useData } from "../data/state.ts";
import { loadProjectGlyphs } from "../lazy.ts";

type Glyphs = Awaited<ReturnType<typeof loadProjectGlyphs>>["PROJECT_GLYPHS"];

/** Pictures already loaded, by media id: a tile drawn again shows its picture at once. */
const pictures = new Map<string, string>();
const broken = new Set<string>();

/** The picture's address; undefined while it loads, false when it could not be read. */
function usePicture(id: string | undefined): string | false | undefined {
  const [, redraw] = useState(0);
  useEffect(() => {
    if (!id || pictures.has(id)) return;
    let live = true;
    mediaUrl(id).then(
      (url) => {
        pictures.set(id, url);
        broken.delete(id);
        if (live) redraw((n) => n + 1);
      },
      () => {
        broken.add(id);
        if (live) redraw((n) => n + 1);
      },
    );
    return () => {
      live = false;
    };
  }, [id]);
  if (!id) return undefined;
  return pictures.get(id) ?? (broken.has(id) ? false : undefined);
}

let glyphs: Glyphs | false | undefined;
let glyphsLoading: Promise<void> | undefined;

/** The icons, loaded once for every tile; undefined while they load, false when they could not be. */
function useGlyphs(wanted: boolean): Glyphs | false | undefined {
  const [, redraw] = useState(0);
  useEffect(() => {
    if (!wanted || glyphs) return;
    let live = true;
    glyphsLoading ??= loadProjectGlyphs().then(
      (m) => {
        glyphs = m.PROJECT_GLYPHS;
      },
      () => {
        glyphs = false;
        glyphsLoading = undefined;
      },
    );
    void glyphsLoading.then(() => live && redraw((n) => n + 1));
    return () => {
      live = false;
    };
  }, [wanted]);
  return wanted ? glyphs : undefined;
}

export interface ProjectAvatarProps {
  /** The project; the base project when left out. */
  id?: string | undefined;
  /** Its name, for the initial. Left out, a tile with nothing chosen is only its colour. */
  name?: string | undefined;
  size?: number;
  shape?: "square" | "circle";
  /** The colour where the owner chose none, when a screen has its own. */
  tone?: TileTone;
  className?: string;
}

export function ProjectAvatar({ id, name, size = 20, shape, tone, className }: ProjectAvatarProps) {
  const pid = id ?? DEFAULT_PID;
  const mark = useData((s) => (pid === DEFAULT_PID ? s.base.mark : s.projects.find((p) => p.id === pid)?.mark));
  const picture = usePicture(mark?.image);
  const icons = useGlyphs(Boolean(mark?.icon));
  const Glyph = mark?.icon && icons ? icons[mark.icon] : undefined;
  const initial = name === undefined ? undefined : projectInitial(name);
  // While a picture or the icons load the tile is only its colour: the initial would flash and go.
  const waiting = mark?.image ? picture === undefined : mark?.icon ? icons === undefined : false;
  return (
    <ProjectTile
      tone={mark?.tone ?? tone ?? projectTone(pid)}
      size={size}
      {...(shape ? { shape } : {})}
      {...(className ? { className } : {})}
      {...(picture ? { src: picture } : {})}
      {...(mark?.emoji ? { icon: <span style={{ fontSize: Math.round(size * 0.62) }}>{mark.emoji}</span> } : {})}
      {...(Glyph ? { icon: <Glyph /> } : {})}
      {...(initial && !waiting ? { initial } : {})}
    />
  );
}
