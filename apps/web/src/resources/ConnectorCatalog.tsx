// CATALOGO-CONECTORES-1: the connectors a business usually wants, one click each. The ones that ask for a sign-in run
// through mcp-remote, which opens the service's own login in the browser and keeps the session (Colonia's MCP client
// has no sign-in of its own). Every address was checked to answer as MCP and to accept a new app registering itself;
// Asana, GitHub, HubSpot, Box and Slack are left out because they do not (only their approved apps get in).
import type { McpServerStatus } from "@colonia/protocol";
import { Button, Dialog, Icons, SearchField } from "@colonia/ui";
import { useState } from "react";
import { type McpDraft, setMcp } from "../data/resources.ts";
import { useLanguage, useT } from "../i18n/index.ts";

type Category = "work" | "design" | "sales" | "web" | "dev";
type Connector = { id: string; name: string; domain: string; category: Category; desc: [es: string, en: string] } & (
  | { remote: string }
  | { url: string }
  | { npx: string[] }
);

export const CONNECTORS: readonly Connector[] = [
  {
    id: "notion",
    name: "Notion",
    domain: "notion.so",
    category: "work",
    remote: "https://mcp.notion.com/mcp",
    desc: ["Páginas, bases de datos y notas", "Pages, databases and notes"],
  },
  {
    id: "canva",
    name: "Canva",
    domain: "canva.com",
    category: "design",
    remote: "https://mcp.canva.com/mcp",
    desc: ["Diseños, presentaciones y redes", "Designs, decks and social posts"],
  },
  {
    id: "linear",
    name: "Linear",
    domain: "linear.app",
    category: "work",
    remote: "https://mcp.linear.app/mcp",
    desc: ["Incidencias y proyectos", "Issues and projects"],
  },
  {
    id: "atlassian",
    name: "Jira y Confluence",
    domain: "atlassian.com",
    category: "work",
    remote: "https://mcp.atlassian.com/v1/mcp",
    desc: ["Tickets de Jira y páginas de Confluence", "Jira tickets and Confluence pages"],
  },
  {
    id: "monday",
    name: "monday.com",
    domain: "monday.com",
    category: "work",
    remote: "https://mcp.monday.com/mcp",
    desc: ["Tableros y tareas del equipo", "Team boards and tasks"],
  },
  {
    id: "clickup",
    name: "ClickUp",
    domain: "clickup.com",
    category: "work",
    remote: "https://mcp.clickup.com/mcp",
    desc: ["Tareas, documentos y objetivos", "Tasks, docs and goals"],
  },
  {
    id: "airtable",
    name: "Airtable",
    domain: "airtable.com",
    category: "work",
    remote: "https://mcp.airtable.com/mcp",
    desc: ["Bases y tablas", "Bases and tables"],
  },
  {
    id: "miro",
    name: "Miro",
    domain: "miro.com",
    category: "design",
    remote: "https://mcp.miro.com/",
    desc: ["Pizarras y diagramas", "Boards and diagrams"],
  },
  {
    id: "figma",
    name: "Figma",
    domain: "figma.com",
    category: "design",
    remote: "https://mcp.figma.com/mcp",
    desc: ["Diseños y prototipos", "Designs and prototypes"],
  },
  {
    id: "gamma",
    name: "Gamma",
    domain: "gamma.app",
    category: "design",
    remote: "https://mcp.gamma.app/mcp",
    desc: ["Presentaciones y documentos con IA", "AI decks and documents"],
  },
  {
    id: "zapier",
    name: "Zapier",
    domain: "zapier.com",
    category: "work",
    remote: "https://mcp.zapier.com/api/mcp/mcp",
    desc: ["Miles de apps conectadas", "Thousands of connected apps"],
  },
  {
    id: "intercom",
    name: "Intercom",
    domain: "intercom.com",
    category: "sales",
    remote: "https://mcp.intercom.com/mcp",
    desc: ["Conversaciones de soporte", "Support conversations"],
  },
  {
    id: "stripe",
    name: "Stripe",
    domain: "stripe.com",
    category: "sales",
    remote: "https://mcp.stripe.com",
    desc: ["Pagos, clientes y facturas", "Payments, customers and invoices"],
  },
  {
    id: "paypal",
    name: "PayPal",
    domain: "paypal.com",
    category: "sales",
    remote: "https://mcp.paypal.com/mcp",
    desc: ["Pagos y facturas", "Payments and invoices"],
  },
  {
    id: "square",
    name: "Square",
    domain: "squareup.com",
    category: "sales",
    remote: "https://mcp.squareup.com/sse",
    desc: ["Ventas, pedidos y catálogo", "Sales, orders and catalog"],
  },
  {
    id: "webflow",
    name: "Webflow",
    domain: "webflow.com",
    category: "web",
    remote: "https://mcp.webflow.com/mcp",
    desc: ["Webs y contenido del CMS", "Sites and CMS content"],
  },
  {
    id: "wix",
    name: "Wix",
    domain: "wix.com",
    category: "web",
    remote: "https://mcp.wix.com/mcp",
    desc: ["Tu web, tienda y reservas", "Your site, store and bookings"],
  },
  {
    id: "shopify-dev",
    name: "Shopify (documentación)",
    domain: "shopify.com",
    category: "web",
    url: "https://mcp.shopify.com/mcp",
    desc: ["Documentación y API de Shopify", "Shopify docs and API"],
  },
  {
    id: "cloudflare",
    name: "Cloudflare",
    domain: "cloudflare.com",
    category: "dev",
    remote: "https://bindings.mcp.cloudflare.com/mcp",
    desc: ["Workers, bases y almacenamiento", "Workers, databases and storage"],
  },
  {
    id: "vercel",
    name: "Vercel",
    domain: "vercel.com",
    category: "dev",
    remote: "https://mcp.vercel.com",
    desc: ["Proyectos y despliegues", "Projects and deployments"],
  },
  {
    id: "supabase",
    name: "Supabase",
    domain: "supabase.com",
    category: "dev",
    remote: "https://mcp.supabase.com/mcp",
    desc: ["Bases de datos y autenticación", "Databases and auth"],
  },
  {
    id: "sentry",
    name: "Sentry",
    domain: "sentry.io",
    category: "dev",
    remote: "https://mcp.sentry.dev/mcp",
    desc: ["Errores y rendimiento", "Errors and performance"],
  },
  {
    id: "huggingface",
    name: "Hugging Face",
    domain: "huggingface.co",
    category: "dev",
    url: "https://huggingface.co/mcp",
    desc: ["Modelos, datasets y Spaces", "Models, datasets and Spaces"],
  },
  {
    id: "playwright",
    name: "Playwright",
    domain: "playwright.dev",
    category: "dev",
    npx: ["@playwright/mcp@latest"],
    desc: ["Navegador que los agentes manejan", "A browser the agents drive"],
  },
];

