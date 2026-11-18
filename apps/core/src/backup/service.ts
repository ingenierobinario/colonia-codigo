// COPIA-COMPLETA-1 · El servicio de la copia completa (DECISIONS.md#d-192): una sola operación a la vez, que corre de
// fondo mientras la tarjeta de Ajustes pregunta cómo va.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { BackupFile, BackupInspect, BackupRestored, BackupStatus, BackupWhy } from "@colonia/protocol";
import type { Db } from "../db/db.ts";
import { samePath, writeAtomic } from "../paths.ts";
import type { Secrets } from "../secrets.ts";
import { RESULT_KEY } from "./apply.ts";
import { ArchiveError } from "./archive.ts";
import { COPY_EXT, copyName, createCopy } from "./create.ts";
import { factsOf, PRIVATE_PROJECT_FORMAT } from "./inventory.ts";
import { createProjectCopy, restoreProjectCopy } from "./project-copy.ts";
import { inspectCopy, type RestoreMode, relinkOf, stageRestore, usualFolders } from "./restore.ts";

export type BackupDeps = {
  home: string;
  db: Db;
  secrets: Secrets;
  version: string;
  homeId: string;
  /** Reinicia Colonia; ausente cuando nadie la volvería a arrancar. */
  restart?: (() => void) | undefined;
  projectImported?: ((id: string) => void) | undefined;
  warn?: (msg: string) => void;
  now?: () => Date;
};

export type Backup = ReturnType<typeof createBackup>;

type Job = Omit<BackupStatus, "folder" | "restored">;

const whyOf = (err: unknown): BackupWhy => (err instanceof ArchiveError ? err.why : "failed");

