// BANDEJA-1: chat titles that read in a list — no raw links, no relaying words. A leaf: imported by the engine and
// the channels without pulling the rest in.

const LINK = /https?:\/\/\S+/gi;

/** A link as a title: its host and its last readable part ("github.com · colonia"), or nothing. */
function linkName(url: string): string | undefined {
  try {
    const u = new URL(url.replace(/[)\].,;:!?»”"']+$/, ""));
    const host = u.hostname.replace(/^www\./, "");
    const last = decodeURIComponent(u.pathname.split("/").filter(Boolean).at(-1) ?? "").replace(
      /\.[a-z0-9]{1,5}$/i,
      "",
    );
    return host ? (last && /\p{L}/u.test(last) ? `${host} · ${last}` : host) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * BANDEJA-1: a title never is a raw link. The words around it when there are some; a link alone reads as its site
 * and last part; nothing when even that cannot be read.
 */
export function withoutLinks(line: string): string | undefined {
  const links = line.match(LINK);
  if (!links) return line;
  const rest = line
    .replace(LINK, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s:,;·–—-]+|[\s:,;·–—-]+$/g, "")
    .trim();
  return /\p{L}{2}/u.test(rest) ? rest : linkName(links[0] ?? "");
}

/** Cut at a word, `max` characters at most with the ellipsis. */
export function cutAt(line: string, max: number): string {
  if (line.length <= max) return line;
  const cut = line.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.–—-]+$/, "")}…`;
}

/**
 * Someone relaying what the owner asked ("Alexander pide ahora:", "The owner wants:"): a name, or the owner named as
 * such, a verb of asking, a few more words and a colon. Not "Error: …" (no verb), not "Revisa lo que dice el log: …",
 * and not someone else's words ("La API dice: 500", "El cliente quiere: presupuesto"): those are the task itself.
 */
const RELAYED =
  /^(?:(?!(?:Esto|Eso|Esta|Este|This|That|It|Él|Ella)\s)\p{Lu}[\p{Ll}'’-]+|(?:[Tt]he|[Ee]l|[Ll]a|[Mm]i|[Mm]y|[Tt]u|[Yy]our)\s(?:owner|user|usuari[oa]|dueñ[oa]|propietari[oa]|jef[ea]|boss))\s(?:pide|pidi[oó]|ordena|orden[oó]|quiere|dice|dijo|asks|asked|wants|says|said)\b[^:\n]{0,25}:\s*/u;
/** The end of a sentence: not the dot of a short abbreviation ("Sr. García", "Dr. Ruiz"). */
const SENTENCE_END = /(?<=(?:\p{L}{4,}|[^\p{L}\s])\.["'”»]?|[!?]["'”»]?)\s/u;

/**
 * A delegated chat's title, from the task an agent handed over: its first sentence without the relaying words or
 * quotes around it, ≤40 characters. The same title given again stays the same (a session asked again).
 */
export function shortTask(task: string): string {
  const first = task.split("\n").find((l) => l.trim()) ?? "";
  let line = first.replace(/\s+/g, " ").trim().replace(RELAYED, "");
  line = withoutLinks(line) ?? "";
  line = line.split(SENTENCE_END)[0] ?? "";
  line = line
    .replace(/^["'“«]+/, "")
    .replace(/\.?["'”»]*\.?$/, "")
    .trim();
  if (!line) return cutAt(first.trim(), 40);
  return cutAt(line.charAt(0).toLocaleUpperCase() + line.slice(1), 40);
}
