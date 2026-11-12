// La puerta del equipo: ningún agente del principal hace nada aquí sin que el dueño DE ESTE equipo lo apruebe.
//  - Cada sesión de agente pide aprobación la primera vez y queda aprobada mientras dure esta conexión.
//  - «Permitir siempre a este Colonia» es una marca local que solo se pone y se quita desde este equipo
//    (equipos.local_always, un método humano y local). El principal no puede ponerla: sus tramas no la llevan.
//  - NO hay camino que se la salte: ni variable de entorno, ni modo desarrollo. Este módulo no lee el entorno.
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Who } from "./wire.ts";

/** Lo que este equipo sabe de su emparejamiento. Solo datos públicos: la clave privada vive en el almacén del sistema. */
export type EquipoState = {
  id: string;
  name: string;
  principal: { url: string; fingerprint: string; publicKey: string };
  always: boolean;
};

export type PendingApproval = { id: string; at: string; who: string; summary: string };

export const stateFile = (home: string) => path.join(home, "equipo.json");

export function readState(home: string): EquipoState | undefined {
  try {
    const s = JSON.parse(fs.readFileSync(stateFile(home), "utf8")) as EquipoState;
    return s?.id && s.principal?.publicKey ? s : undefined;
  } catch {
    return undefined;
  }
}
export function writeState(home: string, s: EquipoState | undefined): void {
  const file = stateFile(home);
  if (!s) return void fs.rmSync(file, { force: true });
  fs.mkdirSync(home, { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

export function createApproval(d: {
  home: string;
  /** Aviso visible al dueño de este equipo cuando alguien pide acceso. */
  notify?: (title: string, body: string) => void;
  /** Cuánto espera una petición a que el dueño decida; pasado ese tiempo se deniega. */
  timeoutMs?: number;
}) {
  const approved = new Set<string>();
  const pending = new Map<string, PendingApproval & { settle: (ok: boolean) => void }>();

  return {
    always: () => readState(d.home)?.always === true,
    /** Cada sesión nueva espera aquí la decisión del dueño de este equipo. */
    authorize(who: Who, summary: string): Promise<boolean> {
      if (readState(d.home)?.always === true) return Promise.resolve(true);
      if (approved.has(who.session)) return Promise.resolve(true);
      return new Promise((resolve) => {
        const id = randomUUID();
        const timer = setTimeout(() => settle(false), d.timeoutMs ?? 120_000);
        const settle = (ok: boolean) => {
          clearTimeout(timer);
          pending.delete(id);
          if (ok) approved.add(who.session);
          resolve(ok);
        };
        pending.set(id, { id, at: new Date().toISOString(), who: who.name, summary, settle });
        d.notify?.("Un agente pide usar este equipo", `${who.name}: ${summary}`);
      });
    },
    /** Solo se llama desde el método humano y local del propio equipo. */
    decide(id: string, allow: boolean): boolean {
      const p = pending.get(id);
      if (!p) return false;
      p.settle(allow);
      return true;
    },
    pending: (): PendingApproval[] => [...pending.values()].map(({ settle: _s, ...p }) => p),
    /** «Permitir siempre» solo cambia el fichero de este equipo; sin emparejamiento no hay nada que marcar. */
    setAlways(enabled: boolean): boolean {
      const s = readState(d.home);
      if (!s) return false;
      writeState(d.home, { ...s, always: enabled });
      if (!enabled) approved.clear();
      return true;
    },
    /** Se desconecta o se revoca: nada de lo aprobado sigue valiendo. */
    reset() {
      approved.clear();
      for (const p of [...pending.values()]) p.settle(false);
    },
  };
}
export type Approval = ReturnType<typeof createApproval>;
