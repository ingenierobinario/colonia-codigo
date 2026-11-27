import { ColoniaClient } from "@colonia/protocol/client";
import { useEffect, useState } from "react";
import { access, client } from "./client.ts";
import { workspacePath } from "./workspaceContext.ts";

export const listWorkspaces = () => client.call("workspaces.list", {});
export const createWorkspace = (name: string, key: string) => client.call("workspaces.create", { name }, key);
export const renameWorkspace = (workspace: string, name: string, key: string) =>
  workspace
    ? (workspacePath
        ? new ColoniaClient({ url: location.origin, ...(access.token ? { token: access.token } : {}) })
        : client
      ).call("workspaces.update", { workspace, name }, key)
    : client.call("workspaces.rename_root", { name }, key);

export function useWorkspaceName() {
  const [name, setName] = useState("");
  useEffect(() => {
    if (!workspacePath) return;
    const controller = new AbortController();
    const root = new ColoniaClient({
      url: location.origin,
      ...(access.token ? { token: access.token } : {}),
    }).withSignal(controller.signal);
    void root
      .call("workspaces.list", {})
      .then(({ workspaces }) => {
        if (!controller.signal.aborted)
          setName(workspaces.find((entry) => workspacePath.endsWith(`/${entry.id}`))?.name ?? "");
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  return name;
}
