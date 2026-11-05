import { SegmentedControl } from "@colonia/ui";
import { setPrefs } from "../data/prefs.ts";
import { isLanguage, LANGUAGE_NAMES, LANGUAGES, useLanguage, useT } from "../i18n/index.ts";

/** Language at first sight: both options visible, each in its own language. */
export function LanguageChoice({ className }: { className?: string }) {
  const t = useT();
  const lang = useLanguage();
  return (
    <div className={className}>
      <SegmentedControl
        size="sm"
        label={t("language.label")}
        value={lang}
        onValueChange={(v) => isLanguage(v) && setPrefs({ language: v })}
        options={[...LANGUAGES].reverse().map((l) => ({ value: l, label: LANGUAGE_NAMES[l] }))}
      />
    </div>
  );
}
