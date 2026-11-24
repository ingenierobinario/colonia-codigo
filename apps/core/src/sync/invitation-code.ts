import { randomInt, scryptSync } from "node:crypto";

// Human-entered codes omit ambiguous characters and are stretched before proving possession.
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const shortCode = () => Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
export const pretty = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;
export const typed = (text: string) => {
  const code = text.toUpperCase().replace(/[^0-9A-Z]/g, "");
  return /^[2-9A-HJ-NP-Z]{8}$/.test(code) ? code : undefined;
};
export const stretch = (code: string) =>
  scryptSync(code, "colonia-sincronizar-2", 32, { N: 16384, r: 8, p: 1 }).toString("hex");
export const PRESET_TTL_MS = 24 * 60 * 60_000;
export const PRESET_FILE = "emparejamiento-plantilla.usado";
/** The fallback key is disclosed only through the hosting account, never public HTTP. */
export const LOG_KEY_FILE = "clave-de-vinculacion.txt";
export const LOG_KEY_TTL_MS = 30 * 24 * 60 * 60_000;
