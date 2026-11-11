// What each version brings, said for the people who use Colonia: one to four short sentences per language. This is the
// single source of a release's notes: the published release body is generated from it (scripts/release-body.ts), and
// every notice reads it back from there (the update dialog, its card, the desktop notification, the chat after updating).
// Keep this file free of imports: the release job runs that script on plain Node, before anything is installed.

export type Highlights = { en: string[]; es: string[] };

export const HIGHLIGHTS: Record<string, Highlights> = {
  "2.28.0": {
    en: [
      "Meta Ads, WhatsApp Business and TikTok Ads join the connectors: sign in and your agents use them.",
      "On a Mac, Colonia finds Claude and Codex installed with nvm, Volta, Bun, asdf, mise or MacPorts.",
      "On Windows, agents find the colonia command in Git Bash, and closing a terminal ends what it started.",
      "On a Linux server run as root, the built-in browser starts.",
    ],
    es: [
      "Meta Ads, WhatsApp Business y TikTok Ads se suman a los conectores: inicia sesión y tus agentes los usan.",
      "En Mac, Colonia encuentra Claude y Codex instalados con nvm, Volta, Bun, asdf, mise o MacPorts.",
      "En Windows, los agentes encuentran el comando colonia en Git Bash, y cerrar un terminal cierra lo que abrió.",
      "En un servidor Linux como root, el navegador integrado arranca.",
    ],
  },
  "2.27.0": {
    en: [
      "Each project can have its own picture: upload a photo, or pick an emoji or an icon and its colour.",
      "Closed tasks can be searched and reopened: they return to Pending with their conversation intact.",
      "A project's overview shows its open tasks at a glance.",
      "Update notices now say, in your language, what each version brings.",
    ],
    es: [
      "Cada proyecto puede llevar su propia imagen: sube una foto o elige un emoji o un icono con su color.",
      "Las tareas cerradas se pueden buscar y reabrir: vuelven a Pendiente con su conversación intacta.",
      "El resumen del proyecto enseña sus tareas abiertas de un vistazo.",
      "Los avisos de actualización cuentan en tu idioma qué trae cada versión.",
    ],
  },
  "2.26.0": {
    en: ["Agents keep working through long conversations: they open a fresh context window without losing progress."],
    es: [
      "Los agentes siguen trabajando en conversaciones largas: abren otra ventana de contexto sin perder el avance.",
    ],
  },
  "2.25.0": {
    en: ["Your agents can use Claude through your Claude Code subscription."],
    es: ["Tus agentes pueden usar Claude con tu suscripción de Claude Code."],
  },
};

/** The most a notice shows per language, and the longest a line may be: the rules every entry is held to. */
export const HIGHLIGHT_LIMITS = { lines: 4, chars: 110 } as const;

/** A version's highlights (a tag, a dev build and a plain x.y.z all name the same release). */
export function highlightsOf(version: string): Highlights | undefined {
  const plain = /^v?(\d+\.\d+\.\d+)/.exec(version)?.[1];
  return plain && Object.hasOwn(HIGHLIGHTS, plain) ? HIGHLIGHTS[plain] : undefined;
}

/** What is wrong with an entry, in words (nothing when it is fine): the release gate and its test share this. */
export function highlightProblems(version: string): string[] {
  const h = highlightsOf(version);
  if (!h) return [`Colonia ${version.replace(/^v/, "")} has no highlights in apps/core/src/release-highlights.ts`];
  const out: string[] = [];
  if (h.en.length !== h.es.length) out.push(`${h.en.length} lines in English, ${h.es.length} in Spanish`);
  for (const [language, lines] of [
    ["en", h.en],
    ["es", h.es],
  ] as const) {
    if (lines.length < 1 || lines.length > HIGHLIGHT_LIMITS.lines)
      out.push(`${language}: ${lines.length} lines (1 to ${HIGHLIGHT_LIMITS.lines})`);
    for (const line of lines) {
      if (line.length > HIGHLIGHT_LIMITS.chars)
        out.push(`${language}: over ${HIGHLIGHT_LIMITS.chars} characters: ${line}`);
      if (!line.trim() || /\n/.test(line)) out.push(`${language}: an empty or multi-line entry`);
    }
  }
  return out;
}
