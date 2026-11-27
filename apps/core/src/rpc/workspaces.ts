import { unavailable } from "../errors.ts";
import type { Workspaces } from "../workspaces/manager.ts";
import type { Handlers } from "./router.ts";

export function workspaceHandlers(workspaces: Workspaces | undefined) {
  const requireWorkspaces = () => {
    if (!workspaces) throw unavailable("workspaces are managed by the main Colonia");
    return workspaces;
  };
  return {
    "workspaces.list": () => ({ workspaces: workspaces?.list() ?? [], root_name: workspaces?.rootName() }),
    "workspaces.rename_root": ({ name }) => requireWorkspaces().renameRoot(name),
    "workspaces.create": ({ name }) => ({ workspace: requireWorkspaces().create(name) }),
    "workspaces.update": ({ workspace, name }) => ({ workspace: requireWorkspaces().rename(workspace, name) }),
    "workspaces.snapshot": ({ workspace }) => requireWorkspaces().snapshot(workspace),
  } satisfies Pick<
    Handlers,
    "workspaces.list" | "workspaces.create" | "workspaces.update" | "workspaces.snapshot" | "workspaces.rename_root"
  >;
}
