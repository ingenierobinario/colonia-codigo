// Mis equipos: el panel y las herramientas de los agentes. Aquí no se salta ninguna puerta: el acceso del agente lo
// activa el dueño en Colonia, y la aprobación (por sesión, o «siempre») la da el dueño en el propio equipo.
import type { Equipo, EquipoAuditEntry, EquipoPlatform } from "@colonia/protocol";
import type { Store } from "../domain/store.ts";
import type { TeamAuditEntry, TeamComputer } from "../domain/team-computers.ts";
import type { EquipoAgent } from "../equipos/agent.ts";
import type { Approval } from "../equipos/approval.ts";
import type { Principal } from "../equipos/principal.ts";
import { badRequest, notFound } from "../errors.ts";
import type { Handlers } from "./router.ts";

export type EquiposDeps = { principal: Principal; agent: EquipoAgent; approval: Approval };

const platformOf = (p: string): EquipoPlatform =>
  p === "win32" || p === "windows"
    ? "windows"
    : p === "darwin" || p === "macos"
      ? "macos"
      : p === "linux"
        ? "linux"
        : "other";

export function equiposHandlers(store: Store, d: EquiposDeps) {
  const view = (c: TeamComputer): Equipo => ({
    id: c.id,
    name: c.name,
    platform: platformOf(c.platform),
    created_at: c.created_at,
    ...(c.last_seen_at ? { last_seen_at: c.last_seen_at } : {}),
    connected: d.principal.connected(c.id),
    agent_access: c.agent_access,
    in_use: d.principal.inUse(c.id),
  });
  const entry = (e: TeamAuditEntry): EquipoAuditEntry => ({
    n: e.n,
    at: e.at,
    ...(e.computer_id ? { equipo_id: e.computer_id } : {}),
    kind: e.kind,
    detail: e.detail,
  });
  /** Por id o por nombre: así lo escribe un agente. */
  const find = (ref: string): TeamComputer => {
    const all = store.team.list();
    const wanted = ref.trim().toLowerCase();
    const hit = all.find((c) => c.id === ref) ?? all.find((c) => c.name.toLowerCase() === wanted);
    if (!hit)
      throw notFound(`equipo «${ref}» (los emparejados son: ${all.map((c) => c.name).join(", ") || "ninguno"})`);
    return hit;
  };
  const who = (ctx: { agent?: { id: string; thread_id: string } | undefined; session?: string | undefined }) => ({
    session: ctx.agent?.thread_id ?? `panel:${ctx.session ?? "directo"}`,
    name: (ctx.agent && store.agents.get(ctx.agent.id)?.name) || "Colonia",
  });

  return {
    "equipos.list": () => ({ equipos: store.team.list().map(view) }),
    "equipos.pair_start": () => d.principal.pairStart(),
    "equipos.pair_cancel": () => ({ canceled: d.principal.pairCancel() }),
    "equipos.set_access": ({ id, enabled }) => {
      const c = store.team.get(id);
      if (!c) throw notFound("equipo");
      store.team.setAgentAccess(id, enabled);
      store.team.log(
        "acceso",
        enabled ? "el dueño permitió el uso por agentes" : "el dueño quitó el uso por agentes",
        id,
      );
      return view({ ...c, agent_access: enabled });
    },
    "equipos.revoke": ({ id }) => ({ revoked: d.principal.revoke(id, "panel") }),
    "equipos.audit": ({ id }) => ({ entries: store.team.audit(id).map(entry) }),
    "equipos.run": async (a, ctx) => {
      const r = await d.principal.request(
        find(a.equipo).id,
        {
          op: "run",
          command: a.command,
          ...(a.cwd ? { cwd: a.cwd } : {}),
          ...(a.timeout_s ? { timeout_s: a.timeout_s } : {}),
        },
        who(ctx),
      );
      if (!("exit_code" in r)) throw badRequest("respuesta inesperada del equipo");
      return r;
    },
    "equipos.read_file": async (a, ctx) => {
      const r = await d.principal.request(find(a.equipo).id, { op: "read", path: a.path }, who(ctx));
      if (!("content_base64" in r)) throw badRequest("respuesta inesperada del equipo");
      return r;
    },
    "equipos.write_file": async (a, ctx) => {
      const r = await d.principal.request(
        find(a.equipo).id,
        { op: "write", path: a.path, content_base64: a.content_base64 },
        who(ctx),
      );
      if (!("written" in r)) throw badRequest("respuesta inesperada del equipo");
      return r;
    },
    "equipos.local_state": () => {
      const s = d.agent.state();
      return {
        paired: Boolean(s),
        ...(s ? { principal: { url: s.principal.url, fingerprint: s.principal.fingerprint }, name: s.name } : {}),
        connected: d.agent.connected(),
        always_allow: d.approval.always(),
        locked: d.agent.locked(),
        needs_passphrase: d.agent.needsPassphrase(),
        in_use: d.agent.inUse(),
        pending: d.approval.pending(),
        audit: d.agent.audit().map((l, i) => ({ n: i, at: l.at, kind: l.kind, detail: l.detail })),
      };
    },
    "equipos.local_pair": async (a) => {
      const out = await d.agent.pair({
        url: a.url,
        fingerprint: a.fingerprint,
        code: a.code,
        ...(a.passphrase ? { passphrase: a.passphrase } : {}),
        ...(a.name ? { name: a.name } : {}),
      });
      d.agent.start();
      return out;
    },
    "equipos.local_unlock": ({ passphrase }) => ({ unlocked: d.agent.unlock(passphrase) }),
    "equipos.local_decide": ({ id, allow }) => ({ decided: d.approval.decide(id, allow) }),
    "equipos.local_always": ({ enabled }) => ({ always_allow: d.approval.setAlways(enabled) && enabled }),
    "equipos.local_disconnect": async () => ({ disconnected: await d.agent.disconnect() }),
  } satisfies Partial<Handlers>;
}
