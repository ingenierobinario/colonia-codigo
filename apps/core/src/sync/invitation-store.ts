import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { PairingStore } from "../equipos/pairing.ts";

const Record = z.object({
  digest: z.string(),
  expires: z.number().finite(),
  misses: z.number().int().min(0),
  used: z.boolean(),
});

/** Only a digest is persisted; damaged state must never reopen an invitation. */
export function invitationStore(home: string, kind: "preset" | "log"): PairingStore {
  const file = path.join(home, `sync-invitation-${kind}.json`);
  const digest = (code: string) => createHash("sha256").update(code).digest("hex");
  return {
    read(code) {
      let raw: string;
      try {
        raw = fs.readFileSync(file, "utf8");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw err;
      }
      const record = Record.parse(JSON.parse(raw));
      return record.digest === digest(code) ? record : undefined;
    },
    write(code, state) {
      const temporary = `${file}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify({ digest: digest(code), ...state }), { mode: 0o600 });
      fs.renameSync(temporary, file);
    },
  };
}
