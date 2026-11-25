import { z } from "zod";
import { Agent, Job, Organization, Project, Thread } from "./domain.ts";

export const WorkspaceId = z.string().regex(/^w_[a-f0-9]{32}$/);
export const Workspace = z.object({
  id: WorkspaceId,
  name: z.string().trim().min(1).max(80),
  created_at: z.string(),
  state: z.enum(["stopped", "starting", "ready", "error"]),
});
export type Workspace = z.infer<typeof Workspace>;

export const WorkspaceSnapshot = z.object({
  workspace: Workspace,
  agents: z.array(Agent),
  projects: z.array(Project),
  threads: z.array(Thread),
  jobs: z.array(Job),
  organizations: z.record(z.string(), Organization),
});
export type WorkspaceSnapshot = z.infer<typeof WorkspaceSnapshot>;

export const workspaceMethods = {
  "workspaces.list": {
    params: z.object({}).strict(),
    result: z.object({ workspaces: z.array(Workspace) }),
    effect: false,
    access: "human",
  },
  "workspaces.create": {
    params: z.object({ name: z.string().trim().min(1).max(80) }).strict(),
    result: z.object({ workspace: Workspace }),
    effect: true,
    access: "human",
  },
  "workspaces.update": {
    params: z.object({ workspace: WorkspaceId, name: z.string().trim().min(1).max(80) }).strict(),
    result: z.object({ workspace: Workspace }),
    effect: true,
    access: "human",
  },
  "workspaces.snapshot": {
    params: z.object({ workspace: WorkspaceId }).strict(),
    result: WorkspaceSnapshot,
    effect: false,
    access: "human",
  },
} as const;
