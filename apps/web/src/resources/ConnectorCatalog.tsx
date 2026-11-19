// CATALOGO-CONECTORES-1/-2: the connectors a business usually wants, one click each.
// - `remote`: the service lets any app register itself, so mcp-remote opens its own login in the browser and keeps
//   the session (Colonia's MCP client has no sign-in of its own). Every address was checked live to answer 401 with a
//   registration endpoint.
// - `url`: open, nothing to sign in.
// - `keys`: the service only lets its approved apps sign in (GitHub, Slack, HubSpot, Box, Stripe), so the way in is a
//   personal key the person creates in that service. It is kept as a variable and reaches the server as secret://,
//   never written in the config.
import type { McpServerStatus } from "@colonia/protocol";
import { Button, Dialog, Icons, Input, IntegrationIcon, SearchField } from "@colonia/ui";
import { useCallback, useEffect, useState } from "react";
import { client } from "../data/client.ts";
import { type McpDraft, setMcp, setSecret, signInMcp } from "../data/resources.ts";
import { useLanguage, useT } from "../i18n/index.ts";
import { browserLoginMcp } from "./browserLoginMcp.ts";
import { ConnectorLogo } from "./ConnectorLogo.tsx";
import { type Category, CONNECTORS, type Connector, type Key } from "./connectorDirectory.ts";

export { CONNECTORS } from "./connectorDirectory.ts";

import { ConnectForm, type Integration } from "./IntegrationsTab.tsx";

/** Colonia's own social connectors: listed with the social connectors, they connect in the same form as in Integrations. */
const OWN_SOCIAL = ["youtube", "x", "meta", "linkedin", "tiktok"] as const;

const CATEGORIES: readonly Category[] = [
  "work",
  "docs",
  "design",
  "sales",
  "marketing",
  "social",
  "web",
  "data",
  "dev",
];

/** The variable a connector's key is kept under. */
const secretName = (c: Connector, k: Key) => `conector_${c.id}_${k.env}`.replace(/[^a-zA-Z0-9_.-]/g, "_");

/**
 * How the connector is added: a sign-in through mcp-remote, a plain address, or a package it starts. A key goes as
 * secret:// (resolved when the server starts, never in the config); mcp-remote gets it through an env var because
 * secret:// in args would show in the process list.
 */
export function connectorServer(c: Connector): McpDraft {
  const ref = (k: Key) => `${k.bearer ? "Bearer " : ""}secret://${secretName(c, k)}`;
  const env = Object.fromEntries((c.keys ?? []).map((k) => [k.env, ref(k)]));
  if ("remote" in c) {
    if (!c.keys?.length) return browserLoginMcp(c.remote);
    const headers = (c.keys ?? []).flatMap((k) => ["--header", `Authorization:\${${k.env}}`]);
    return { command: "npx", args: ["-y", "mcp-remote", c.remote, ...headers], env };
  }
  if ("url" in c) return { url: c.url, headers: env };
  return { command: "npx", args: ["-y", ...c.npx], env };
}

