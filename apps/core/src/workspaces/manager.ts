import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Workspace, WorkspaceSnapshot } from "@colonia/protocol";
import { ColoniaClient } from "@colonia/protocol/client";
import { unavailable } from "../errors.ts";
import type { Log } from "../log.ts";
import { stopTree } from "../processes.ts";
import { workspaceEnvironment } from "./environment.ts";
import { workspaceRegistry } from "./registry.ts";

export type WorkspaceTarget = { url: string; token: string; client: ColoniaClient };
type Worker = { child: ChildProcess; ready: Promise<WorkspaceTarget>; state: Workspace["state"] };

export function createWorkspaces(deps: {
  home: string;
  origin: () => string;
  env: NodeJS.ProcessEnv;
  fileSecrets: boolean;
  log: Log;
}) {
  const registry = workspaceRegistry(deps.home);
  const workers = new Map<string, Worker>();
  let closing = false;
  const shown = (entry: Omit<Workspace, "state">): Workspace => ({
    ...entry,
    state: workers.get(entry.id)?.state ?? "stopped",
  });

  function start(id: string): Promise<WorkspaceTarget> {
    registry.get(id);
    if (closing) return Promise.reject(unavailable("workspaces are stopping"));
    const existing = workers.get(id);
    if (existing && existing.state !== "error") return existing.ready;
    if (existing && existing.child.exitCode === null && existing.child.signalCode === null)
      return Promise.reject(unavailable("workspace is still stopping"));
    const home = path.join(deps.home, "workspaces", id);
    for (const directory of [home, path.join(home, "account"), path.join(home, "tmp")])
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const token = randomBytes(32).toString("hex");
    const child = spawn(
      process.execPath,
      ["--disable-warning=ExperimentalWarning", path.join(import.meta.dirname, "worker.ts")],
      {
        cwd: home,
        env: {
          ...workspaceEnvironment(
            deps.env,
            home,
            token,
            `${deps.origin()}/workspaces/${id}`,
            Boolean(process.versions.electron),
          ),
          ...(deps.fileSecrets ? { COLONIA_SECRETS: "file" } : {}),
        },
        stdio: ["ignore", "ignore", "ignore", "ipc"],
        windowsHide: true,
        detached: process.platform !== "win32",
      },
    );
    let resolveReady: (target: WorkspaceTarget) => void;
    let rejectReady: (error: Error) => void;
    const ready = new Promise<WorkspaceTarget>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    const worker: Worker = { child, ready, state: "starting" };
    let restart = false;
    workers.set(id, worker);
    const fail = () => {
      clearTimeout(deadline);
      worker.state = "error";
      rejectReady(unavailable("workspace could not start"));
    };
    const deadline = setTimeout(() => {
      fail();
      if (child.pid) void stopTree(child.pid);
    }, 60_000);
    child.once("error", fail);
    child.once("exit", () => {
      fail();
      if (!closing) deps.log.warn({ workspace: id }, "workspace stopped");
      if (!closing && restart)
        void start(id).catch(() => deps.log.warn({ workspace: id }, "workspace did not restart"));
    });
    child.on("message", (message: unknown) => {
      if (message && typeof message === "object" && "type" in message && message.type === "restart") {
        restart = true;
        return;
      }
      if (!message || typeof message !== "object" || !("url" in message) || typeof message.url !== "string") return;
      let url: URL;
      try {
        url = new URL(message.url);
      } catch {
        return;
      }
      if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port) return;
      if (worker.state !== "starting") return;
      clearTimeout(deadline);
      worker.state = "ready";
      resolveReady({ url: url.origin, token, client: new ColoniaClient({ url: url.origin, token }) });
    });
    return ready;
  }

  return {
    async resume() {
      for (const entry of registry.list()) {
        if (closing) return;
        try {
          await start(entry.id);
        } catch {
          deps.log.warn({ workspace: entry.id }, "workspace did not resume");
        }
      }
    },
    list: () => registry.list().map(shown),
    rootName: () => registry.rootName(),
    renameRoot: (name: string) => registry.renameRoot(name),
    create: (name: string) => shown(registry.create(name)),
    rename: (id: string, name: string) => shown(registry.rename(id, name)),
    target: start,
    async snapshot(id: string): Promise<WorkspaceSnapshot> {
      const { client } = await start(id);
      const [agents, projects, threads, jobs] = await Promise.all([
        client.call("agents.list", {}),
        client.call("projects.list", {}),
        client.call("threads.list", { delegated: 5 }),
        client.call("jobs.list", { finished: 0 }),
      ]);
      const organizations = await Promise.all(
        [undefined, ...projects.projects.map((project) => project.id)].map(
          async (project) => [project ?? "~default", await client.call("org.get", project ? { project } : {})] as const,
        ),
      );
      return {
        workspace: shown(registry.get(id)),
        agents: agents.agents,
        projects: projects.projects,
        threads: threads.threads,
        jobs: jobs.running,
        organizations: Object.fromEntries(organizations),
      };
    },
    async close() {
      closing = true;
      await Promise.all(
        [...workers.values()].map(async ({ child }) => {
          if (child.exitCode !== null || child.signalCode !== null) return;
          await new Promise<void>((resolve) => {
            const deadline = setTimeout(() => {
              if (child.pid) void stopTree(child.pid).then(resolve);
              else resolve();
            }, 10_000);
            child.once("exit", () => {
              clearTimeout(deadline);
              resolve();
            });
            if (child.connected) child.send("stop");
            else if (child.pid) void stopTree(child.pid).then(resolve);
          });
        }),
      );
      workers.clear();
    },
  };
}

export type Workspaces = ReturnType<typeof createWorkspaces>;
