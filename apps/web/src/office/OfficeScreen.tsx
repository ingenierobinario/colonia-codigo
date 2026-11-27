import type { Agent, Workspace } from "@colonia/protocol";
import { secureRequestKey } from "@colonia/protocol/client";
import { Button, Dialog, Field, Input } from "@colonia/ui";
import { type SetStateAction, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Drawer } from "../common/Drawer.tsx";
import { DEFAULT_PID } from "../data/identity.ts";
import { useOrgs } from "../data/org.ts";
import { useData } from "../data/state.ts";
import { workspacePath } from "../data/workspaceContext.ts";
import { createWorkspace, listWorkspaces, useWorkspaceName } from "../data/workspaces.ts";
import { useT } from "../i18n/index.ts";
import { Office3D } from "../lazy.ts";
import { go } from "../shell/nav.ts";
import { officeActivity } from "./activity.ts";
import { OfficeHeading, OfficeStatus, OfficeToolbar, OfficeZoom, WorkspaceTabs } from "./OfficeControls.tsx";
import { OfficeScene, officeRooms } from "./OfficeScene.tsx";
import { RenameWorkspace } from "./RenameWorkspace.tsx";
import { useWorkspace } from "./useWorkspace.ts";
import "./office.css";

export function OfficeScreen() {
  const t = useT();
  const { workspaces, setWorkspaces, rootName, setRootName, directoryError, retry, setRetry } = useOfficeDirectory();
  const [selected, setSelected] = useState("");
  const [project, setProject] = useState("");
  const [query, setQuery] = useState("");
  const [list, setList] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [creating, setCreating] = useState(false);
  const businessName = useWorkspaceName();
  const [renaming, setRenaming] = useState<{ id: string; name: string }>();
  const [chat, setChat] = useState<{ agent: Agent; workspace: string; thread?: string }>();
  const agents = useData((s) => s.agents);
  const projects = useData((s) => s.projects);
  const threads = useData((s) => s.threads);
  const jobs = useData((s) => s.jobs.running);
  const connected = useData((s) => s.connection === "online");
  const ready = useData((s) => s.ready);
  const base = useData((s) => s.base.name);
  const pids = useMemo(() => (selected ? [] : [DEFAULT_PID, ...projects.map((p) => p.id)]), [projects, selected]);
  const orgs = useOrgs(pids);
  const remote = useWorkspace(selected, retry);
  const people = selected ? (remote.snapshot?.agents ?? []) : Object.values(agents);
  const visibleProjects = selected ? (remote.snapshot?.projects ?? []) : projects;
  const conversations = selected ? (remote.snapshot?.threads ?? []) : Object.values(threads);
  const online = selected ? remote.online : connected;
  const activity = officeActivity(people, selected ? (remote.snapshot?.jobs ?? []) : jobs, conversations, online);
  const rooms = officeRooms(
    people,
    visibleProjects,
    selected ? (remote.snapshot?.organizations ?? {}) : orgs,
    t("office.general"),
    selected ? (workspaces.find((w) => w.id === selected)?.name ?? "") : base,
  ).filter((room) => !project || room.project === project);
  const openAgent = (agent: Agent) => {
    const current =
      activity.get(agent.id)?.threadId ??
      conversations
        .filter((thread) => !thread.archived && !thread.parent_id && thread.agent_ids.includes(agent.id))
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0]?.id;
    setChat({
      agent,
      workspace: selected || workspacePath.split("/").at(-1) || "",
      ...(current ? { thread: current } : {}),
    });
  };
  const openTeam = (id: string) => {
    if (!selected) go.project(id, "team");
    else location.assign(`/workspaces/${selected}/#project=${encodeURIComponent(id)}&tab=team`);
  };
  const loading = selected ? !remote.snapshot && !remote.failed : !ready;
  return (
    <section className="virtual-office">
      <OfficeHeading
        manage={Boolean(workspacePath)}
        onCreate={() => (workspacePath ? location.assign("/#view=office") : setCreating(true))}
      />
      <WorkspaceTabs
        workspaces={workspaces}
        selected={selected}
        online={online}
        rootName={rootName || businessName}
        onRename={() =>
          setRenaming({
            id: selected || workspacePath.split("/").at(-1) || "",
            name: selected
              ? (workspaces.find((w) => w.id === selected)?.name ?? "")
              : rootName || businessName || t("office.default"),
          })
        }
        onSelect={(id) => {
          setSelected(id);
          setProject("");
          setChat(undefined);
        }}
      />
      <OfficeToolbar
        project={project}
        projects={visibleProjects}
        base={selected ? (workspaces.find((w) => w.id === selected)?.name ?? base) : base}
        query={query}
        list={list}
        onProject={setProject}
        onQuery={setQuery}
        onList={setList}
      />
      <OfficeStatus
        online={online}
        people={people.length}
        working={[...activity.values()].filter((s) => s.presence === "working").length}
        waiting={[...activity.values()].filter((s) => s.presence === "waiting").length}
        onOpen={() => (selected ? location.assign(`/workspaces/${selected}/`) : go.inbox())}
      />
      {directoryError || (remote.failed && selected) ? (
        <div className="office-feedback" role="alert">
          <p>{t("office.failed")}</p>
          <Button onClick={() => setRetry((n) => n + 1)}>{t("office.retry")}</Button>
        </div>
      ) : null}
      {loading ? (
        <div className="office-feedback" role="status">
          {t("office.loading")}
        </div>
      ) : (
        <div className={`office-viewport${list ? "" : " is-3d"}`}>
          {query &&
          !rooms.some((room) =>
            room.agents.some((agent) => agent.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())),
          ) ? (
            <p className="office-feedback" role="status">
              {t("office.noResults")}
            </p>
          ) : list ? (
            <OfficeScene
              rooms={rooms}
              activity={activity}
              query={query}
              list={list}
              onAgent={openAgent}
              onTeam={openTeam}
            />
          ) : (
            <Suspense
              fallback={
                <div className="office-feedback" role="status">
                  {t("office.loading")}
                </div>
              }
            >
              <Office3D
                rooms={rooms}
                activity={activity}
                query={query}
                zoom={zoom}
                onAgent={openAgent}
                onTeam={openTeam}
              />
            </Suspense>
          )}
        </div>
      )}
      {!list && <OfficeZoom value={zoom} onChange={setZoom} />}
      {renaming && (
        <RenameWorkspace
          workspace={renaming.id}
          initialName={renaming.name}
          onClose={() => setRenaming(undefined)}
          onSaved={(name) => {
            if (renaming.id && !workspacePath)
              setWorkspaces((current) =>
                current.map((workspace) => (workspace.id === renaming.id ? { ...workspace, name } : workspace)),
              );
            else setRootName(name);
            setRenaming(undefined);
          }}
        />
      )}
      {creating && (
        <CreateWorkspace
          onClose={() => setCreating(false)}
          onCreated={(workspace) => {
            setWorkspaces((current) => [...current, workspace]);
            setSelected(workspace.id);
            setProject("");
            setChat(undefined);
            setCreating(false);
          }}
        />
      )}
      {chat && <OfficeChatDrawer chat={chat} onClose={() => setChat(undefined)} />}
    </section>
  );
}