const CATEGORIES: readonly Category[] = ["work", "design", "sales", "web", "dev"];

/** How the connector is added: a sign-in through mcp-remote, a plain address, or a package it starts. */
export function connectorServer(c: Connector): McpDraft {
  if ("remote" in c) return { command: "npx", args: ["-y", "mcp-remote", c.remote], env: {} };
  if ("url" in c) return { url: c.url, headers: {} };
  return { command: "npx", args: ["-y", ...c.npx], env: {} };
}

/** The service's own logo (its favicon, large), the plug if it does not load. */
function Logo({ domain }: { domain: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <Icons.Plug size={22} />;
  return (
    <img
      src={`https://www.google.com/s2/favicons?domain=${domain}&sz=64`}
      alt=""
      width={28}
      height={28}
      onError={() => setFailed(true)}
    />
  );
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
  const have = new Set((servers ?? []).filter((s) => s.scope === "global").map((s) => s.name));
  const q = query.trim().toLowerCase();
  const shown = CONNECTORS.filter((c) => !q || `${c.name} ${c.desc.join(" ")}`.toLowerCase().includes(q));
  const add = async (c: Connector) => {
    setBusy(c.id);
    const r = await setMcp(c.id, connectorServer(c));
    setBusy(undefined);
    if (r) await onAdded(c.id);
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
        if (!items.length) return null;
        return (
          <section key={cat} className="catalog__group">
            <div className="resv__grouptitle">{t(`res.catalog.cat.${cat}`)}</div>
            <div className="catalog__grid">
              {items.map((c) => {
                const on = have.has(c.id);
                return (
                  <div key={c.id} className="catalog__card">
                    <span className="catalog__logo">
                      <Logo domain={c.domain} />
                    </span>
                    <span className="catalog__text">
                      <span className="catalog__name">{c.name}</span>
                      <span className="catalog__desc">{es ? c.desc[0] : c.desc[1]}</span>
                    </span>
                    {on ? (
                      <span className="catalog__on">
                        <Icons.Check size={14} /> {t("res.catalog.added")}
                      </span>
                    ) : (
                      <Button size="sm" variant="secondary" loading={busy === c.id} onClick={() => void add(c)}>
                        {t("res.catalog.add")}
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
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
      <ConnectorCatalog servers={servers} onAdded={onAdded} />
    </Dialog>
  );
}
