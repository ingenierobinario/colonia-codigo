// What the editor of a project's tile holds while the owner chooses, and what it turns into when saved.
import type { ProjectIcon, ProjectMark, ProjectTone } from "@colonia/protocol";

export const MARK_MODES = ["letter", "emoji", "icon", "picture"] as const;
export type MarkMode = (typeof MARK_MODES)[number];

export type MarkDraft = {
  mode: MarkMode;
  emoji: string;
  icon: ProjectIcon | undefined;
  /** The picture the project already has; a new one is uploaded on save. */
  image: string | undefined;
  /** Undefined: the colour Colonia gives the project by itself. */
  tone: ProjectTone | undefined;
};

export function draftOf(mark: ProjectMark | undefined): MarkDraft {
  return {
    mode: mark?.image ? "picture" : mark?.emoji ? "emoji" : mark?.icon ? "icon" : "letter",
    emoji: mark?.emoji ?? "",
    icon: mark?.icon,
    image: mark?.image,
    tone: mark?.tone,
  };
}

/** The mark to save; null when it is the plain initial in its own colour (nothing to keep). */
export function markOf(draft: MarkDraft, image: string | undefined = draft.image): ProjectMark | null {
  const tone = draft.tone ? { tone: draft.tone } : {};
  if (draft.mode === "emoji" && draft.emoji) return { emoji: draft.emoji, ...tone };
  if (draft.mode === "icon" && draft.icon) return { icon: draft.icon, ...tone };
  if (draft.mode === "picture" && image) return { image, ...tone };
  return draft.tone ? { tone: draft.tone } : null;
}

/** What is typed, cut to its first character as a person counts them (a flag or a family is one). */
export function firstGrapheme(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  if (typeof Intl.Segmenter !== "function") return Array.from(trimmed)[0] ?? "";
  for (const { segment } of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(trimmed)) return segment;
  return "";
}

export const PICTURE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
/** The file chosen is only read to be cropped, so it may be far bigger than what is kept. */
export const PICTURE_SOURCE_BYTES = 20 * 1024 * 1024;

/** Why a chosen file cannot become the picture, if it cannot. */
export function pictureProblem(file: { type: string; size: number }): "type" | "size" | undefined {
  if (!PICTURE_TYPES.includes(file.type)) return "type";
  return file.size > PICTURE_SOURCE_BYTES ? "size" : undefined;
}

export const PROJECT_EMOJIS = [
  "🚀",
  "⭐",
  "🔥",
  "💡",
  "🎯",
  "📈",
  "💼",
  "🛒",
  "💬",
  "📚",
  "🎓",
  "🧪",
  "🛠️",
  "💻",
  "🤖",
  "🧠",
  "🎨",
  "📷",
  "🎬",
  "🎵",
  "🎮",
  "🏠",
  "🌱",
  "🌍",
  "✈️",
  "☕",
  "🍕",
  "💪",
  "❤️",
  "🐧",
  "🐱",
  "🎁",
];
