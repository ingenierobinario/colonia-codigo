// COPIA-COMPLETA-1 · La copia completa de Colonia y su restauración (DECISIONS.md#d-192).
import type { Backup } from "../backup/service.ts";
import type { Handlers } from "./router.ts";

export function backupHandlers(backup: Backup) {
  return {
    "backup.status": () => backup.status(),
    "backup.list": () => ({ copies: backup.list() }),
    "backup.create": (p) => backup.create(p),
    "backup.inspect": (p) => backup.inspect(p),
    "backup.restore": (p) => backup.restore(p),
    "backup.dismiss": () => {
      backup.dismiss();
      return {};
    },
  } satisfies Partial<Handlers>;
}
