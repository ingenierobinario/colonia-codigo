import { AgentAvatar, Icons } from "@colonia/ui";
import { type ReactNode, useEffect, useState } from "react";
import { useT } from "../i18n/index.ts";

/** The faces the headline cycles through, as on the website. */
const FACES = ["menta", "orbita", "parche", "cobalto", "caracol", "trino", "perla", "noche", "kiwi", "rubi"];
/** The row under the headline: the crew showing up one by one. */
const PARADE = ["coral", "zafiro", "kiwi", "noche", "orbita", "brasa", "perla", "lila", "aqua"];
const EVERY_MS = 2600;
const FACE_SIZE = { width: "100%", height: "100%" };

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/** One span per character, each easing in a little after the one before (the website's headline). */
function Letters({ text, delay }: { text: string; delay: number }) {
  return (
    <span className="crew__split" aria-hidden="true">
      {[...text].map((ch, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the characters of a fixed word, in order
        <span key={i} className="crew__ch" style={{ animationDelay: `${delay + i * 0.045}s` }}>
          {ch === " " ? " " : ch}
        </span>
      ))}
    </span>
  );
}

/**
 * The last word changes to the next one whole: it fades out and the next fades in (LETRAS-LEGIBLES-1). It used to turn
 * through random glyphs, and a screenshot or a slow machine caught it mid-change, unreadable ("_?b7\]/0#>+b").
 */
function useWordCycle(words: readonly string[], start: boolean): number {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (!start || words.length < 2 || reducedMotion()) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) setIndex((i) => i + 1);
    }, EVERY_MS);
    return () => window.clearInterval(timer);
  }, [start, words]);
  return index;
}

/** "Meet ⟨blob⟩ your crew." — the website's hero: the headline assembles, then the face and the word keep changing. */
export function CrewHero({
  compact = false,
  pill,
  below,
}: {
  compact?: boolean;
  /** The badge above the headline; the first run's by default. */
  pill?: ReactNode;
  /** What sits under the headline; the crew lining up by default. */
  below?: ReactNode;
}) {
  const t = useT();
  const words = t("connect.heroWords").split("|");
  const [face, setFace] = useState(0);
  const [cycling, setCycling] = useState(false);
  const at = useWordCycle(words, cycling);
  const word = words[at % words.length] ?? "";

  useEffect(() => {
    if (reducedMotion()) return;
    const begin = window.setTimeout(() => setCycling(true), 2200);
    return () => window.clearTimeout(begin);
  }, []);
  useEffect(() => {
    if (!cycling) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) setFace((f) => f + 1);
    }, EVERY_MS);
    return () => window.clearInterval(timer);
  }, [cycling]);

  const meet = t("setup.welcome.meet");
  const your = t("setup.welcome.your");
  return (
    <div className={`crew${compact ? " is-compact" : ""}`}>
      {pill ?? (
        <span className="wiz__pill crew__pill">
          {t("connect.pill")} <span className="is-muted">{t("connect.pillMuted")}</span>
          <span className="wiz__lock">
            <Icons.Server size={12} />
          </span>
        </span>
      )}
      <h1 className="crew__title" aria-label={`${meet} ${your} ${words[0] ?? ""}`}>
        <span className="crew__row">
          <Letters text={meet} delay={0.1} />
          <span className="crew__blob" aria-hidden="true">
            {/* A new key remounts the face, which pops in; the old one is gone at once. */}
            <AgentAvatar
              key={face}
              name="crew"
              blob={FACES[face % FACES.length]}
              className="crew__face"
              // Sized by the headline (em), so it follows the title as it shrinks.
              style={FACE_SIZE}
            />
          </span>
          <Letters text={your} delay={0.4} />
        </span>
        <span className="crew__row">
          <span className="crew__word" aria-hidden="true">
            {cycling ? (
              // A new key remounts the word, which fades in whole.
              <span key={at} className="crew__swap">
                {word}
              </span>
            ) : (
              <Letters text={words[0] ?? ""} delay={0.7} />
            )}
          </span>
        </span>
      </h1>
      {below ?? (
        <div className="crew__parade" aria-hidden="true">
          {PARADE.map((b, i) => (
            <span key={b} className="crew__member" style={{ animationDelay: `${1.1 + i * 0.09}s` }}>
              <AgentAvatar name={b} blob={b} size={44} />
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