function CreateWorkspace({ onClose, onCreated }: { onClose: () => void; onCreated: (workspace: Workspace) => void }) {
  const t = useT();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const pending = useRef(false);
  const key = useRef(secureRequestKey());
  const submit = async () => {
    if (pending.current || !name.trim()) return;
    pending.current = true;
    setBusy(true);
    setError(false);
    try {
      onCreated((await createWorkspace(name.trim(), key.current)).workspace);
    } catch {
      setError(true);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      title={t("office.newWorkspace")}
      description={t("office.workspaceHint")}
      closeLabel={t("common.close")}
      footer={
        <Button disabled={busy || !name.trim()} onClick={() => void submit()}>
          {busy ? t("common.loading") : t("office.create")}
        </Button>
      }
    >
      <Field label={t("office.workspaceName")}>
        <Input
          autoFocus
          maxLength={80}
          value={name}
          disabled={busy || error}
          onChange={(event) => setName(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void submit();
            }
          }}
        />
      </Field>
      {error && <p role="alert">{t("office.failed")}</p>}
    </Dialog>
  );
}

function useOfficeDirectory() {
  const revision = useRef(0);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [retry, setRetry] = useState(0);
  const [rootName, setRootName] = useState("");
  const [directoryError, setDirectoryError] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the retry button requests a fresh directory after an error.
  useEffect(() => {
    let active = true;
    const requestedRevision = revision.current;
    void listWorkspaces()
      .then((result) => {
        if (active && requestedRevision === revision.current) {
          setWorkspaces(result.workspaces);
          if (!workspacePath) setRootName(result.root_name ?? "");
          setDirectoryError(false);
        }
      })
      .catch(() => {
        if (active && requestedRevision === revision.current) setDirectoryError(true);
      });
    return () => {
      active = false;
    };
  }, [retry]);
  return {
    workspaces,
    rootName,
    directoryError,
    retry,
    setRetry,
    setWorkspaces: (next: SetStateAction<Workspace[]>) => {
      revision.current++;
      setWorkspaces(next);
      setRetry((value) => value + 1);
    },
    setRootName: (next: string) => {
      revision.current++;
      setRootName(next);
      setRetry((value) => value + 1);
    },
  };
}

function OfficeChatDrawer({
  chat,
  onClose,
}: {
  chat: { agent: Agent; workspace: string; thread?: string };
  onClose: () => void;
}) {
  const t = useT();
  return (
    <Drawer
      className="office-drawer"
      label={t("office.chat", { name: chat.agent.name })}
      title={chat.agent.name}
      onClose={onClose}
    >
      <iframe
        title={t("office.chat", { name: chat.agent.name })}
        src={`${chat.workspace ? `/workspaces/${chat.workspace}` : ""}/?${new URLSearchParams({ officeChat: chat.agent.id, ...(chat.thread ? { thread: chat.thread } : {}) })}`}
        key={`${chat.workspace}:${chat.agent.id}:${chat.thread ?? "new"}`}
      />
    </Drawer>
  );
}
