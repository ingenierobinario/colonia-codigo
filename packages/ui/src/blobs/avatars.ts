import { BLOB_NAMES } from "./catalog";

export const EXTRA_AVATARS = {
  "person-1": { group: "people", src: new URL("./avatars/person-1.svg", import.meta.url).href },
  "person-2": { group: "people", src: new URL("./avatars/person-2.svg", import.meta.url).href },
  "person-3": { group: "people", src: new URL("./avatars/person-3.svg", import.meta.url).href },
  "person-4": { group: "people", src: new URL("./avatars/person-4.svg", import.meta.url).href },
  "person-5": { group: "people", src: new URL("./avatars/person-5.svg", import.meta.url).href },
  "person-6": { group: "people", src: new URL("./avatars/person-6.svg", import.meta.url).href },
  "person-7": { group: "people", src: new URL("./avatars/person-7.svg", import.meta.url).href },
  "person-8": { group: "people", src: new URL("./avatars/person-8.svg", import.meta.url).href },
  fox: { group: "animals", src: new URL("./avatars/fox.svg", import.meta.url).href },
  cat: { group: "animals", src: new URL("./avatars/cat.svg", import.meta.url).href },
  dog: { group: "animals", src: new URL("./avatars/dog.svg", import.meta.url).href },
  rabbit: { group: "animals", src: new URL("./avatars/rabbit.svg", import.meta.url).href },
  bear: { group: "animals", src: new URL("./avatars/bear.svg", import.meta.url).href },
  frog: { group: "animals", src: new URL("./avatars/frog.svg", import.meta.url).href },
} as const;

/** Default identities remain penguins; the wider catalog is only used after an explicit choice. */
export const AVATAR_NAMES = [...BLOB_NAMES, ...Object.keys(EXTRA_AVATARS)];
