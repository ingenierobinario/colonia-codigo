import { AgentAvatar, BLOB_NAMES, EXTRA_AVATARS } from "@colonia/ui";
import { useState } from "react";
import { type MessageKey, useT } from "../../../i18n/index.ts";

type Group = "penguins" | "people" | "animals";

export function AvatarPicker({
  name,
  value,
  onChange,
}: {
  name: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const t = useT();
  const extra = EXTRA_AVATARS[value as keyof typeof EXTRA_AVATARS];
  const [group, setGroup] = useState<Group>(extra?.group ?? "penguins");
  const choices =
    group === "penguins"
      ? BLOB_NAMES
      : Object.keys(EXTRA_AVATARS).filter((key) => EXTRA_AVATARS[key as keyof typeof EXTRA_AVATARS].group === group);
  return (
    <div>
      <fieldset className="agentedit__avatar-groups" aria-label={t("agentedit.avatar")}>
        {(["penguins", "people", "animals"] as const).map((kind) => (
          <button type="button" key={kind} aria-pressed={group === kind} onClick={() => setGroup(kind)}>
            {t(`avatars.${kind}`)}
          </button>
        ))}
      </fieldset>
      <div className="agentedit__blobs">
        {choices.map((choice) => {
          const label =
            group === "people"
              ? t("avatars.person", { number: choice.split("-")[1] ?? "" })
              : group === "animals"
                ? t(`avatars.${choice}` as MessageKey)
                : choice;
          return (
            <button
              key={choice}
              type="button"
              aria-pressed={value === choice}
              aria-label={label}
              title={label}
              className={`agentedit__blob${value === choice ? " is-on" : ""}`}
              onClick={() => onChange(choice)}
            >
              <AgentAvatar name={name} blob={choice} size={40} animated={false} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
