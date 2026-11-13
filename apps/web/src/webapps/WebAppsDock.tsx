// WEBAPP-1: the web apps in the sidebar, under their own heading, with "+" to add one (name and address).
import type { WebApp } from "@colonia/protocol";
import { Button, ContextMenu, Dialog, IconButton, Icons, Input, Menu, NavItem, ProjectTile } from "@colonia/ui";
import { useEffect, useState } from "react";
import { setPrefs, usePrefs } from "../data/prefs.ts";
import { useData } from "../data/state.ts";
import { loadWebApps, saveWebApp, useWebApps, webAppId } from "../data/webapps.ts";
import { useT } from "../i18n/index.ts";
import { addProgram, canPinPrograms, ProgramItems } from "../programs/ProgramsDock.tsx";
import { go, useNav } from "../shell/nav.ts";
import { SidebarSection } from "../shell/SidebarSection.tsx";
import { unreadFromTitle } from "./presets.ts";
import "../styles/webapps.css";

/** "business-stack.example.com" → "https://business-stack.example.com"; anything not http(s) is refused. */
export function normalUrl(raw: string): string | undefined {
  const s = raw.trim();
  if (!s) return undefined;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : undefined;
  } catch {
    return undefined;
  }
}

/** The site's own icon (its /favicon.ico); the globe while it loads or if the site has none. */
export function Favicon({ url }: { url: string }) {
  const src = (() => {
    try {
      return `${new URL(url).origin}/favicon.ico`;
    } catch {
      return undefined;
    }
  })();
  const [failed, setFailed] = useState<string>();
  if (!src || failed === src) return <Icons.Globe />;
  // FAVICON-1: the size also goes inline, so a large icon never fills the tile before the stylesheet arrives.
  return <img className="webapp__favicon" src={src} alt="" width={16} height={16} onError={() => setFailed(src)} />;
}

/** Sin leer de cada aplicación abierta, por perfil, leído del título de su pestaña. */
function useUnread(): Record<string, number> {
  const tabs = useData((s) => s.tabs);
  const out: Record<string, number> = {};
  for (const x of tabs) if (x.profile.startsWith("app:")) out[x.profile.slice(4)] = unreadFromTitle(x.title);
  return out;
}

export function WebAppsDock({ rail }: { rail: boolean }) {
  const t = useT();
  const apps = useWebApps((s) => s.apps);
  const view = useNav((s) => s.view);
  const current = useNav((s) => s.webAppId);
  const unread = useUnread();
  const [editing, setEditing] = useState<WebApp | "new">();
  const folded = usePrefs((s) => s.appsFolded);
  const externalFolded = usePrefs((s) => s.appsExternalFolded);
  const shut = externalFolded && !rail;
  useEffect(() => {
    void loadWebApps();
  }, []);
  // Folded with the rest of Aplicaciones (the rail always shows the icons).
  if (folded && !rail) return null;

  const plus = (
    <IconButton size="sm" className="sidebar__add" label={t("webapp.add")} icon={<Icons.Plus size={14} />} />
  );
  return (
    <>
      <SidebarSection
        rail={rail}
        sub
        title={t("nav.appsExternal")}
        folded={externalFolded}
        onToggle={() => setPrefs({ appsExternalFolded: !externalFolded })}
        action={
          <Menu
            trigger={plus}
            align="end"
            items={[
              { label: t("webapp.addWeb"), icon: <Icons.Globe size={14} />, onSelect: () => setEditing("new") },
              ...(canPinPrograms()
                ? [{ label: t("program.add"), icon: <Icons.Monitor size={14} />, onSelect: addProgram }]
                : []),
            ]}
          />
        }
      />
      {!shut &&
        apps.map((a) => (
          <ContextMenu
            key={a.id}
            items={[
              { label: t("webapp.edit"), icon: <Icons.Pencil size={14} />, onSelect: () => setEditing(a) },
              {
                label: t("webapp.remove"),
                icon: <Icons.Trash2 size={14} />,
                danger: true,
                onSelect: () => {
                  void saveWebApp(a.id, null).then((ok) => ok && window.coloniaDesktop?.loginsRemoveApp?.(a.id));
                  if (view === "webapp" && current === a.id) go.inbox();
                },
              },
            ]}
          >
            <NavItem
              collapsed={rail}
              icon={<ProjectTile tone="info" icon={<Favicon url={a.url} />} />}
              label={a.name}
              count={unread[a.id]}
              attention
              active={view === "webapp" && current === a.id}
              onClick={() => go.webapp(a.id)}
            />
          </ContextMenu>
        ))}
      {!shut && <ProgramItems rail={rail} />}
      {editing && (
        <WebAppDialog
          initial={editing === "new" ? undefined : editing}
          taken={apps.map((a) => a.id)}
          onClose={() => setEditing(undefined)}
        />
      )}
    </>
  );
}

