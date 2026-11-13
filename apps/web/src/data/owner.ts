import type { OwnerIdentity } from "@colonia/protocol";
import { useEffect } from "react";
import { client } from "./client.ts";
import { createStore, useSlice } from "./createStore.ts";
import { usePrefs } from "./prefs.ts";

const fromCore = createStore({ name: "", timezone: "", photo: undefined as string | undefined, asked: false });

/** Reads the owner's name and time zone from the core once. */
function ask(): void {
  if (fromCore.get().asked) return;
  fromCore.set({ asked: true });
  void client
    .call("owner.get", {})
    .then(rememberOwner)
    .catch(() => fromCore.set({ asked: false }));
}

/** What the core answered for the owner (owner.get or owner.set), for every screen that shows them. */
export function rememberOwner(o: OwnerIdentity): void {
  fromCore.set({ name: o.name.trim(), timezone: o.timezone, photo: o.photo, asked: true });
}

/** FOTO-DUENO-1: the media id of the owner's picture; undefined: their initials. */
export function useOwnerPhoto(): string | undefined {
  const photo = useSlice(fromCore, (s) => s.photo);
  useEffect(ask, []);
  return photo;
}

/** How the panel names the owner in third person ("Alex assigned it"): this device's name, else the core's, else "". */
export function useOwnerName(): string {
  const local = usePrefs((s) => s.displayName);
  const core = useSlice(fromCore, (s) => s.name);
  useEffect(() => {
    if (!local) ask();
  }, [local]);
  return local || core;
}

/** The time zone the owner declared ("" while unknown or not set: the core's computer's). */
export function useOwnerTimeZone(): string {
  const zone = useSlice(fromCore, (s) => s.timezone);
  useEffect(ask, []);
  return zone;
}
