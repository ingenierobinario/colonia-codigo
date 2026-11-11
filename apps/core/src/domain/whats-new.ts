// What an update brought, told by the super-agent: on the first start of a newer release, a chat of its own, unread,
// with each new release's changes. Written from the notes the build carries (no model call); asking about them there
// is an ordinary turn. See DECISIONS.md#d-100 and #d-117
import { HIGHLIGHTS, highlightsOf } from "../release-highlights.ts";
import { compareVersions, type Release, type ReleaseNotes, type ReleaseSource } from "../release-notes.ts";
import { postAgentWords } from "./agent-words.ts";
import type { Store } from "./store.ts";

/** The last release this install was told about (or started on). */
const SEEN_KEY = "release_seen";
/** The chat the release news goes in. */
const THREAD_KEY = "whats_new_thread";
const PER_SECTION = 25;

type Language = "en" | "es";

const WORDS = {
  en: {
    title: (v: string) => `What's new in Colonia ${v}`,
    intro: (v: string) => `Colonia was updated to ${v}. This is what changed:`,
    sections: { feat: "New", fix: "Fixed", perf: "Faster" },
    more: (n: number) => `…and ${n} more`,
    internal: "Internal changes only.",
    outro: "Ask me anything about these changes.",
  },
  es: {
    title: (v: string) => `Novedades de Colonia ${v}`,
    intro: (v: string) => `Colonia se actualizó a la ${v}. Esto es lo que cambió:`,
    sections: { feat: "Nuevo", fix: "Corregido", perf: "Más rápido" },
    more: (n: number) => `…y ${n} más`,
    internal: "Solo cambios internos.",
    outro: "Pregúntame lo que quieras sobre estos cambios.",
  },
};

/**
 * The language the news is framed in: the owner's when some release says what it brings in it; English when all there
 * is are commit sentences, since a frame in another language around them reads broken.
 */
const frameOf = (releases: Release[], language: Language): Language =>
  releases.some((r) => highlightsOf(r.version)) ? language : "en";

function releaseText(r: Release, language: Language): string {
  const w = WORDS[language];
  // Written for people, in their language: this is the release, whatever its commits were.
  const said = highlightsOf(r.version)?.[language];
  if (said?.length) return said.map((line) => `- ${line}`).join("\n");
  const blocks = (["feat", "fix", "perf"] as const).flatMap((kind) => {
    const lines = r.changes.filter((c) => c.kind === kind).map((c) => `- ${c.text}`);
    if (!lines.length) return [];
    const more = lines.length - PER_SECTION;
    return [`**${w.sections[kind]}**\n${lines.slice(0, PER_SECTION).join("\n")}${more > 0 ? `\n${w.more(more)}` : ""}`];
  });
  return blocks.length ? blocks.join("\n\n") : w.internal;
}

/** The message: one release as it is, several (an install that skipped some) each under its version, newest first. */
export function whatsNewText(version: string, releases: Release[], language: Language = "en"): string {
  const frame = frameOf(releases, language);
  const w = WORDS[frame];
  const body =
    releases.length === 1 && releases[0]
      ? releaseText(releases[0], frame)
      : releases.map((r) => `### ${r.version}\n\n${releaseText(r, frame)}`).join("\n\n");
  return `${w.intro(version)}\n\n${body}\n\n${w.outro}`;
}

/** The releases after `seen` up to `version`, from what the build carries; with no `seen`, only `version`'s own. */
const newSince = (notes: ReleaseNotes, version: string, seen: string | undefined) =>
  notes.releases.filter((r) =>
    seen
      ? compareVersions(r.version, version) <= 0 && compareVersions(r.version, seen) > 0
      : compareVersions(r.version, version) === 0,
  );

/** The same range from the written highlights alone, newest first, for a build that carries no notes. */
const saidSince = (version: string, seen: string | undefined): Release[] =>
  Object.keys(HIGHLIGHTS)
    .filter((v) =>
      seen ? compareVersions(v, version) <= 0 && compareVersions(v, seen) > 0 : compareVersions(v, version) === 0,
    )
    .sort((a, b) => compareVersions(b, a))
    .map((v) => ({ version: v, changes: [] }));

/**
 * Tells the owner what this release brought, once per release. A new install (nothing said in it yet) starts at its
 * version untold; an install in use from before release notes existed is told this one.
 */
export function announceRelease(store: Store, source: ReleaseSource): { thread?: string } {
  const version = source.version();
  if (!version) return {};
  const seen = store.settings.get(SEEN_KEY);
  if (seen === version) return {};
  // A downgrade tells nothing and keeps the newest release told, so going back up is not told twice.
  if (seen && compareVersions(version, seen) <= 0) return {};
  const untold = () => {
    store.settings.set(SEEN_KEY, version);
    return {};
  };
  if (!seen && !store.messages.anyFromOwner()) return untold();
  const boss = store.agents.list().find((a) => a.kind === "secretary");
  const notes = source.notes();
  const carried = notes ? newSince(notes, version, seen) : [];
  // A release that says what it brings is told even when the build carries no commit log for it.
  const releases = carried.length ? carried : saidSince(version, seen);
  if (!boss || !releases.length) return untold();

  const language: Language = store.settings.get("owner_language") === "en" ? "en" : "es";
  const text = whatsNewText(version, releases, language);
  const title = WORDS[frameOf(releases, language)].title(version);
  const oldest = releases.at(-1);
  return store.tx(() => {
    // One chat for the news: each release goes on in it (retitled) instead of opening another.
    const kept = store.threads.get(store.settings.get(THREAD_KEY) ?? "");
    const thread =
      kept && !kept.archived && kept.agent_ids[0] === boss.id
        ? store.threads.patch(kept.id, { title })
        : store.threads.create({ kind: "agent", title, agent_ids: [boss.id] });
    store.settings.set(THREAD_KEY, thread.id);
    store.threads.mergeContext(thread.id, {
      release: {
        version,
        ...(oldest?.previous ? { previous: oldest.previous } : {}),
        ...(notes?.branch ? { branch: notes.branch } : {}),
        ...(notes?.repo_dir ? { repo_dir: notes.repo_dir } : {}),
      },
    });
    postAgentWords(store, {
      thread_id: thread.id,
      agent_id: boss.id,
      text,
      note: `[Colonia: Colonia was updated to ${version}; you posted what changed for the owner.]`,
      unread: true,
    });
    store.settings.set(SEEN_KEY, version);
    return { thread: thread.id };
  });
}
