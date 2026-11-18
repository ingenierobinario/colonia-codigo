import type { Result } from "@colonia/protocol";
import { shareableWorkPath, WORK_FILE_MAX, WORK_FILES_MAX } from "@colonia/protocol/project-files";
import { Button, Icons, Input } from "@colonia/ui";
import { useEffect, useState } from "react";
import { client } from "../data/client.ts";
import { useT } from "../i18n/index.ts";
import "../styles/share-work-files.css";

export function WorkFileList({
  files,
  state = "included",
}: {
  files?: string[];
  state?: "included" | "kept" | "published";
}) {
  const t = useT();
  if (!files || (!files.length && state !== "published")) return null;
  return (
    <div className="share-files" data-testid={`work-files-${state}`}>
      <h3>{t(`pshare.files.${state}`, { n: files.length })}</h3>
      <ul>
        {files.map((name) => (
          <li key={name}>{name}</li>
        ))}
      </ul>
    </div>
  );
}

export function ShareWorkFiles({
  project,
  selected,
  onSelect,
  disabled,
}: {
  project: string;
  selected: string[];
  onSelect(names: string[]): void;
  disabled: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [dir, setDir] = useState("");
  const [tree, setTree] = useState<Result<"files.tree">>();
  const [failed, setFailed] = useState(false);
  const [exact, setExact] = useState("");
  useEffect(() => {
    if (!open) return;
    let current = true;
    setTree(undefined);
    setFailed(false);
    void client.call("files.tree", { project, dir }).then(
      (result) => {
        if (current) setTree(result);
      },
      () => {
        if (current) setFailed(true);
      },
    );
    return () => {
      current = false;
    };
  }, [dir, open, project]);
  const toggle = (rel: string) =>
    onSelect(selected.includes(rel) ? selected.filter((s) => s !== rel) : [...selected, rel].sort());
  const entries = tree?.entries.filter((entry) => shareableWorkPath(entry.path) && (entry.bytes ?? 0) <= WORK_FILE_MAX);
  return (
    <section className="pshare__card share-files" data-testid="share-work-files">
      <h3>{t("pshare.files.count", { n: selected.length })}</h3>
      <p>{t("pshare.files.help")}</p>
      {selected.length > 0 && (
        <ul>
          {selected.map((name) => (
            <li className="share-files__chosen" key={name}>
              <span>{name}</span>
              <button
                type="button"
                disabled={disabled}
                aria-label={t("pshare.files.remove", { name })}
                onClick={() => toggle(name)}
              >
                <Icons.X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <Button size="sm" variant="secondary" disabled={disabled} aria-expanded={open} onClick={() => setOpen(!open)}>
        {t(open ? "pshare.files.hide" : "pshare.files.choose")}
      </Button>
      {open && (
        <fieldset disabled={disabled} className="share-files__browser">
          <legend>{dir || t("pshare.files.root")}</legend>
          {!!dir && (
            <button type="button" onClick={() => setDir(dir.split("/").slice(0, -1).join("/"))}>
              {t("pshare.files.up")}
            </button>
          )}
          {failed && <p role="alert">{t("pshare.files.loadError")}</p>}
          {!tree && !failed && <p role="status">{t("pshare.files.loading")}</p>}
          {entries?.map((entry) =>
            entry.kind === "dir" ? (
              <button type="button" key={entry.path} onClick={() => setDir(entry.path)}>
                <Icons.Folder size={14} />
                <span>{entry.name}</span>
              </button>
            ) : (
              <label key={entry.path}>
                <input
                  type="checkbox"
                  checked={selected.includes(entry.path)}
                  disabled={!selected.includes(entry.path) && selected.length >= WORK_FILES_MAX}
                  onChange={() => toggle(entry.path)}
                />
                <span>{entry.name}</span>
              </label>
            ),
          )}
          {tree && !entries?.length && <p>{t("pshare.files.empty")}</p>}
          {tree?.truncated && (
            <div>
              <Input
                aria-label={t("pshare.files.exact")}
                placeholder={t("pshare.files.exact")}
                value={exact}
                onChange={(e) => setExact(e.target.value)}
              />
              <Button
                size="sm"
                disabled={!shareableWorkPath(exact) || selected.includes(exact) || selected.length >= WORK_FILES_MAX}
                onClick={() => {
                  toggle(exact);
                  setExact("");
                }}
              >
                {t("pshare.files.add")}
              </Button>
            </div>
          )}
        </fieldset>
      )}
    </section>
  );
}
