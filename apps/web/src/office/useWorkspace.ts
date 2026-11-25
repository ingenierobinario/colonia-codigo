import type { CoreEvent, WorkspaceSnapshot } from "@colonia/protocol";
import { ColoniaClient, type ColoniaSocket } from "@colonia/protocol/client";
import { useEffect, useState } from "react";
import { access, client } from "../data/client.ts";

export function workspaceClient(id: string): ColoniaClient {
  return new ColoniaClient({
    url: `${location.origin}/workspaces/${id}`,
    socketAuth: "subprotocol",
    ...(access.token ? { token: access.token } : {}),
  });
}

/** The remote business stays in its own snapshot; IDs are never inserted into the current core's store. */
export function useWorkspace(id: string, retry: number) {
  const [value, setValue] = useState<{ id: string; snapshot?: WorkspaceSnapshot; online: boolean; failed: boolean }>({
    id,
    online: false,
    failed: false,
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: retry tears down the previous connection before starting another attempt.
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    const parent = client.withSignal(controller.signal);
    const remote = workspaceClient(id).withSignal(controller.signal);
    let socket: ColoniaSocket | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let jobsTimer: ReturnType<typeof setTimeout> | undefined;
    let revision = 0;
    let jobsRevision = 0;
    let loading = false;
    let reload = false;
    setValue({ id, online: false, failed: false });
    const snapshot = async () => {
      if (loading) {
        reload = true;
        return;
      }
      loading = true;
      const before = revision;
      try {
        const result = await parent.call("workspaces.snapshot", { workspace: id });
        if (!controller.signal.aborted && revision === before)
          setValue({ id, snapshot: result, online: true, failed: false });
        else reload = true;
      } catch {
        if (!controller.signal.aborted) setValue((old) => ({ ...old, id, online: false, failed: true }));
      } finally {
        loading = false;
        if (reload && !controller.signal.aborted) {
          reload = false;
          void snapshot();
        }
      }
    };
    const connect = async () => {
      try {
        // First request starts a stopped worker before the normal socket handshake deadline begins.
        await snapshot();
        if (controller.signal.aborted) return;
        socket = await remote.connect();
        socket.onEvent((frame) => {
          const payload = frame.payload as CoreEvent;
          if (["thread.updated", "team.updated", "thread.deleted", "run.updated", "job.updated"].includes(payload.type))
            revision++;
          if (payload.type === "thread.updated")
            setValue((old) =>
              old.snapshot
                ? {
                    ...old,
                    snapshot: {
                      ...old.snapshot,
                      threads: [
                        ...old.snapshot.threads.filter((thread) => thread.id !== payload.thread.id),
                        payload.thread,
                      ],
                    },
                  }
                : old,
            );
          if (payload.type === "team.updated" || payload.type === "thread.deleted") void snapshot();
          if ((payload.type === "run.updated" || payload.type === "job.updated") && !jobsTimer)
            jobsTimer = setTimeout(() => {
              jobsTimer = undefined;
              const request = ++jobsRevision;
              void remote
                .call("jobs.list", { finished: 0 })
                .then(({ running }) => {
                  if (!controller.signal.aborted && request === jobsRevision)
                    setValue((old) => (old.snapshot ? { ...old, snapshot: { ...old.snapshot, jobs: running } } : old));
                })
                .catch(() => {});
            }, 400);
        });
        await snapshot();
        await socket.closed;
      } catch {
        // Keep the last picture but mark presence offline until a new authenticated connection succeeds.
      }
      if (!controller.signal.aborted) {
        setValue((old) => ({ ...old, online: false }));
        timer = setTimeout(() => void connect(), 3000);
      }
    };
    void connect();
    return () => {
      controller.abort();
      socket?.close();
      clearTimeout(timer);
      clearTimeout(jobsTimer);
    };
  }, [id, retry]);
  return value.id === id ? value : { id, online: false, failed: false };
}
