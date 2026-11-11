// What a newer Colonia brings, as the update dialog and its card say it: in the language on screen when the release
// says its notes per language, as they were written when it is from before that.

type Localized = { en?: string[] | undefined; es?: string[] | undefined };

/** The most a notice lists: a release says what it brings in one to four lines. */
const MOST = 4;

/** A line that only names the version says nothing the title does not. */
const ONLY_VERSION = /^Colonia v?\d+\.\d+\.\d+\.?$/i;

/** The lines to show for `language`. */
export function notesFor(
  localized: Localized | undefined,
  changes: readonly string[] | undefined,
  language: string,
): string[] {
  const own = language === "es" ? localized?.es : language === "en" ? localized?.en : undefined;
  if (own?.length) return own.slice(0, MOST);
  // Written before notes per language (or in the other one only): as they are, which beats saying nothing.
  return [...(changes ?? [])];
}

/** The one line a small notice has room for, or none when the release says nothing beyond its version. */
export function firstNote(
  localized: Localized | undefined,
  changes: readonly string[] | undefined,
  language: string,
): string | undefined {
  return notesFor(localized, changes, language)
    .map((line) => line.trim())
    .find((line) => line && !ONLY_VERSION.test(line));
}
