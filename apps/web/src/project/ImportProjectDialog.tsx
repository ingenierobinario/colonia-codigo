import type { McpServerStatus } from "@colonia/protocol";
import { Button, Checkbox, Dialog, Field, Icons, Input, SegmentedControl, Tag, Textarea } from "@colonia/ui";
import { useRef, useState } from "react";
import { bootstrap } from "../data/actions.ts";
import { notify } from "../data/notices.ts";
import { importProject, PACKAGE_FILE_MAX, type ProjectImport, readProject, sourceOf } from "../data/project-share.ts";
import { listMcp } from "../data/resources.ts";
import { useT } from "../i18n/index.ts";
import { McpDialog } from "../resources/McpDialog.tsx";
import { go } from "../shell/nav.ts";
import { UnresolvedLinks } from "./UnresolvedLinks.tsx";
import "../styles/screens.css";
import "../styles/project-share.css";

type From = "file" | "paste";
type Source = { link: string } | { content: string };

/**
 * PROYECTO-COMPARTIR-1 · Brings in a project someone shared: from its file, or from the link or text they sent. It
 * shows what the project holds before saving anything, and afterwards which connections still need this person's own
 * keys, each with the button that asks for them right here.
 */
export function ImportProjectDialog({ onClose }: { onClose(): void }) {
  const t = useT();
  const file = useRef<HTMLInputElement>(null);
  const [from, setFrom] = useState<From>("file");
  const [text, setText] = useState("");
  const [source, setSource] = useState<Source>();
  const [preview, setPreview] = useState<ProjectImport>();
  const [name, setName] = useState("");
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<ProjectImport & { project: NonNullable<ProjectImport["project"]> }>();
  const [connected, setConnected] = useState<readonly string[]>([]);
  const [editing, setEditing] = useState<McpServerStatus>();

  const look = async (next: Source | undefined) => {
    if (!next) return;
    setBusy(true);
    const r = await readProject(next);
    setBusy(false);
    if (!r) return;
    setSource(next);
    setPreview(r);
    setName(r.name);
    setReplace(false);
  };
  const pickFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > PACKAGE_FILE_MAX) return notify(t("pshare.err.large"));
    await look({ content: await f.text() });
  };
  const renamed = Boolean(name.trim()) && name.trim() !== preview?.name;
  const ready = Boolean(preview && source) && (!preview?.taken || replace || renamed);
  const save = async () => {
    if (!source || !preview || !ready || busy) return;
    setBusy(true);
    const r = await importProject(source, replace && !renamed, renamed ? name.trim() : undefined);
    setBusy(false);
    if (!r) return;
    notify(t("pshare.import.done", { name: r.project.name }), "info");
    await bootstrap().catch(() => {});
    setDone(r);
  };
  const connect = async (server: string) => {
    if (!done) return;
    const found = (await listMcp(done.project.id))?.find((s) => s.name === server && s.scope === "project");
    if (found) setEditing(found);
  };
  const open = () => {
    if (!done) return;
    onClose();
    go.project(done.project.id, "overview");
  };
  const tags = (p: ProjectImport) => (
    <div className="pshare__tags" data-testid="pshare-brings">
      <Tag icon={<Icons.FileText size={12} />}>{t("pshare.goes.instructions")}</Tag>
      {p.agents > 0 && <Tag>{t("pshare.goes.agents", { n: p.agents })}</Tag>}
      {p.skills > 0 && <Tag>{t("pshare.goes.skills", { n: p.skills })}</Tag>}
      {p.connections > 0 && <Tag>{t("pshare.goes.connections", { n: p.connections })}</Tag>}
      {p.organization && <Tag>{t("pshare.goes.organization")}</Tag>}
    </div>
  );

  return (
    <>
      <Dialog
        open
        size="lg"
        onOpenChange={(o) => !o && !busy && !editing && onClose()}
        title={t("pshare.import.title")}
        description={done ? done.project.name : t("pshare.import.body")}
        footer={
          done ? (
            <Button onClick={open}>{t("pshare.import.open")}</Button>
          ) : (
            <>
              <Button variant="secondary" disabled={busy} onClick={onClose}>
                {t("common.cancel")}
              </Button>
              <Button disabled={!ready} loading={busy && Boolean(preview)} onClick={() => void save()}>
                {t("pshare.import.action")}
              </Button>
            </>
          )
        }
      >
        {done ? (
          <div className="pshare">
            <section className="pshare__card">
              <h3>{t("pshare.import.brings")}</h3>
              {tags(done)}
            </section>
            {done.pending.length > 0 && (
              <section className="pshare__card">
                <h3>{t("pshare.import.pending")}</h3>
                <p>{t("pshare.import.pendingBody")}</p>
                <ul className="pshare__pending">
                  {done.pending.map((p) => (
                    <li key={p.name}>
                      <div>
                        <strong>{p.name}</strong>
                        {p.needs.length > 0 && <span>{t("pshare.import.needs", { list: p.needs.join(", ") })}</span>}
                      </div>
                      {connected.includes(p.name) ? (
                        <Tag icon={<Icons.Check size={12} />}>{t("pshare.import.connected")}</Tag>
                      ) : (
                        <Button size="sm" variant="secondary" onClick={() => void connect(p.name)}>
                          {t("pshare.import.connect")}
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {(done.unresolved?.length ?? 0) > 0 && (
              <UnresolvedLinks project={done.project} names={done.unresolved ?? []} />
            )}
          </div>
        ) : (
          <div className="pshare">
            <SegmentedControl
              label={t("pshare.import.from")}
              value={from}
              onValueChange={(v) => setFrom(v as From)}
              options={[
                { value: "file", label: t("pshare.import.file") },
                { value: "paste", label: t("pshare.import.paste") },
              ]}
            />
            {from === "file" ? (
              <div className="pshare__actions">
                <input
                  ref={file}
                  type="file"
                  className="pshare__file"
                  accept=".json,application/json,text/plain"
                  data-testid="pshare-file"
                  onChange={(e) => {
                    const f = e.currentTarget.files?.[0];
                    e.currentTarget.value = "";
                    void pickFile(f);
                  }}
                />
                <Button
                  variant="secondary"
                  loading={busy && !preview}
                  leadingIcon={<Icons.Upload size={14} />}
                  onClick={() => file.current?.click()}
                >
                  {t("pshare.import.pick")}
                </Button>
              </div>
            ) : (
              <>
                <Field label={t("pshare.import.pasteLabel")}>
                  {(id) => (
                    <Textarea
                      id={id}
                      rows={3}
                      className="is-mono"
                      placeholder={t("pshare.import.pastePlaceholder")}
                      value={text}
                      onChange={(e) => setText(e.currentTarget.value)}
                    />
                  )}
                </Field>
                <div className="pshare__actions">
                  <Button
                    variant="secondary"
                    disabled={!text.trim()}
                    loading={busy && !preview}
                    onClick={() => void look(sourceOf(text))}
                  >
                    {t("pshare.import.look")}
                  </Button>
                </div>
              </>
            )}
            {preview ? (
              <section className="pshare__card">
                <h3>{t("pshare.import.brings")}</h3>
                {preview.description && <p>{preview.description}</p>}
                {tags(preview)}
                <Field label={t("pshare.import.name")}>
                  {(id) => (
                    <Input id={id} maxLength={80} value={name} onChange={(e) => setName(e.currentTarget.value)} />
                  )}
                </Field>
                {preview.taken && (
                  <>
                    <p>{t("pshare.import.taken")}</p>
                    <span title={t("pshare.import.replaceTitle")}>
                      <Checkbox
                        checked={replace && !renamed}
                        disabled={renamed}
                        label={t("pshare.import.replace")}
                        onCheckedChange={setReplace}
                      />
                    </span>
                  </>
                )}
              </section>
            ) : (
              <section className="pshare__card pshare__card--empty">
                <p>{t("pshare.import.empty")}</p>
              </section>
            )}
          </div>
        )}
      </Dialog>
      {editing && (
        <McpDialog
          server={editing}
          onClose={() => setEditing(undefined)}
          onSaved={(saved) => {
            setConnected((c) => [...c, saved]);
            setEditing(undefined);
          }}
        />
      )}
    </>
  );
}
