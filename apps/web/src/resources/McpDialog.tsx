import type { McpServerStatus } from "@colonia/protocol";
import { Button, Dialog, Input, SegmentedControl } from "@colonia/ui";
import { useState } from "react";
import { type McpDraft, setMcp, signInMcp } from "../data/resources.ts";
import { useT } from "../i18n/index.ts";
import { browserLoginMcp, browserLoginUrl } from "./browserLoginMcp.ts";
import { type Pair, PairsEditor, pairsToRecord } from "./PairsEditor.tsx";

const NAME = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,40}$/;

/** A command line split on spaces, keeping "quoted parts" together. */
export function splitCommand(line: string): string[] {
  return [...line.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? "");
}

/** A command line from its parts: an argument with spaces goes back in quotes. */
const joinCommand = (parts: string[]) => parts.map((p) => (/\s/.test(p) ? `"${p}"` : p)).join(" ");
const toPairs = (r: Record<string, string> | undefined): Pair[] =>
  Object.entries(r ?? {}).map(([key, value]) => ({ key, value }));

/**
 * Adds one of the owner's MCP servers, or changes one (`server`): a command it starts (stdio) or a URL (http). Secrets
 * go in as `secret://NAME` references to Variables, never as values in the definition.
 */
export function McpDialog(props: {
  server?: McpServerStatus | undefined;
  existingNames?: readonly string[] | undefined;
  onClose(): void;
  onSaved(name: string): void;
}) {
  const t = useT();
  const def = props.server?.definition;
  const [name, setName] = useState(props.server?.name ?? "");
  const loginUrl = browserLoginUrl(def);
  const [kind, setKind] = useState(loginUrl ? "oauth" : def?.command ? "command" : "url");
  const [command, setCommand] = useState(def?.command ? joinCommand([def.command, ...def.args]) : "");
  const [url, setUrl] = useState(loginUrl ?? def?.url ?? "");
  const [headers, setHeaders] = useState<Pair[]>(toPairs(def?.headers));
  const [env, setEnv] = useState<Pair[]>(toPairs(def?.env));
  const pairs = kind === "url" ? headers : env;
  const setPairs = kind === "url" ? setHeaders : setEnv;
  const [busy, setBusy] = useState(false);
  const parts = splitCommand(command);
  const duplicate = props.existingNames?.includes(name);
  const endpoint = URL.canParse(url) ? new URL(url) : undefined;
  const validUrl =
    endpoint &&
    (kind === "oauth" ? endpoint.protocol === "https:" : /^https?:$/.test(endpoint.protocol)) &&
    !endpoint.username &&
    !endpoint.password;
  const valid = NAME.test(name) && !duplicate && (kind === "command" ? Boolean(parts[0]) : validUrl);
  const save = async () => {
    setBusy(true);
    const extra = pairsToRecord(pairs);
    const server: McpDraft =
      kind === "command"
        ? { command: parts[0] ?? "", args: parts.slice(1), env: extra }
        : kind === "oauth"
          ? browserLoginMcp(url.trim())
          : { url: url.trim(), headers: extra };
    // An edit keeps whether it was turned off.
    if (props.server && !props.server.enabled) server.enabled = false;
    const r = await setMcp(name, server, props.server?.scope === "project" ? props.server.project_id : undefined);
    const saved = r?.find((entry) => entry.name === name && entry.scope === (props.server?.scope ?? "global"));
    if (kind === "oauth" && saved?.enabled && saved.trusted) await signInMcp(saved);
    setBusy(false);
    if (r) props.onSaved(name);
  };
  return (
    <Dialog
      open
      size="lg"
      onOpenChange={(o) => !o && props.onClose()}
      title={props.server ? t("res.editMcp", { name: props.server.name }) : t("res.newMcp")}
      description={
        props.server?.scope === "project" ? t("res.editProjectMcp") : props.server ? undefined : t("res.newMcp.lead")
      }
      footer={
        <>
          <Button variant="secondary" onClick={props.onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={!valid} loading={busy} onClick={() => void save()}>
            {kind === "oauth" ? t("res.catalog.add") : props.server ? t("common.save") : t("res.create")}
          </Button>
        </>
      }
    >
      <div className="pform">
        <div className="pform__field">
          <span className="pform__label">{t("res.mcpName")}</span>
          <Input
            aria-label={t("res.mcpName")}
            value={name}
            disabled={Boolean(props.server)}
            aria-invalid={name !== "" && (!NAME.test(name) || Boolean(duplicate))}
            placeholder="mi-conector"
            onChange={(e) => setName(e.currentTarget.value)}
          />
          {name && !NAME.test(name) && <small>{t("res.mcpNameHint")}</small>}
          {duplicate && <small>{t("res.mcpNameUsed")}</small>}
        </div>
        <SegmentedControl
          size="sm"
          label={t("res.mcpKind")}
          value={kind}
          onValueChange={setKind}
          options={[
            { value: "url", label: t("res.url") },
            { value: "oauth", label: t("res.mcpBrowserLogin") },
            { value: "command", label: t("res.command") },
          ]}
        />
        {kind === "command" ? (
          <div className="pform__field">
            <span className="pform__label">{t("res.command")}</span>
            <Input
              aria-label={t("res.command")}
              className="resd__monoinput"
              value={command}
              placeholder="npx -y @acme/mcp-server"
              onChange={(e) => setCommand(e.currentTarget.value)}
            />
          </div>
        ) : (
          <div className="pform__field">
            <span className="pform__label">{t("res.url")}</span>
            <Input
              aria-label={t("res.url")}
              value={url}
              aria-invalid={url !== "" && !validUrl}
              placeholder="https://mcp.example.com/mcp"
              onChange={(e) => setUrl(e.currentTarget.value)}
            />
            {url && !validUrl && <small>{t(kind === "oauth" ? "res.mcpLoginUrlHint" : "res.mcpUrlHint")}</small>}
          </div>
        )}
        {kind !== "oauth" && (
          <div className="pform__field">
            <span className="pform__label">{kind === "command" ? t("res.env") : t("res.headers")}</span>
            <PairsEditor
              vars={props.server?.scope !== "project"}
              keys={kind === "command" ? "env" : "headers"}
              label={kind === "command" ? t("res.env") : t("res.headers")}
              pairs={pairs}
              onChange={setPairs}
            />
          </div>
        )}
      </div>
    </Dialog>
  );
}