export function createBackup(deps: BackupDeps) {
  let job: Job = { state: "idle", done: 0, total: 0 };
  let running: Promise<void> | undefined;
  const now = () => (deps.now ?? (() => new Date()))();

  // Esta preferencia pertenece al ordenador. La carpeta copias se excluye del traslado.
  const preference = path.join(deps.home, "copias", "destino.json");
  let previous: string | undefined;
  try {
    const folder: unknown = JSON.parse(fs.readFileSync(preference, "utf8"));
    if (typeof folder === "string" && path.isAbsolute(folder)) previous = folder;
  } catch {
    // Una instalación nueva todavía no tiene destino elegido.
  }
  const defaultFolder = () => {
    if (previous) return previous;
    const downloads = path.join(os.homedir(), "Downloads");
    return fs.existsSync(downloads) ? downloads : os.homedir();
  };
  const restored = (): BackupRestored | undefined => {
    const row = deps.db.prepare("SELECT value FROM meta WHERE key = ?").get(RESULT_KEY) as
      | { value: string }
      | undefined;
    if (!row) return undefined;
    try {
      return JSON.parse(row.value) as BackupRestored;
    } catch {
      return undefined;
    }
  };
  const status = (): BackupStatus => {
    const r = restored();
    return { ...job, folder: defaultFolder(), ...(r ? { restored: r } : {}) };
  };
  const local = () => factsOf(path.join(deps.home, "colonia.db"), deps.home).summary;
  // Un Colonia recién instalado ya trae su chat de inicio vacío y sus agentes de fábrica: eso no es «tener datos».
  const hasData = (s: ReturnType<typeof local>) =>
    s.messages +
      s.projects +
      s.flows +
      s.channels +
      s.memories +
      s.browsers +
      s.apps +
      s.providers +
      s.people +
      s.routines >
    0;
  const createDeps = () => ({
    home: deps.home,
    db: deps.db,
    secrets: deps.secrets,
    version: deps.version,
    homeId: deps.homeId,
    ...(deps.now ? { now: deps.now } : {}),
  });
  const start = (first: Job, work: () => Promise<Partial<Job>>) => {
    job = first;
    running = work()
      .then((end) => {
        job = { ...job, state: "done", ...end };
      })
      .catch((err) => {
        deps.warn?.(`copia: ${err instanceof Error ? err.message : String(err)}`);
        job = { state: "failed", ...(first.kind ? { kind: first.kind } : {}), done: 0, total: 0, why: whyOf(err) };
      });
  };
  const busy = (): BackupStatus | undefined =>
    job.state === "working" ? { ...status(), state: "failed", why: "busy" } : undefined;

  return {
    status,
    /** Espera a que acabe lo que esté en marcha (para las pruebas y para cerrar). */
    settled: async () => {
      await running;
    },
    list(): BackupFile[] {
      const out: BackupFile[] = [];
      // La carpeta de la copia recién creada también cuenta, aunque no sea una de las de siempre.
      const made = job.kind === "create" && job.file ? [path.dirname(job.file)] : [];
      for (const folder of new Set([...usualFolders(deps.home), ...(previous ? [previous] : []), ...made])) {
        let names: string[] = [];
        try {
          names = fs.readdirSync(folder);
        } catch {}
        for (const name of names) {
          if (!name.endsWith(COPY_EXT)) continue;
          const file = path.join(folder, name);
          try {
            const st = fs.statSync(file);
            if (st.isFile()) out.push({ file, name, folder, size: st.size, modified_at: st.mtime.toISOString() });
          } catch {}
        }
      }
      return out.sort((a, b) => (a.modified_at < b.modified_at ? 1 : -1)).slice(0, 30);
    },
    create(params: {
      folder?: string | undefined;
      password: string;
      include_work?: boolean | undefined;
      project_id?: string | undefined;
    }): BackupStatus {
      const stop = busy();
      if (stop) return stop;
      const folder = params.folder?.trim() || defaultFolder();
      try {
        if (!path.isAbsolute(folder)) throw new Error("relative");
        // Si el proveedor está desconectado, no crear en su lugar una carpeta local.
        if (!previous || !samePath(previous, folder)) fs.mkdirSync(folder, { recursive: true });
        if (!fs.statSync(folder).isDirectory()) throw new Error("folder");
        fs.accessSync(folder, fs.constants.W_OK);
      } catch {
        job = { state: "failed", kind: "create", done: 0, total: 0, why: "folder" };
        return status();
      }
      const file = copyName(folder, params.project_id ? "Colonia-proyecto" : "Colonia-copia", now());
      start({ state: "working", kind: "create", phase: "snapshot", done: 0, total: 0 }, async () => {
        const progress: import("./create.ts").Progress = (phase, done, total) => {
          job = { ...job, phase, done, total };
        };
        const manifest = params.project_id
          ? await createProjectCopy(createDeps(), params.project_id, file, params.password, progress)
          : await createCopy({ ...createDeps(), includeWork: params.include_work }, file, params.password, progress);
        if (params.folder && (!previous || !samePath(previous, folder))) {
          try {
            writeAtomic(preference, JSON.stringify(folder), 0o600);
            previous = folder;
          } catch {
            deps.warn?.("No se pudo recordar la carpeta de copias de este equipo");
          }
        }
        return {
          file,
          summary: manifest.summary,
          ...(manifest.scope ? { scope: manifest.scope } : {}),
          bytes: fs.statSync(file).size,
          done: manifest.bytes,
          total: manifest.bytes,
        };
      });
      return status();
    },
    async inspect(params: { file: string; password: string }): Promise<BackupInspect> {
      const file = params.file.trim();
      if (!path.isAbsolute(file) || !fs.existsSync(file)) return { ok: false, why: "missing" };
      try {
        const m = await inspectCopy(file, params.password);
        const mine = local();
        return {
          ok: true,
          created_at: m.created_at,
          host: m.from.host,
          platform: m.from.platform,
          app_version: m.app_version,
          summary: m.summary,
          ...(m.scope ? { scope: m.scope } : {}),
          keys: m.secrets,
          files: m.files,
          bytes: m.bytes,
          relink: relinkOf(deps.home, m).relink,
          local: mine,
          has_data: hasData(mine),
        };
      } catch (err) {
        return { ok: false, why: whyOf(err) };
      }
    },
    restore(params: {
      file: string;
      password: string;
      mode: RestoreMode;
      destination?: string | undefined;
    }): BackupStatus {
      const stop = busy();
      if (stop) return stop;
      const file = params.file.trim();
      if (!path.isAbsolute(file) || !fs.existsSync(file)) {
        job = { state: "failed", kind: "restore", done: 0, total: 0, why: "missing" };
        return status();
      }
      start({ state: "working", kind: "restore", phase: "reading", done: 0, total: 0 }, async () => {
        // La contraseña se comprueba antes de tocar nada.
        const manifest = await inspectCopy(file, params.password);
        if (manifest.format === PRIVATE_PROJECT_FORMAT) {
          if (params.mode !== "merge" || !manifest.scope) throw new ArchiveError("scope");
          const project = await restoreProjectCopy(
            deps.db,
            deps.home,
            file,
            params.password,
            manifest,
            params.destination,
            (done, total) => {
              job = { ...job, done, total };
            },
          );
          deps.projectImported?.(project.id);
          return {
            imported_project: project,
            scope: manifest.scope,
            summary: manifest.summary,
            done: manifest.bytes,
            total: manifest.bytes,
          };
        }
        if (params.destination) throw new ArchiveError("scope");
        let safety: string | undefined;
        if (hasData(local())) {
          job = { ...job, phase: "safety", done: 0, total: 0 };
          const folder = path.join(deps.home, "copias");
          fs.mkdirSync(folder, { recursive: true });
          safety = copyName(folder, "antes-de-restaurar", now());
          await createCopy(createDeps(), safety, params.password, (_phase, done, total) => {
            job = { ...job, done, total };
          });
        }
        job = { ...job, phase: "reading", done: 0, total: 0 };
        await stageRestore(
          { home: deps.home, secrets: deps.secrets, ...(deps.now ? { now: deps.now } : {}) },
          file,
          params.password,
          params.mode,
          safety,
          (done, total) => {
            job = { ...job, done, total };
          },
        );
        const restart = deps.restart;
        if (restart) setTimeout(restart, 900).unref();
        return { phase: "restart", restart: restart ? "auto" : "manual" };
      });
      return status();
    },
    dismiss(): void {
      deps.db.prepare("DELETE FROM meta WHERE key = ?").run(RESULT_KEY);
    },
  };
}
