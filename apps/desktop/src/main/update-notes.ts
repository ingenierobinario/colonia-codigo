// What the system notification of an update says: the version, and the first thing it brings in the person's language.
import type { LocalizedNotes } from "@colonia/protocol";

/** A notification shows about two lines: a longer highlight is cut at a word, so the closing sentence still fits. */
const HIGHLIGHT_CHARS = 120;

/** A line that only names the version says nothing the title does not. */
const ONLY_VERSION = /^Colonia v?\d+\.\d+\.\d+\.?$/i;

function shorten(line: string): string {
  if (line.length <= HIGHLIGHT_CHARS) return line;
  const cut = line.slice(0, HIGHLIGHT_CHARS);
  const at = cut.lastIndexOf(" ");
  return `${(at > HIGHLIGHT_CHARS / 2 ? cut.slice(0, at) : cut).replace(/[\s.,;:]+$/, "")}…`;
}

/** The first thing the update brings: in the person's language when the release says it so, else as it was written. */
export function firstHighlight(
  es: boolean,
  update: { notes?: readonly string[] | undefined; localized?: LocalizedNotes | undefined },
): string | undefined {
  const own = es ? update.localized?.es : update.localized?.en;
  const line = (own?.length ? own : (update.notes ?? [])).map((l) => l.trim()).find((l) => l && !ONLY_VERSION.test(l));
  if (!line) return undefined;
  const short = shorten(line);
  return /[.!?…]$/.test(short) ? short : `${short}.`;
}

/** The notification for a newer Colonia that is out, or one that is downloaded and waits for a restart. */
export function updateNotice(
  kind: "out" | "ready",
  version: string,
  es: boolean,
  update: { notes?: readonly string[] | undefined; localized?: LocalizedNotes | undefined } = {},
): { title: string; body: string } {
  const words =
    kind === "ready"
      ? es
        ? { title: `Colonia ${version} está lista`, act: "Reinicia Colonia para usarla." }
        : { title: `Colonia ${version} is ready`, act: "Restart Colonia to use it." }
      : es
        ? { title: `Salió Colonia ${version}`, act: "Abre Colonia para actualizar." }
        : { title: `Colonia ${version} is out`, act: "Open Colonia to update." };
  const highlight = firstHighlight(es, update);
  return { title: words.title, body: highlight ? `${highlight} ${words.act}` : words.act };
}
