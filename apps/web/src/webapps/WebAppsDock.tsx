// WEBAPP-1: the web apps in the sidebar, under their own heading, with "+" to add one (name and address).
import type { WebApp } from "@colonia/protocol";
import { Button, ContextMenu, Dialog, IconButton, Icons, Input, NavItem, ProjectTile } from "@colonia/ui";
import { useEffect, useState } from "react";
import { loadWebApps, saveWebApp, useWebApps, webAppId } from "../data/webapps.ts";
import { useT } from "../i18n/index.ts";
import { go, useNav } from "../shell/nav.ts";
import { SidebarSection } from "../shell/SidebarSection.tsx";

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

export function WebAppsDock({ rail }: { rail: boolean }) {
  const t = useT();
  const apps = useWebApps((s) => s.apps);
  const view = useNav((s) => s.view);
  const current = useNav((s) => s.webAppId);
  const [editing, setEditing] = useState<WebApp | "new">();
  useEffect(() => {
    void loadWebApps();
  }, []);

  return (
    <>
      <SidebarSection
        rail={rail}
        title={t("webapp.title")}
        action={
          <IconButton
            size="sm"
            className="sidebar__add"
            label={t("webapp.add")}
            icon={<Icons.Plus size={14} />}
            onClick={() => setEditing("new")}
          />
        }
      />
      {apps.map((a) => (
        <ContextMenu
          key={a.id}
          items={[
            { label: t("webapp.edit"), icon: <Icons.Pencil size={14} />, onSelect: () => setEditing(a) },
            {
              label: t("webapp.remove"),
              icon: <Icons.Trash2 size={14} />,
              danger: true,
              onSelect: () => {
                void saveWebApp(a.id, null);
                if (view === "webapp" && current === a.id) go.inbox();
              },
            },
          ]}
        >
          <NavItem
            collapsed={rail}
            icon={<ProjectTile tone="info" icon={<Icons.Globe />} />}
            label={a.name}
            active={view === "webapp" && current === a.id}
            onClick={() => go.webapp(a.id)}
          />
        </ContextMenu>
      ))}
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
  const [saving, setSaving] = useState(false);
  const href = normalUrl(url);
  const valid = name.trim().length > 0 && href != null;
  const save = async () => {
    if (!href) return;
    setSaving(true);
    const id = initial?.id ?? webAppId(name, taken);
    const ok = await saveWebApp(id, { name: name.trim(), url: href });
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
      </div>
    </Dialog>
  );
}
