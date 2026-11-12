// Mis equipos: los portátiles del dueño emparejados con este Colonia. Aquí solo vive la clave PÚBLICA de cada uno
// (la privada se queda en el almacén del sistema del propio equipo) y el registro de auditoría que ve el dueño.
import { newId, now, qb, type Sql } from "./sql.ts";

export type TeamComputer = {
  id: string;
  name: string;
  platform: string;
  public_key: string;
  agent_access: boolean;
  created_at: string;
  last_seen_at?: string;
  /** EQUIPOS-SIN-AGENTE-1: «ssh» si se llega por SSH sin instalar nada; si no, el equipo corre Colonia y llama él. */
  transport?: "ssh";
  address?: string;
};

export type TeamAuditEntry = { n: number; at: string; computer_id?: string; kind: string; detail: string };

/** El registro no crece sin límite: se conservan las últimas entradas. */
const AUDIT_KEEP = 2000;
const DETAIL_MAX = 600;

export function teamRepo({ one, all, run }: Sql) {
  const toComputer = (r: {
    id: string;
    name: string;
    platform: string;
    public_key: string;
    agent_access: number;
    created_at: string;
    last_seen_at: string | null;
    transport: string | null;
    address: string | null;
  }): TeamComputer => ({
    id: r.id,
    name: r.name,
    platform: r.platform,
    public_key: r.public_key,
    agent_access: r.agent_access === 1,
    created_at: r.created_at,
    ...(r.last_seen_at ? { last_seen_at: r.last_seen_at } : {}),
    ...(r.transport === "ssh" ? { transport: "ssh" as const } : {}),
    ...(r.address ? { address: r.address } : {}),
  });
  return {
    list(): TeamComputer[] {
      return all(qb.selectFrom("team_computers").selectAll().where("revoked_at", "is", null).orderBy("created_at")).map(
        toComputer,
      );
    },
    get(id: string): TeamComputer | undefined {
      const r = one(qb.selectFrom("team_computers").selectAll().where("id", "=", id).where("revoked_at", "is", null));
      return r ? toComputer(r) : undefined;
    },
    /** Alta de un equipo tras confirmarse el código en él. El acceso de los agentes nace apagado. */
    add(name: string, platform: string, publicKey: string): TeamComputer {
      const id = newId("eqp");
      run(
        qb
          .insertInto("team_computers")
          .values({ id, name, platform, public_key: publicKey, agent_access: 0, created_at: now() }),
      );
      const r = one(qb.selectFrom("team_computers").selectAll().where("id", "=", id));
      if (!r) throw new Error("equipo no guardado");
      return toComputer(r);
    },
    /** EQUIPOS-SIN-AGENTE-1: alta de un equipo al que se llega por SSH. Sin clave pública: su acceso está en los secretos. */
    addSsh(name: string, platform: string, address: string): TeamComputer {
      const id = newId("eqp");
      run(
        qb.insertInto("team_computers").values({
          id,
          name,
          platform,
          public_key: "",
          agent_access: 0,
          created_at: now(),
          transport: "ssh",
          address,
        }),
      );
      const r = one(qb.selectFrom("team_computers").selectAll().where("id", "=", id));
      if (!r) throw new Error("equipo no guardado");
      return toComputer(r);
    },
    setAgentAccess(id: string, enabled: boolean): boolean {
      return (
        run(
          qb
            .updateTable("team_computers")
            .set({ agent_access: enabled ? 1 : 0 })
            .where("id", "=", id)
            .where("revoked_at", "is", null),
        ) > 0
      );
    },
    seen(id: string) {
      run(qb.updateTable("team_computers").set({ last_seen_at: now() }).where("id", "=", id));
    },
    /** Revocar borra la clave pública: sin ella el equipo no puede volver a autenticarse. */
    revoke(id: string): boolean {
      return (
        run(
          qb
            .updateTable("team_computers")
            .set({ revoked_at: now(), public_key: "", agent_access: 0 })
            .where("id", "=", id)
            .where("revoked_at", "is", null),
        ) > 0
      );
    },
    log(kind: string, detail: string, computerId?: string) {
      run(
        qb
          .insertInto("team_audit")
          .values({ at: now(), computer_id: computerId ?? null, kind, detail: detail.slice(0, DETAIL_MAX) }),
      );
      const last = one(qb.selectFrom("team_audit").select("n").orderBy("n", "desc").limit(1));
      if (last) run(qb.deleteFrom("team_audit").where("n", "<=", last.n - AUDIT_KEEP));
    },
    audit(computerId?: string, limit = 100): TeamAuditEntry[] {
      let q = qb.selectFrom("team_audit").selectAll().orderBy("n", "desc").limit(limit);
      if (computerId) q = q.where("computer_id", "=", computerId);
      return all(q).map((r) => ({
        n: r.n,
        at: r.at,
        kind: r.kind,
        detail: r.detail,
        ...(r.computer_id ? { computer_id: r.computer_id } : {}),
      }));
    },
  };
}
