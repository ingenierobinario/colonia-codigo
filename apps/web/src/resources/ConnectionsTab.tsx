import type { McpServerStatus } from "@colonia/protocol";
import {
  Button,
  ContextMenu,
  Dialog,
  EmptyState,
  Icons,
  IntegrationIcon,
  integrationBrand,
  MasterDetail,
  type MenuEntry,
  PickRow,
  Tag,
} from "@colonia/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { client } from "../data/client.ts";
import { projectName } from "../data/identity.ts";
import { loadMarks } from "../data/models.ts";
import { notify } from "../data/notices.ts";
import { setMcp, setMcpToolMode, toggleMcp, trustMcp } from "../data/resources.ts";
import { useData } from "../data/state.ts";
import { useLanguage, useT } from "../i18n/index.ts";
import { ConnectorCatalog, ConnectorCatalogDialog } from "./ConnectorCatalog.tsx";
import { ConnectorLogo } from "./ConnectorLogo.tsx";
import { catalogConnector } from "./connectorDirectory.ts";
import { ConnectDialog, describe, type Integration, IntegrationDetail, Tile, where } from "./IntegrationsTab.tsx";
import { mcpDot, STATUS_KEY } from "./labels.ts";
import { McpDetail } from "./McpDetail.tsx";
import { McpDialog } from "./McpDialog.tsx";
import type { TabProps } from "./ResourcesView.tsx";
import { ScopedGroups, useInheritance } from "./ScopedGroups.tsx";

const keyOf = (s: McpServerStatus) => `${s.scope}:${s.project_id ?? ""}:${s.name}`;
/** Every project gets it (an owner's server limited to one project belongs to that project). */
const isGlobal = (s: McpServerStatus) => s.scope === "global" && !s.only;

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
/** The key of a connected account in the list (a server's key always starts with its scope). */
const intKey = (id: string) => `int:${id}`;

/**
 * CONEXIONES-1: Connections, the old «Conectores» and «Integraciones» in one list. The accounts connected once (Gmail,
 * GitHub…) come first, with where they are used and their settings; then every other MCP server, by scope. An account
 * brings its own server: that server is not listed twice. Inside a project: its own and the inherited global ones
 * (each can be turned off here).
 */
