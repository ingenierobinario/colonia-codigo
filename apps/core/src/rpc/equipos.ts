// Mis equipos: el panel y las herramientas de los agentes. Aquí no se salta ninguna puerta: el acceso del agente lo
// activa el dueño en Colonia, y la aprobación (por sesión, o «siempre») la da el dueño en el propio equipo.
import type { Equipo, EquipoAuditEntry, EquipoPlatform } from "@colonia/protocol";
import type { Store } from "../domain/store.ts";
import type { TeamAuditEntry, TeamComputer } from "../domain/team-computers.ts";
import type { EquipoAgent } from "../equipos/agent.ts";
import type { Approval } from "../equipos/approval.ts";
import type { FoundEquipo } from "../equipos/discovery.ts";
import type { Principal } from "../equipos/principal.ts";
import { type RemoteOs, type SshEquipos, shQuote } from "../equipos/ssh.ts";
import { badRequest, notFound, unauthorized, unavailable } from "../errors.ts";
import type { Handlers } from "./router.ts";

export type EquiposDeps = {
  principal: Principal;
  agent: EquipoAgent;
  approval: Approval;
  /** EQUIPOS-SIN-AGENTE-1: equipos por SSH y la búsqueda en la red. */
  ssh: SshEquipos;
  discover: () => Promise<{ equipos: FoundEquipo[]; tailscale: boolean }>;
};

const platformOf = (p: string): EquipoPlatform =>
  p === "win32" || p === "windows"
    ? "windows"
    : p === "darwin" || p === "macos"
      ? "macos"
      : p === "linux"
        ? "linux"
        : "other";

const remoteOs = (p: string): RemoteOs => {
  const v = platformOf(p);
  return v === "macos" ? "macos" : v;
};

export function equiposHandlers(store: Store, d: EquiposDeps) {
  // EQUIPOS-SIN-AGENTE-1: un equipo SSH está «conectado» si la última vez que se le habló respondió.
  const sshAlive = new Map<string, boolean>();
  const sshBusy = new Map<string, number>();
  const isSsh = (c: TeamComputer) => c.transport === "ssh";
  const view = (c: TeamComputer): Equipo => ({
    id: c.id,
    name: c.name,
    platform: platformOf(c.platform),
    created_at: c.created_at,
    ...(c.last_seen_at ? { last_seen_at: c.last_seen_at } : {}),
    connected: isSsh(c) ? (sshAlive.get(c.id) ?? d.ssh.has(c.id)) : d.principal.connected(c.id),
    agent_access: c.agent_access,
    in_use: isSsh(c) ? (sshBusy.get(c.id) ?? 0) > 0 : d.principal.inUse(c.id),
    via: isSsh(c) ? "ssh" : "colonia",
    ...(c.address ? { address: c.address } : {}),
  });
  /** Lo mismo que principal.request para un equipo SSH: interruptor del dueño, auditoría y estado. */
  async function viaSsh<T>(c: TeamComputer, what: string, who: { name: string }, fn: () => Promise<T>): Promise<T> {
    if (!c.agent_access) throw unauthorized(`el acceso de los agentes a «${c.name}» está desactivado`);
    store.team.log("peticion", `${who.name}: ${what}`, c.id);
    sshBusy.set(c.id, (sshBusy.get(c.id) ?? 0) + 1);
    try {
      const r = await fn();
      sshAlive.set(c.id, true);
      store.team.seen(c.id);
      store.team.log("hecho", `${what}: correcto`, c.id);
      return r;
    } catch (e) {
      const msg = (e as Error).message;
      if (!/archivo|carpeta/.test(msg)) sshAlive.set(c.id, false);
      store.team.log("fallo", `${what}: ${msg}`, c.id);
      throw unavailable(msg);
    } finally {
      sshBusy.set(c.id, (sshBusy.get(c.id) ?? 1) - 1);
    }
  }
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
    "equipos.discover": async () => {
      const r = await d.discover();
      // Lo ya añadido no se ofrece otra vez.
      const known = new Set(store.team.list().flatMap((c) => (c.address ? [c.address] : [])));
      return { ...r, equipos: r.equipos.filter((f) => !known.has(f.ip)) };
    },
    "equipos.connect": async (a) => {
      const target = {
        host: a.host,
        port: a.port ?? 22,
        user: a.user,
        ...(a.password ? { password: a.password } : {}),
        ...(a.key ? { key: a.key } : {}),
      };
      const probe = await d.ssh.probe(target);
      if (!probe.ok) throw badRequest(probe.error);
      const platform = probe.os === "macos" ? "darwin" : probe.os;
      const c = store.team.addSsh(a.name || probe.hostname || a.host, platform, a.host);
      try {
        d.ssh.save(c.id, target);
      } catch (e) {
        store.team.revoke(c.id);
        throw unavailable(`no hay un sitio seguro donde guardar la contraseña: ${(e as Error).message}`);
      }
      sshAlive.set(c.id, true);
      store.team.seen(c.id);
      store.team.log("emparejado", `${c.name} conectado por terminal remota (${a.user}@${a.host})`, c.id);
      return view(c);
    },
    "equipos.revoke": ({ id }) => {
      const c = store.team.get(id);
      if (c && isSsh(c)) {
        d.ssh.forget(id);
        sshAlive.delete(id);
        const revoked = store.team.revoke(id);
        if (revoked) store.team.log("revocado", "el dueño lo desconectó desde Colonia", id);
        return { revoked };
      }
      return { revoked: d.principal.revoke(id, "panel") };
    },
    "equipos.audit": ({ id }) => ({ entries: store.team.audit(id).map(entry) }),
    "equipos.run": async (a, ctx) => {
      const c = find(a.equipo);
      if (isSsh(c))
        return viaSsh(c, `ejecutar: ${a.command}`, who(ctx), () =>
          d.ssh.run(c.id, remoteOs(c.platform), a.command, a.cwd, a.timeout_s),
        );
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
      const c = find(a.equipo);
      if (isSsh(c))
        return viaSsh(c, `leer: ${a.path}`, who(ctx), () => d.ssh.readFile(c.id, remoteOs(c.platform), a.path));
      const r = await d.principal.request(find(a.equipo).id, { op: "read", path: a.path }, who(ctx));
      if (!("content_base64" in r)) throw badRequest("respuesta inesperada del equipo");
      return r;
    },
    "equipos.list_files": async (a, ctx) => {
      const c = find(a.equipo);
      if (isSsh(c))
        return viaSsh(c, `listar: ${a.path}`, who(ctx), () => d.ssh.listFiles(c.id, remoteOs(c.platform), a.path));
      // Un equipo con Colonia: se lista con un comando, con la misma aprobación en el propio equipo.
      const win = platformOf(c.platform) === "windows";
      const r = await d.principal.request(
        c.id,
        {
          op: "run",
          command: win ? `dir /a "${a.path.replace(/"/g, "")}"` : `ls -lA -- ${shQuote(a.path)}`,
        },
        who(ctx),
      );
      if (!("exit_code" in r)) throw badRequest("respuesta inesperada del equipo");
      return { output: r.output, truncated: r.truncated };
    },
    "equipos.write_file": async (a, ctx) => {
      if (isSsh(find(a.equipo)))
        throw badRequest("escribir archivos aún no está disponible en equipos por terminal remota");
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