export function ConnectorCatalog({
  servers,
  onAdded,
}: {
  servers: readonly McpServerStatus[] | undefined;
  onAdded: (name: string) => void | Promise<void>;
}) {
  const t = useT();
  const es = useLanguage() === "es";
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string>();
  const [asking, setAsking] = useState<string>();
  const [values, setValues] = useState<Record<string, string>>({});
  const [own, setOwn] = useState<Integration[]>([]);
  const [connecting, setConnecting] = useState<Integration>();
  const loadOwn = useCallback(async () => {
    try {
      const all = (await client.call("integrations.list", {})).integrations;
      setOwn(OWN_SOCIAL.flatMap((id) => all.filter((i) => i.id === id)));
    } catch {
      // Without the list the cards are left out; the rest of the catalog still works.
    }
  }, []);
  useEffect(() => void loadOwn(), [loadOwn]);
  const have = new Map((servers ?? []).filter((s) => s.scope === "global").map((s) => [s.name, s]));
  const q = query.trim().toLowerCase();
  const ownDesc = (i: Integration) => t(`res.catalog.own.${i.id as (typeof OWN_SOCIAL)[number]}`);
  const ownShown = own.filter((i) => !q || `${i.label} ${ownDesc(i)}`.toLowerCase().includes(q));
  const shown = CONNECTORS.filter((c) => !q || `${c.name} ${c.desc.join(" ")}`.toLowerCase().includes(q));
  const add = async (c: Connector) => {
    setBusy(c.id);
    const existing = have.get(c.id);
    if (!existing) {
      for (const k of c.keys ?? []) {
        if (!(await setSecret(secretName(c, k), (values[k.env] ?? "").trim()))) return setBusy(undefined);
      }
    }
    const server =
      existing ?? (await setMcp(c.id, connectorServer(c)))?.find((s) => s.scope === "global" && s.name === c.id);
    if (server) {
      if (
        server.enabled &&
        server.trusted &&
        server.status !== "ready" &&
        server.status !== "starting" &&
        !server.sign_in_url
      )
        await signInMcp(server);
      setAsking(undefined);
      setValues({});
      await onAdded(c.id);
    }
    setBusy(undefined);
  };
  return (
    <div className="catalog">
      <div className="catalog__head">
        <span className="catalog__lead">{t("res.catalog.lead")}</span>
        <SearchField
          size="sm"
          value={query}
          placeholder={t("res.catalog.search")}
          onChange={(e) => setQuery(e.currentTarget.value)}
        />
      </div>
      {CATEGORIES.map((cat) => {
        const items = shown.filter((c) => c.category === cat);
        const mine = cat === "social" ? ownShown : [];
        if (!items.length && !mine.length) return null;
        return (
          <section key={cat} className="catalog__group">
            <div className="resv__grouptitle">{t(`res.catalog.cat.${cat}`)}</div>
            <div className="catalog__grid">
              {mine.map((i) => (
                <div key={`own-${i.id}`} className="catalog__card">
                  <span className="catalog__logo">
                    <IntegrationIcon id={i.id} name={i.label} size={28} />
                  </span>
                  <span className="catalog__text">
                    <span className="catalog__name">{i.label}</span>
                    <span className="catalog__desc">{ownDesc(i)}</span>
                  </span>
                  {i.connected ? (
                    <span className="catalog__on">
                      <Icons.Check size={14} /> {t("res.catalog.connected")}
                    </span>
                  ) : (
                    <Button size="sm" variant="secondary" onClick={() => setConnecting(i)}>
                      {t("res.catalog.add")}
                    </Button>
                  )}
                </div>
              ))}
              {items.map((c) => {
                const existing = have.get(c.id);
                const authorization =
                  existing?.status === "needs-sign-in" && existing.sign_in_url?.startsWith("https://")
                    ? existing.sign_in_url
                    : undefined;
                const on = existing?.status === "ready";
                const open = asking === c.id && c.keys;
                const filled = (c.keys ?? []).every((k) => (values[k.env] ?? "").trim());
                return (
                  <div key={c.id} className={`catalog__card${open ? " catalog__card--open" : ""}`}>
                    <span className="catalog__logo">
                      <ConnectorLogo domain={c.domain} />
                    </span>
                    <span className="catalog__text">
                      <span className="catalog__name">{c.name}</span>
                      <span className="catalog__desc" title={c.keys ? t("res.catalog.keyNeeded") : undefined}>
                        {es ? c.desc[0] : c.desc[1]}
                      </span>
                      <a href={c.help ?? `https://${c.domain}/`} target="_blank" rel="noopener noreferrer">
                        {t("res.catalog.openProvider", { name: c.name })}
                      </a>
                    </span>
                    {on ? (
                      <span className="catalog__on">
                        <Icons.Check size={14} /> {t("res.catalog.connected")}
                      </span>
                    ) : authorization ? (
                      <a href={authorization} target="_blank" rel="noopener noreferrer">
                        {t("res.signIn")}
                      </a>
                    ) : open ? null : (
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={busy === c.id}
                        disabled={Boolean(busy)}
                        onClick={() => {
                          if (c.keys && !existing) {
                            if (c.help) window.open(c.help, "_blank", "noopener,noreferrer");
                            setValues({});
                            setAsking(c.id);
                          } else void add(c);
                        }}
                      >
                        {t("res.catalog.add")}
                      </Button>
                    )}
                    {open && (
                      <div className="catalog__keys">
                        {c.keys?.map((k) => (
                          <Input
                            key={k.env}
                            aria-label={es ? k.label[0] : k.label[1]}
                            placeholder={es ? k.label[0] : k.label[1]}
                            type="password"
                            autoComplete="off"
                            value={values[k.env] ?? ""}
                            onChange={(e) => setValues({ ...values, [k.env]: e.currentTarget.value })}
                          />
                        ))}
                        <div className="catalog__keyrow">
                          {c.help && (
                            <a href={c.help} target="_blank" rel="noreferrer">
                              {t("res.catalog.keyHow")}
                            </a>
                          )}
                          <span className="catalog__spacer" />
                          <Button size="sm" variant="ghost" onClick={() => setAsking(undefined)}>
                            {t("res.catalog.cancel")}
                          </Button>
                          <Button size="sm" disabled={!filled} loading={busy === c.id} onClick={() => void add(c)}>
                            {t("res.catalog.add")}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
      {connecting && (
        <ConnectForm
          i={connecting}
          title={t("int.connectTitle", { name: connecting.label })}
          onClose={() => setConnecting(undefined)}
          onDone={async () => {
            setConnecting(undefined);
            await loadOwn();
          }}
        />
      )}
    </div>
  );
}

export function ConnectorCatalogDialog({
  servers,
  onClose,
  onAdded,
}: {
  servers: readonly McpServerStatus[] | undefined;
  onClose: () => void;
  onAdded: (name: string) => void | Promise<void>;
}) {
  const t = useT();
  return (
    <Dialog open size="lg" onOpenChange={(o) => !o && onClose()} title={t("res.catalog.title")}>
      <ConnectorCatalog
        servers={servers}
        onAdded={async (name) => {
          await onAdded(name);
          onClose();
        }}
      />
    </Dialog>
  );
}
