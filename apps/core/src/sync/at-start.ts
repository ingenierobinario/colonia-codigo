// LAZY-1 · Lo que hace falta saber al arrancar sin cargar sync/service.ts (y sus ~40 módulos): dónde escucha y si hay
// algo que sincronizar ya. Sin pareja, sin invitación armada y sin restos que limpiar, el servicio se trae con import()
// la primera vez que alguien lo usa (una llamada sync.*, una conexión en SYNC_PATH).
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

export const SYNC_PATH = "/sincronizar";
export const STATE_FILE = "sincronizar.json";

/** ¿Tiene que estar en marcha desde el arranque? Pareja guardada, código de plantilla, clave en registros o diario. */
export function syncNeededAtStart(d: {
  home: string;
  db: DatabaseSync;
  presetCode?: string;
  logKey?: boolean;
}): boolean {
  if (d.presetCode || d.logKey) return true;
  if (fs.existsSync(path.join(d.home, STATE_FILE))) return true;
  // Lo mismo que journal.installed(): un diario sin pareja se retira en start().
  return Boolean(d.db.prepare("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = 'sync_ver'").get());
}
