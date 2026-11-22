import type { Result } from "@colonia/protocol";
import { Button, Checkbox, Dialog, Icons, Input, Tag } from "@colonia/ui";
import { useCallback, useEffect, useState } from "react";
import { client } from "../data/client.ts";
import { notify } from "../data/notices.ts";
import { useT } from "../i18n/index.ts";

type Importable = Result<"mcp.importable">["servers"][number];

const SOURCE_KEY = {
  "claude-code": "conn.import.src.claudeCode",
  codex: "conn.import.src.codex",
  "claude-desktop": "conn.import.src.claudeDesktop",
  cursor: "conn.import.src.cursor",
} as const;

/**
 * IMPORTAR-CONECTORES-1: «You have N connectors in your other AIs · Import». The connectors set up in Claude Code,
 * Codex, Claude Desktop or Cursor, brought in one click; a key the file does not hold is asked here, never elsewhere.
 * `reload`: Colonia's list changed (an import, or a server added by hand): look again.
 */
export function ImportConnectors({ onImported, reload }: { onImported: () => unknown; reload: unknown }) {
  const t = useT();
  const [found, setFound] = useState<Importable[]>();
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [values, setValues] = useState<Record<string, Record<string, string>>>({});
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      setFound((await client.call("mcp.importable", {})).servers);
    } catch {
      // A core without this method (older) or a file it cannot read: nothing to offer, nothing to warn about.
      setFound([]);
    }
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `reload` is the signal to look again.
  useEffect(() => {
    void load();
  }, [load, reload]);
  if (!found?.length) return null;
  const start = () => {
    setChosen(new Set(found.map((s) => s.key)));
    setValues({});
    setOpen(true);
  };
  const where = (s: Importable) =>
    new Intl.ListFormat(undefined, { type: "conjunction" }).format(s.sources.map((x) => t(SOURCE_KEY[x])));
  const lacking = found.filter((s) => chosen.has(s.key) && s.needs.some((k) => !values[s.key]?.[k]?.trim()));
  const run = async () => {
    setBusy(true);
    try {
      const r = await client.call("mcp.import", { keys: [...chosen], values });
      const parts = [
        r.added.length
          ? r.added.length === 1
            ? t("conn.import.added.one")
            : t("conn.import.added", { n: r.added.length })
          : "",
        r.need_values.length ? t("conn.import.needKey", { names: r.need_values.map((n) => n.name).join(", ") }) : "",
        r.failed.length ? t("conn.import.failed", { names: r.failed.map((n) => n.name).join(", ") }) : "",
      ].filter(Boolean);
      if (parts.length) notify(parts.join(" "));
      setOpen(false);
      await onImported();
      await load();
    } catch (e) {
      notify(t("error.change", { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="conn-import" data-testid="conn-import">
        <Icons.Download size={16} className="conn-import__icon" />
        <span className="conn-import__text">
          {found.length === 1 ? t("conn.import.banner.one") : t("conn.import.banner", { n: found.length })}
        </span>
        <Button size="sm" variant="secondary" onClick={start}>
          {t("conn.import.action")}
        </Button>
      </div>
      {open && (
        <Dialog
          open
          onOpenChange={(o) => !o && setOpen(false)}
          title={t("conn.import.title")}
          description={t("conn.import.body")}
          footer={
            <>
              <Button variant="secondary" onClick={() => setOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button disabled={busy || !chosen.size || lacking.length > 0} onClick={() => void run()}>
                {chosen.size === 1 ? t("conn.import.confirm.one") : t("conn.import.confirm", { n: chosen.size })}
              </Button>
            </>
          }
        >
          <div className="conn-import__list">
            {found.map((s) => (
              <div key={s.key} className="conn-import__item">
                <Checkbox
                  checked={chosen.has(s.key)}
                  onCheckedChange={(on) => {
                    const next = new Set(chosen);
                    if (on) next.add(s.key);
                    else next.delete(s.key);
                    setChosen(next);
                  }}
                  label={
                    <span className="conn-import__name">
                      {s.name}
                      {s.local && (
                        <Tag title={t("conn.import.localHint")} icon={<Icons.Monitor size={12} />}>
                          {t("conn.import.local")}
                        </Tag>
                      )}
                    </span>
                  }
                  description={
                    <>
                      {t("conn.import.from", { where: where(s) })}
                      {s.stored.length > 0 && ` · ${t("conn.import.keyKept")}`}
                    </>
                  }
                />
                {chosen.has(s.key) &&
                  s.needs.map((k) => (
                    <div key={k} className="conn-import__key">
                      <span>{t("conn.import.keyFor", { key: k })}</span>
                      <Input
                        type="password"
                        aria-label={t("conn.import.keyFor", { key: k })}
                        autoComplete="off"
                        value={values[s.key]?.[k] ?? ""}
                        onChange={(e) => {
                          const v = e.currentTarget.value;
                          setValues((all) => ({ ...all, [s.key]: { ...all[s.key], [k]: v } }));
                        }}
                      />
                    </div>
                  ))}
              </div>
            ))}
          </div>
        </Dialog>
      )}
    </>
  );
}