export function ConnectionsTab({ projectId, query, scope, adding, setAdding, res, ownOnly }: TabProps) {
  const t = useT();
  const lang = useLanguage();
  const projects = useData((s) => s.projects);
  const registered = useMemo(() => projects.filter((p) => p.path && p.registered !== false), [projects]);
  const [accounts, setAccounts] = useState<Integration[]>();
  /** "Edit" from an account's menu: its detail opens with its form (a new number opens it again). */
  const [editingAccount, setEditingAccount] = useState(0);
  const [custom, setCustom] = useState(false);
  const loadAccounts = useCallback(async () => {
    try {
      setAccounts((await client.call("integrations.list", {})).integrations);
    } catch (e) {
      notify(t("error.load", { error: errText(e) }));
    }
  }, [t]);
  useEffect(() => {
    loadMarks();
    void loadAccounts();
  }, [loadAccounts]);
  const [picked, setPicked] = useState<string>();
  const [editing, setEditing] = useState<McpServerStatus>();
  const [removing, setRemoving] = useState<McpServerStatus>();
  const [testRequest, setTestRequest] = useState(0);
  const [permissionRequest, setPermissionRequest] = useState(0);
  const [permissionServer, setPermissionServer] = useState<string>();
  const [toolReload, setToolReload] = useState(0);
  const [catalog, setCatalog] = useState(false);
  const [permissionsBusy, setPermissionsBusy] = useState(false);
  const all = res.data.servers;
  const linked = (accounts ?? []).filter((i) => i.connected);
  /** The account a global server comes from, if one: it is shown once, as that account. */
  const accountOf = (s: McpServerStatus) =>
    s.scope === "global" && !s.only ? linked.find((i) => i.id === s.name) : undefined;
  const labelOf = (s: McpServerStatus) => accountOf(s)?.label ?? catalogConnector(s.name)?.name ?? s.name;
  const connected = projectId
    ? []
    : linked
        .filter((i) => !query || `${i.label} ${describe(i, t)}`.toLowerCase().includes(query))
        .filter((i) => scope === "all" || scope === "global" || !i.off_in.includes(scope));
  const shown = (all ?? []).filter(
    (s) =>
      (projectId || !accountOf(s)) &&
      (!query || `${labelOf(s)} ${s.name} ${s.target} ${s.tool_names.join(" ")}`.toLowerCase().includes(query)) &&
      (projectId ? s.scope === "global" || s.project_id === projectId : true) &&
      (projectId || scope === "all" || (scope === "global" ? isGlobal(s) : s.project_id === scope)),
  );
  const groups = projectId
    ? [
        {
          title: t("res.group.own", { name: projectName(projects, projectId) }),
          items: shown.filter((s) => !isGlobal(s)),
        },
        { title: t("res.group.inherited"), items: shown.filter(isGlobal) },
      ]
    : [
        { title: t("res.scope.global"), items: shown.filter(isGlobal) },
        ...projects
          .filter((p) => shown.some((s) => s.project_id === p.id))
          .map((p) => ({ title: p.name, items: shown.filter((s) => s.project_id === p.id) })),
      ];
  const current = (all ?? []).find((s) => keyOf(s) === picked);
  const account = connected.find((i) => intKey(i.id) === picked);
  const toggleAccount = async (id: string, project: string, on: boolean) => {
    try {
      await client.call("mcp.toggle", { project, server: id, on });
      await Promise.all([loadAccounts(), res.loadServers()]);
    } catch (e) {
      notify(t("error.change", { error: errText(e) }));
    }
  };
  const disconnect = async (id: string) => {
    try {
      await client.call("integrations.disconnect", { id });
      if (picked === intKey(id)) setPicked(undefined);
      await Promise.all([loadAccounts(), res.loadServers()]);
    } catch (e) {
      notify(t("error.change", { error: errText(e) }));
    }
  };
  const accountRow = (i: Integration) => (
    <ContextMenu
      key={intKey(i.id)}
      items={[
        { label: t("res.open"), icon: <Icons.PanelRight size={14} />, onSelect: () => setPicked(intKey(i.id)) },
        {
          label: t("res.edit"),
          icon: <Icons.Pencil size={14} />,
          onSelect: () => {
            setPicked(intKey(i.id));
            setEditingAccount(Date.now());
          },
        },
        { type: "separator" },
        {
          label: t("int.disconnect"),
          icon: <Icons.Unplug size={14} />,
          danger: true,
          onSelect: () => void disconnect(i.id),
        },
      ]}
    >
      <PickRow
        className="resv__connector"
        title={i.label}
        description={where(i, registered.length, t)}
        leading={
          <span aria-hidden="true">
            <Tile i={i} size={28} />
          </span>
        }
        dot="on"
        selected={intKey(i.id) === picked}
        onClick={() => setPicked(intKey(i.id))}
      />
    </ContextMenu>
  );
  const inherit = useInheritance(projectId, "mcp", res.loadServers);
  const changed = () => res.loadServers();
  const setPermissions = async (s: McpServerStatus, mode: "ask" | "all") => {
    setPermissionsBusy(true);
    try {
      await setMcpToolMode(s, mode, s.scope === "project" ? s.project_id : (projectId ?? s.project_id));
      await changed();
      setToolReload((n) => n + 1);
      if (keyOf(s) === picked) setPermissionRequest(0);
    } finally {
      setPermissionsBusy(false);
    }
  };
  /** What a right-click on a server offers: the same actions as its detail, without opening it first. */
  const actions = (s: McpServerStatus): MenuEntry[] => {
    const inherited = Boolean(projectId) && isGlobal(s);
    return [
      { label: t("res.open"), icon: <Icons.PanelRight size={14} />, onSelect: () => setPicked(keyOf(s)) },
      ...(s.definition
        ? [{ label: t("res.edit"), icon: <Icons.Pencil size={14} />, onSelect: () => setEditing(s) }]
        : []),
      {
        label: t("res.test"),
        icon: <Icons.FlaskConical size={14} />,
        disabled: s.status === "needs-approval" || s.status === "needs-sign-in",
        onSelect: () => {
          setPicked(keyOf(s));
          setTestRequest((n) => n + 1);
        },
      },
      {
        type: "submenu",
        label: t("res.toolsMode"),
        icon: <Icons.Shield size={14} />,
        disabled: permissionsBusy || !s.trusted || !s.enabled || s.off_here,
        items: [
          {
            label: t("res.toolsMode.ask"),
            icon: <Icons.ShieldAlert size={14} />,
            checked: s.tool_permission_mode === "ask",
            onSelect: () => void setPermissions(s, "ask"),
          },
          {
            label: t("res.toolsMode.all"),
            icon: <Icons.ShieldCheck size={14} />,
            checked: s.tool_permission_mode === "all",
            onSelect: () => void setPermissions(s, "all"),
          },
          {
            label: t("res.toolsMode.some"),
            icon: <Icons.ListChecks size={14} />,
            checked: s.tool_permission_mode === "some",
            onSelect: () => {
              setPicked(keyOf(s));
              setPermissionServer(keyOf(s));
              setPermissionRequest((n) => n + 1);
            },
          },
        ],
      },
      ...[
        {
          label: s.trusted ? t("mcp.revoke") : t("mcp.approve"),
          icon: <Icons.ShieldCheck size={14} />,
          onSelect: () =>
            void trustMcp(s.scope === "project" ? s.project_id : undefined, s.name, !s.trusted).then(changed),
        },
      ],
      ...(inherited && projectId
        ? [
            {
              label: s.off_here ? t("res.turnOnHere") : t("res.turnOffHere"),
              icon: <Icons.Power size={14} />,
              onSelect: () => void toggleMcp(projectId, s.name, Boolean(s.off_here)).then(changed),
            },
          ]
        : []),
      ...(s.definition && (!isGlobal(s) || !projectId)
        ? [
            { type: "separator" as const },
            { label: t("res.remove"), icon: <Icons.Trash2 size={14} />, danger: true, onSelect: () => setRemoving(s) },
          ]
        : []),
    ];
  };
  const row = (s: McpServerStatus) => {
    const entry = catalogConnector(s.name);
    const label = labelOf(s);
    const brief = !accountOf(s) && entry ? `${entry.desc[lang === "es" ? 0 : 1]} · ` : "";
    return (
      <ContextMenu key={keyOf(s)} items={actions(s)}>
        <PickRow
          className="resv__connector"
          leading={
            <span aria-hidden="true">
              {entry && !accountOf(s) && !integrationBrand(entry.id) ? (
                <ConnectorLogo domain={entry.domain} size={28} />
              ) : (
                <IntegrationIcon id={entry?.id ?? s.name} name={label} size={28} />
              )}
            </span>
          }
          title={label}
          description={
            s.off_here ? t("res.offHere") : brief + (s.tools ? t("mcp.tools", { n: s.tools }) : t(STATUS_KEY[s.status]))
          }
          trailing={
            <>
              <Tag>{s.transport}</Tag>
              <PermissionIndicator mode={s.tool_permission_mode} />
            </>
          }
          dot={mcpDot(s)}
          muted={s.off_here || s.status === "disabled"}
          selected={keyOf(s) === picked}
          onClick={() => setPicked(keyOf(s))}
        />
      </ContextMenu>
    );
  };

  const added = async (name: string) => {
    await Promise.all([loadAccounts(), res.loadServers()]);
    setPicked(`global::${name}`);
  };
  const newServer = (
    <>
      {custom && (
        <McpDialog
          existingNames={all?.filter((s) => s.scope === "global").map((s) => s.name)}
          onClose={() => setCustom(false)}
          onSaved={async (name) => {
            setCustom(false);
            await added(name);
          }}
        />
      )}
      {adding && accounts && (
        <ConnectDialog
          list={accounts}
          onClose={() => setAdding(false)}
          onConnected={async (id) => {
            setAdding(false);
            await Promise.all([loadAccounts(), res.loadServers()]);
            setPicked(projectId ? undefined : intKey(id));
          }}
        />
      )}
    </>
  );
  /** Ways to add one: an account, the catalog, or a connector of the owner's own. */
  const addButtons = (
    <div className="conn__add">
      <Button
        size="sm"
        variant="secondary"
        className="catalog__open"
        leadingIcon={<Icons.LayoutGrid size={14} />}
        onClick={() => setCatalog(true)}
      >
        {t("res.catalog.open")}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="catalog__open"
        leadingIcon={<Icons.Plus size={14} />}
        onClick={() => setCustom(true)}
      >
        {t("res.catalog.custom")}
      </Button>
    </div>
  );
  // None at all yet: the invitation alone, no empty list beside it.
  if (all && accounts && !all.length && !linked.length && !projectId)
    return (
      <>
        {newServer}
        <div className="resvars">
          <EmptyState
            variant="dashed"
            icon={<Icons.Plug />}
            title={t("conn.empty.title")}
            action={
              <span className="conn__add">
                <Button size="sm" leadingIcon={<Icons.Plus size={14} />} onClick={() => setAdding(true)}>
                  {t("res.add.integration")}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  leadingIcon={<Icons.Plus size={14} />}
                  onClick={() => setCustom(true)}
                >
                  {t("res.catalog.custom")}
                </Button>
              </span>
            }
          >
            {t("conn.empty.body")}
          </EmptyState>
          <ConnectorCatalog servers={all} onAdded={added} />
        </div>
      </>
    );
  return (
    <>
      {newServer}
      <MasterDetail
        resizeKey="mcp"
        listLabel={t("res.tab.connections")}
        backLabel={t("res.tab.connections")}
        onBack={() => setPicked(undefined)}
        list={
          <>
            {!projectId && addButtons}
            {connected.length > 0 && (
              <div className="resv__group">
                <div className="resv__grouptitle">
                  {t("int.connected")} <span>{connected.length}</span>
                </div>
                {connected.map(accountRow)}
              </div>
            )}
            {all && !shown.length ? (
              connected.length ? null : (
                <EmptyState variant="dashed" size="sm" icon={<Icons.Server />}>
                  {query ? t("res.noMatch") : t("res.noMcp")}
                </EmptyState>
              )
            ) : projectId ? (
              <ScopedGroups
                ownTitle={groups[0]?.title ?? ""}
                own={groups[0]?.items ?? []}
                globals={groups[1]?.items ?? []}
                inherit={inherit}
                emptyOwn={t("res.noOwnMcp")}
                render={row}
                ownOnly={ownOnly}
              />
            ) : (
              groups
                .filter((g) => g.items.length)
                .map((g) => (
                  <div key={g.title} className="resv__group">
                    <div className="resv__grouptitle">
                      {g.title} <span>{g.items.length}</span>
                    </div>
                    {g.items.map(row)}
                  </div>
                ))
            )}
          </>
        }
        detail={
          account ? (
            <IntegrationDetail
              key={`${account.id}:${editingAccount}`}
              i={account}
              projects={registered}
              onToggle={toggleAccount}
              onChanged={async () => {
                await Promise.all([loadAccounts(), res.loadServers()]);
              }}
              editing={editingAccount > 0}
            />
          ) : (
            current && (
              <McpDetail
                key={keyOf(current)}
                server={current}
                projectId={projectId}
                onChanged={changed}
                onEdit={() => setEditing(current)}
                onRemove={() => setRemoving(current)}
                testRequest={testRequest}
                permissionRequest={permissionServer === keyOf(current) ? permissionRequest : 0}
                toolReload={toolReload}
              />
            )
          )
        }
        empty={
          <EmptyState variant="dashed" icon={<Icons.Server />} title={t("res.pickMcp.title")}>
            {t("res.pickMcp.body")}
          </EmptyState>
        }
      />
      {catalog && <ConnectorCatalogDialog servers={all} onClose={() => setCatalog(false)} onAdded={added} />}
      {editing && (
        <McpDialog
          server={editing}
          onClose={() => setEditing(undefined)}
          onSaved={async () => {
            setEditing(undefined);
            await changed();
          }}
        />
      )}
      {removing && (
        <Dialog
          open
          onOpenChange={(o) => !o && setRemoving(undefined)}
          title={t("res.mcpRemoveTitle", { name: removing.name })}
          footer={
            <>
              <Button variant="secondary" onClick={() => setRemoving(undefined)}>
                {t("common.cancel")}
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  const { name } = removing;
                  setRemoving(undefined);
                  void setMcp(name, null, removing.scope === "project" ? removing.project_id : undefined).then(changed);
                }}
              >
                {t("res.remove")}
              </Button>
            </>
          }
        >
          <p className="resd__note">
            {removing.scope === "project" ? t("res.mcpRemoveProjectBody") : t("res.mcpRemoveBody")}
          </p>
        </Dialog>
      )}
    </>
  );
}

function PermissionIndicator({ mode }: { mode: McpServerStatus["tool_permission_mode"] }) {
  const t = useT();
  const Icon =
    mode === "all"
      ? Icons.ShieldCheck
      : mode === "some"
        ? Icons.ListChecks
        : mode === "ask"
          ? Icons.ShieldAlert
          : Icons.CircleDashed;
  const label = `${t("res.toolsMode")}: ${t(`res.toolsMode.${mode}`)}`;
  return (
    <span className={`mcp-permission is-${mode}`} role="img" aria-label={label} title={label}>
      <Icon size={14} aria-hidden="true" />
    </span>
  );
}