function WebAppDialog({
  initial,
  taken,
  onClose,
}: {
  initial: WebApp | undefined;
  taken: readonly string[];
  onClose: () => void;
}) {
  const t = useT();
  const [name, setName] = useState(initial?.name ?? "");
  const [url, setUrl] = useState(initial?.url ?? "");
  const [mcp, setMcp] = useState(initial?.mcp ?? "");
  const [key, setKey] = useState("");
  const hasKey = useWebApps((s) => (initial ? s.keyed.includes(initial.id) : false));
  const [dropKey, setDropKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const href = normalUrl(url);
  const mcpHref = mcp.trim() ? normalUrl(mcp) : undefined;
  const mcpBad = mcp.trim() !== "" && !mcpHref;
  const valid = name.trim().length > 0 && href != null && !mcpBad;
  const save = async () => {
    if (!href) return;
    setSaving(true);
    const id = initial?.id ?? webAppId(name, taken);
    const keyChange = key.trim() ? key.trim() : dropKey ? null : undefined;
    const ok = await saveWebApp(id, { name: name.trim(), url: href, ...(mcpHref && { mcp: mcpHref }) }, keyChange);
    setSaving(false);
    if (!ok) return;
    onClose();
    go.webapp(id);
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={initial ? t("webapp.editTitle") : t("webapp.newTitle")}
      description={t("webapp.lead")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={!valid} loading={saving} onClick={() => void save()}>
            {initial ? t("common.save") : t("webapp.addButton")}
          </Button>
        </>
      }
    >
      <div className="pform">
        <div className="pform__field">
          <span className="pform__label">{t("webapp.name")}</span>
          <Input
            aria-label={t("webapp.name")}
            placeholder="Business Stack"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
          />
        </div>
        <div className="pform__field">
          <span className="pform__label">{t("webapp.url")}</span>
          <Input
            aria-label={t("webapp.url")}
            placeholder="https://"
            value={url}
            onChange={(e) => setUrl(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && valid) void save();
            }}
          />
          {url.trim() !== "" && !href && <span className="pform__hint is-error">{t("webapp.badUrl")}</span>}
        </div>
        <div className="pform__field">
          <span className="pform__label">{t("webapp.connector")}</span>
          <span className="pform__hint">{t("webapp.connectorHint")}</span>
          <Input
            aria-label={t("webapp.mcp")}
            placeholder={`${t("webapp.mcp")} · https://…/mcp`}
            value={mcp}
            onChange={(e) => setMcp(e.currentTarget.value)}
          />
          {mcpBad && <span className="pform__hint is-error">{t("webapp.badUrl")}</span>}
          {mcpHref && (
            <>
              <Input
                type="password"
                autoComplete="off"
                aria-label={t("webapp.key")}
                placeholder={t("webapp.key")}
                value={key}
                onChange={(e) => setKey(e.currentTarget.value)}
              />
              {hasKey && !dropKey && !key && (
                <span className="pform__hint">
                  {t("webapp.keySaved")}{" "}
                  <Button size="sm" variant="ghost" onClick={() => setDropKey(true)}>
                    {t("webapp.keyRemove")}
                  </Button>
                </span>
              )}
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}
