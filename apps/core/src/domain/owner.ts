// Who the owner is, for their agents: the name is the owner's person, the rest are settings. Agents read it in their
// system prompt (name, about) and their turn context (language, time zone).
import type { OwnerIdentity } from "@colonia/protocol";
import type { Store } from "./store.ts";

export function ownerIdentity(store: Store): OwnerIdentity {
  const extra = store.settings.read("owner_profile");
  return {
    name: store.persons.owner().name === "Owner" ? "" : store.persons.owner().name,
    about: extra.about,
    language: store.settings.get("owner_language") || "es",
    timezone: extra.timezone,
    ...(extra.photo ? { photo: extra.photo } : {}),
  };
}

/** FOTO-DUENO-1: keeps the owner's picture (a media id; undefined: their initials). The caller takes the upload. */
export function writeOwnerPhoto(store: Store, photo: string | undefined): void {
  const { photo: _was, ...cur } = store.settings.read("owner_profile");
  store.settings.write("owner_profile", { ...cur, ...(photo ? { photo } : {}) });
}

/** Saves what changes but the picture, which `owner.set` takes through `changeMark`. */
export function saveOwnerIdentity(store: Store, patch: Omit<Partial<OwnerIdentity>, "photo">): OwnerIdentity {
  const name = patch.name?.trim();
  if (name) store.persons.update(store.persons.owner().id, { name });
  if (patch.language !== undefined) store.settings.set("owner_language", patch.language);
  if (patch.about !== undefined || patch.timezone !== undefined) {
    const cur = store.settings.read("owner_profile");
    store.settings.write("owner_profile", {
      ...cur,
      about: patch.about ?? cur.about,
      timezone: patch.timezone ?? cur.timezone,
    });
  }
  return ownerIdentity(store);
}

/** The owner's time zone when it is a real one; undefined: this machine's. */
export function ownerTimeZone(store: Store): string | undefined {
  const tz = store.settings.read("owner_profile").timezone;
  if (!tz) return undefined;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return undefined;
  }
}
