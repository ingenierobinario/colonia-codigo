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
import { type McpDraft, setMcp, setSecret } from "../data/resources.ts";
import { useLanguage, useT } from "../i18n/index.ts";
import { ConnectForm, type Integration } from "./IntegrationsTab.tsx";

/** Colonia's own social connectors: listed with the social connectors, they connect in the same form as in Integrations. */
const OWN_SOCIAL = ["youtube", "x", "meta", "linkedin", "tiktok"] as const;

type Category = "work" | "docs" | "design" | "sales" | "marketing" | "social" | "web" | "data" | "dev";
type Key = { env: string; label: [es: string, en: string]; bearer?: boolean };
type Connector = {
  id: string;
  name: string;
  domain: string;
  category: Category;
  desc: [es: string, en: string];
  /** Where to create the key, for the ones that need one. */
  help?: string;
  keys?: Key[];
} & ({ remote: string } | { url: string } | { npx: string[] });

const r = (id: string, name: string, domain: string, category: Category, remote: string, es: string, en: string) =>
  ({ id, name, domain, category, remote, desc: [es, en] }) satisfies Connector;
const u = (id: string, name: string, domain: string, category: Category, url: string, es: string, en: string) =>
  ({ id, name, domain, category, url, desc: [es, en] }) satisfies Connector;

const TOKEN: [string, string] = ["Clave personal", "Personal key"];

export const CONNECTORS: readonly Connector[] = [
  // Trabajo y equipo
  r(
    "notion",
    "Notion",
    "notion.so",
    "work",
    "https://mcp.notion.com/mcp",
    "Páginas, bases de datos y notas",
    "Pages, databases and notes",
  ),
  r("asana", "Asana", "asana.com", "work", "https://mcp.asana.com/sse", "Proyectos y tareas", "Projects and tasks"),
  r(
    "linear",
    "Linear",
    "linear.app",
    "work",
    "https://mcp.linear.app/mcp",
    "Incidencias y proyectos",
    "Issues and projects",
  ),
  r(
    "atlassian",
    "Jira y Confluence",
    "atlassian.com",
    "work",
    "https://mcp.atlassian.com/v1/mcp",
    "Tickets y páginas del equipo",
    "Tickets and team pages",
  ),
  r(
    "monday",
    "monday.com",
    "monday.com",
    "work",
    "https://mcp.monday.com/mcp",
    "Tableros y tareas del equipo",
    "Team boards and tasks",
  ),
  r(
    "clickup",
    "ClickUp",
    "clickup.com",
    "work",
    "https://mcp.clickup.com/mcp",
    "Tareas, documentos y objetivos",
    "Tasks, docs and goals",
  ),
  r(
    "basecamp",
    "Basecamp",
    "basecamp.com",
    "work",
    "https://mcp.basecamp.com/mcp",
    "Proyectos y mensajes del equipo",
    "Projects and team messages",
  ),
  r(
    "todoist",
    "Todoist",
    "todoist.com",
    "work",
    "https://ai.todoist.net/mcp",
    "Tus tareas y listas",
    "Your tasks and lists",
  ),
  r(
    "zapier",
    "Zapier",
    "zapier.com",
    "work",
    "https://mcp.zapier.com/api/mcp/mcp",
    "Miles de apps conectadas",
    "Thousands of connected apps",
  ),
  r(
    "make",
    "Make",
    "make.com",
    "work",
    "https://mcp.make.com",
    "Tus escenarios de automatización",
    "Your automation scenarios",
  ),
  r("calcom", "Cal.com", "cal.com", "work", "https://mcp.cal.com/mcp", "Reservas y agenda", "Bookings and calendar"),
  r(
    "fathom",
    "Fathom",
    "fathom.video",
    "work",
    "https://api.fathom.ai/mcp",
    "Grabaciones y resúmenes de reuniones",
    "Meeting recordings and notes",
  ),
  r(
    "otter",
    "Otter",
    "otter.ai",
    "work",
    "https://mcp.otter.ai/mcp",
    "Transcripciones de reuniones",
    "Meeting transcripts",
  ),
  r(
    "fireflies",
    "Fireflies",
    "fireflies.ai",
    "work",
    "https://api.fireflies.ai/mcp",
    "Notas de tus llamadas",
    "Notes from your calls",
  ),
  r("granola", "Granola", "granola.ai", "work", "https://mcp.granola.ai/mcp", "Notas de reuniones", "Meeting notes"),
  r("tldv", "tl;dv", "tldv.io", "work", "https://mcp.tldv.io/mcp", "Reuniones grabadas", "Recorded meetings"),
  {
    id: "slack",
    name: "Slack",
    domain: "slack.com",
    category: "work",
    npx: ["@modelcontextprotocol/server-slack"],
    help: "https://api.slack.com/apps",
    keys: [
      { env: "SLACK_BOT_TOKEN", label: ["Clave del bot (xoxb-…)", "Bot key (xoxb-…)"] },
      { env: "SLACK_TEAM_ID", label: ["Código del espacio (T…)", "Workspace code (T…)"] },
    ],
    desc: ["Canales y mensajes", "Channels and messages"],
  },
  r(
    "shortcut",
    "Shortcut",
    "shortcut.com",
    "work",
    "https://mcp.shortcut.com/mcp",
    "Historias y proyectos",
    "Stories and projects",
  ),
  r(
    "productboard",
    "Productboard",
    "productboard.com",
    "work",
    "https://mcp.productboard.com/mcp",
    "Ideas y hoja de ruta",
    "Ideas and roadmap",
  ),
  r(
    "pipedream",
    "Pipedream",
    "pipedream.com",
    "work",
    "https://mcp.pipedream.net/v2",
    "Miles de apps conectadas",
    "Thousands of connected apps",
  ),
  r(
    "helpscout",
    "Help Scout",
    "helpscout.com",
    "work",
    "https://mcp.helpscout.net/mcp",
    "Bandeja de soporte",
    "Support inbox",
  ),
  r("evernote", "Evernote", "evernote.com", "work", "https://mcp.evernote.com/mcp", "Tus notas", "Your notes"),
  // Documentos y archivos
  r(
    "dropbox",
    "Dropbox",
    "dropbox.com",
    "docs",
    "https://mcp.dropbox.com/mcp",
    "Tus archivos y carpetas",
    "Your files and folders",
  ),
  {
    id: "box",
    name: "Box",
    domain: "box.com",
    category: "docs",
    remote: "https://mcp.box.com",
    help: "https://developer.box.com/guides/authentication/tokens/developer-tokens/",
    keys: [{ env: "AUTH", label: TOKEN, bearer: true }],
    desc: ["Archivos de la empresa", "Company files"],
  },
  r(
    "egnyte",
    "Egnyte",
    "egnyte.com",
    "docs",
    "https://mcp-server.egnyte.com/mcp",
    "Archivos de la empresa",
    "Company files",
  ),
  r("coda", "Coda", "coda.io", "docs", "https://coda.io/apis/mcp", "Documentos y tablas", "Docs and tables"),
  r(
    "guru",
    "Guru",
    "getguru.com",
    "docs",
    "https://mcp.api.getguru.com/mcp",
    "Base de conocimiento del equipo",
    "Team knowledge base",
  ),
  r(
    "airtable",
    "Airtable",
    "airtable.com",
    "docs",
    "https://mcp.airtable.com/mcp",
    "Bases y tablas",
    "Bases and tables",
  ),
  r(
    "tally",
    "Tally",
    "tally.so",
    "docs",
    "https://mcp.tally.so/mcp",
    "Formularios y respuestas",
    "Forms and responses",
  ),
  u(
    "typeform",
    "Typeform",
    "typeform.com",
    "docs",
    "https://mcp.typeform.com/mcp",
    "Formularios y respuestas",
    "Forms and responses",
  ),
  r(
    "jotform",
    "Jotform",
    "jotform.com",
    "docs",
    "https://mcp.jotform.com",
    "Formularios y respuestas",
    "Forms and responses",
  ),
  r(
    "surveymonkey",
    "SurveyMonkey",
    "surveymonkey.com",
    "docs",
    "https://mcp.surveymonkey.com/mcp",
    "Encuestas y resultados",
    "Surveys and results",
  ),
  r(
    "contentful",
    "Contentful",
    "contentful.com",
    "docs",
    "https://mcp.contentful.com/mcp",
    "Contenido de tu web",
    "Your site's content",
  ),
  r("sanity", "Sanity", "sanity.io", "docs", "https://mcp.sanity.io", "Contenido de tu web", "Your site's content"),
  // Diseño
  r(
    "canva",
    "Canva",
    "canva.com",
    "design",
    "https://mcp.canva.com/mcp",
    "Diseños, presentaciones y redes",
    "Designs, decks and social posts",
  ),
  r(
    "figma",
    "Figma",
    "figma.com",
    "design",
    "https://mcp.figma.com/mcp",
    "Diseños y prototipos",
    "Designs and prototypes",
  ),
  r("miro", "Miro", "miro.com", "design", "https://mcp.miro.com/", "Pizarras y diagramas", "Boards and diagrams"),
  r("lucid", "Lucid", "lucid.co", "design", "https://mcp.lucid.app/mcp", "Diagramas y pizarras", "Diagrams and boards"),
  r(
    "gamma",
    "Gamma",
    "gamma.app",
    "design",
    "https://mcp.gamma.app/mcp",
    "Presentaciones y documentos con IA",
    "AI decks and documents",
  ),
  u(
    "excalidraw",
    "Excalidraw",
    "excalidraw.com",
    "design",
    "https://mcp.excalidraw.com/mcp",
    "Bocetos y esquemas",
    "Sketches and diagrams",
  ),
  r(
    "runway",
    "Runway",
    "runwayml.com",
    "design",
    "https://mcp.runwayml.com/mcp",
    "Vídeo e imagen con IA",
    "AI video and images",
  ),
  r("heygen", "HeyGen", "heygen.com", "design", "https://mcp.heygen.com/mcp/v1/", "Vídeos con avatar", "Avatar videos"),
  r("vimeo", "Vimeo", "vimeo.com", "design", "https://mcp.vimeo.com/mcp", "Tus vídeos", "Your videos"),
  r(
    "cloudinary",
    "Cloudinary",
    "cloudinary.com",
    "design",
    "https://asset-management.mcp.cloudinary.com/mcp",
    "Imágenes y vídeos de tu web",
    "Your site's images and videos",
  ),
  // Ventas y pagos
  {
    id: "hubspot",
    name: "HubSpot",
    domain: "hubspot.com",
    category: "sales",
    npx: ["@hubspot/mcp-server"],
    help: "https://developers.hubspot.com/docs/api/private-apps",
    keys: [{ env: "PRIVATE_APP_ACCESS_TOKEN", label: ["Clave de app privada", "Private app key"] }],
    desc: ["Contactos, empresas y negocios", "Contacts, companies and deals"],
  },
  r("attio", "Attio", "attio.com", "sales", "https://mcp.attio.com/mcp", "Tu CRM", "Your CRM"),
  r("close", "Close", "close.com", "sales", "https://mcp.close.com/mcp", "CRM de ventas", "Sales CRM"),
  r(
    "apollo",
    "Apollo",
    "apollo.io",
    "sales",
    "https://mcp.apollo.io/mcp",
    "Prospectos y secuencias",
    "Prospects and sequences",
  ),
  r(
    "intercom",
    "Intercom",
    "intercom.com",
    "sales",
    "https://mcp.intercom.com/mcp",
    "Conversaciones de soporte",
    "Support conversations",
  ),
  {
    id: "stripe",
    name: "Stripe",
    domain: "stripe.com",
    category: "sales",
    url: "https://mcp.stripe.com",
    help: "https://dashboard.stripe.com/apikeys",
    keys: [{ env: "Authorization", label: ["Clave restringida (rk_…)", "Restricted key (rk_…)"], bearer: true }],
    desc: ["Pagos, clientes y facturas", "Payments, customers and invoices"],
  },
  r(
    "paypal",
    "PayPal",
    "paypal.com",
    "sales",
    "https://mcp.paypal.com/mcp",
    "Pagos y facturas",
    "Payments and invoices",
  ),
  r(
    "square",
    "Square",
    "squareup.com",
    "sales",
    "https://mcp.squareup.com/sse",
    "Ventas, pedidos y catálogo",
    "Sales, orders and catalog",
  ),
  r(
    "mercadopago",
    "Mercado Pago",
    "mercadopago.com",
    "sales",
    "https://mcp.mercadopago.com/mcp",
    "Cobros y pagos",
    "Payments",
  ),
  r(
    "holded",
    "Holded",
    "holded.com",
    "sales",
    "https://mcp.holded.com/mcp",
    "Facturas, contabilidad y clientes",
    "Invoices, accounting and customers",
  ),
  r(
    "ramp",
    "Ramp",
    "ramp.com",
    "sales",
    "https://ramp-mcp-remote.ramp.com/mcp",
    "Gastos y tarjetas",
    "Spend and cards",
  ),
  r(
    "mercury",
    "Mercury",
    "mercury.com",
    "sales",
    "https://mcp.mercury.com/mcp",
    "Tu cuenta del banco",
    "Your bank account",
  ),
  r(
    "plaid",
    "Plaid",
    "plaid.com",
    "sales",
    "https://api.dashboard.plaid.com/mcp/sse",
    "Cuentas bancarias conectadas",
    "Connected bank accounts",
  ),
  r(
    "paddle",
    "Paddle",
    "paddle.com",
    "sales",
    "https://mcp.paddle.com/mcp",
    "Cobros y suscripciones",
    "Payments and subscriptions",
  ),
  r(
    "qonto",
    "Qonto",
    "qonto.com",
    "sales",
    "https://mcp.qonto.com/mcp",
    "Tu cuenta de empresa",
    "Your business account",
  ),
  // Marketing
  r(
    "klaviyo",
    "Klaviyo",
    "klaviyo.com",
    "marketing",
    "https://mcp.klaviyo.com/mcp",
    "Correos y listas",
    "Emails and lists",
  ),
  r(
    "semrush",
    "Semrush",
    "semrush.com",
    "marketing",
    "https://mcp.semrush.com/v1/mcp",
    "SEO y competencia",
    "SEO and competitors",
  ),
  r(
    "ahrefs",
    "Ahrefs",
    "ahrefs.com",
    "marketing",
    "https://api.ahrefs.com/mcp/mcp",
    "SEO y enlaces",
    "SEO and backlinks",
  ),
  r(
    "similarweb",
    "Similarweb",
    "similarweb.com",
    "marketing",
    "https://mcp.similarweb.com",
    "Tráfico de webs",
    "Web traffic",
  ),
  r("buffer", "Buffer", "buffer.com", "social", "https://mcp.buffer.com/mcp", "Publicaciones en redes", "Social posts"),
  r(
    "metricool",
    "Metricool",
    "metricool.com",
    "social",
    "https://ai.metricool.com/mcp",
    "Redes y analítica",
    "Social and analytics",
  ),
  r(
    "bitly",
    "Bitly",
    "bitly.com",
    "marketing",
    "https://api-ssl.bitly.com/v4/mcp",
    "Enlaces cortos y clics",
    "Short links and clicks",
  ),
  r(
    "mailerlite",
    "MailerLite",
    "mailerlite.com",
    "marketing",
    "https://mcp.mailerlite.com/mcp",
    "Correos y suscriptores",
    "Emails and subscribers",
  ),
  r(
    "beehiiv",
    "beehiiv",
    "beehiiv.com",
    "marketing",
    "https://mcp.beehiiv.com/mcp",
    "Tu newsletter",
    "Your newsletter",
  ),
  r("resend", "Resend", "resend.com", "marketing", "https://mcp.resend.com/mcp", "Envío de correos", "Email sending"),
  // Redes sociales
  r(
    "businessstack",
    "Business Stack",
    "business-stack.ingenierobinario.com",
    "social",
    "https://business-stack.ingenierobinario.com/mcp",
    "Instagram, Facebook, LinkedIn, TikTok, YouTube y X desde tu panel",
    "Instagram, Facebook, LinkedIn, TikTok, YouTube and X from your panel",
  ),
  r(
    "metaads",
    "Meta Ads",
    "facebook.com",
    "social",
    "https://mcp.facebook.com/ads",
    "Campañas y resultados de tus anuncios de Facebook e Instagram",
    "Campaigns and results of your Facebook and Instagram ads",
  ),
  r(
    "whatsappbusiness",
    "WhatsApp Business",
    "whatsapp.com",
    "social",
    "https://mcp.facebook.com/whatsapp_business_tools",
    "Números y plantillas de mensaje de tu cuenta de empresa",
    "Numbers and message templates of your business account",
  ),
  r(
    "tiktokads",
    "TikTok Ads",
    "tiktok.com",
    "social",
    "https://business-api.tiktok.com/open_mcp/tt-ads-mcp-flat",
    "Campañas e informes de tus anuncios de TikTok",
    "Campaigns and reports of your TikTok ads",
  ),
  {
    id: "posteverywhere",
    name: "PostEverywhere",
    domain: "posteverywhere.ai",
    category: "social",
    npx: ["@posteverywhere/mcp"],
    help: "https://app.posteverywhere.ai/developers",
    keys: [{ env: "POSTEVERYWHERE_API_KEY", label: ["Clave de PostEverywhere", "PostEverywhere key"] }],
    desc: ["Publica en Instagram, TikTok, LinkedIn y más", "Post to Instagram, TikTok, LinkedIn and more"],
  },
  // Web y tienda
  r(
    "webflow",
    "Webflow",
    "webflow.com",
    "web",
    "https://mcp.webflow.com/mcp",
    "Webs y contenido del CMS",
    "Sites and CMS content",
  ),
  r(
    "wix",
    "Wix",
    "wix.com",
    "web",
    "https://mcp.wix.com/mcp",
    "Tu web, tienda y reservas",
    "Your site, store and bookings",
  ),
  r("framer", "Framer", "framer.com", "web", "https://mcp.framer.com/mcp", "Tu web en Framer", "Your Framer site"),
  r(
    "wordpress",
    "WordPress.com",
    "wordpress.com",
    "web",
    "https://public-api.wordpress.com/wpcom/v2/mcp/v1",
    "Entradas y páginas",
    "Posts and pages",
  ),
  u(
    "squarespace",
    "Squarespace",
    "squarespace.com",
    "web",
    "https://mcp.squarespace.com/mcp",
    "Tu web en Squarespace",
    "Your Squarespace site",
  ),
  u(
    "godaddy",
    "GoDaddy",
    "godaddy.com",
    "web",
    "https://api.godaddy.com/v1/domains/mcp",
    "Buscar dominios libres",
    "Find available domains",
  ),
  u(
    "shopify-dev",
    "Shopify (documentación)",
    "shopify.com",
    "web",
    "https://mcp.shopify.com/mcp",
    "Documentación y API de Shopify",
    "Shopify docs and API",
  ),
  u(
    "mercadolibre",
    "Mercado Libre",
    "mercadolibre.com",
    "web",
    "https://mcp.mercadolibre.com/mcp",
    "Documentación para vendedores",
    "Seller docs",
  ),
  u("kiwi", "Kiwi.com", "kiwi.com", "web", "https://mcp.kiwi.com", "Buscar vuelos", "Search flights"),
  // Datos e IA
  r(
    "amplitude",
    "Amplitude",
    "amplitude.com",
    "data",
    "https://mcp.amplitude.com/mcp",
    "Analítica de producto",
    "Product analytics",
  ),
  r(
    "mixpanel",
    "Mixpanel",
    "mixpanel.com",
    "data",
    "https://mcp.mixpanel.com/mcp",
    "Analítica de producto",
    "Product analytics",
  ),
  r(
    "posthog",
    "PostHog",
    "posthog.com",
    "data",
    "https://mcp.posthog.com/mcp",
    "Analítica y grabaciones",
    "Analytics and recordings",
  ),
  r("hex", "Hex", "hex.tech", "data", "https://app.hex.tech/mcp", "Análisis de datos", "Data analysis"),
  r("replicate", "Replicate", "replicate.com", "data", "https://mcp.replicate.com/mcp", "Modelos de IA", "AI models"),
  u(
    "huggingface",
    "Hugging Face",
    "huggingface.co",
    "data",
    "https://huggingface.co/mcp",
    "Modelos, datasets y Spaces",
    "Models, datasets and Spaces",
  ),
  u("exa", "Exa", "exa.ai", "data", "https://mcp.exa.ai/mcp", "Búsqueda en la web", "Web search"),
  u(
    "deepwiki",
    "DeepWiki",
    "deepwiki.com",
    "data",
    "https://mcp.deepwiki.com/mcp",
    "Explica repositorios de GitHub",
    "Explains GitHub repositories",
  ),
  u(
    "context7",
    "Context7",
    "context7.com",
    "data",
    "https://mcp.context7.com/mcp",
    "Documentación al día de librerías",
    "Up-to-date library docs",
  ),
  r("tavily", "Tavily", "tavily.com", "data", "https://mcp.tavily.com/mcp", "Búsqueda en la web", "Web search"),
  r("apify", "Apify", "apify.com", "data", "https://mcp.apify.com", "Extraer datos de webs", "Scrape data from sites"),
  r(
    "openrouter",
    "OpenRouter",
    "openrouter.ai",
    "data",
    "https://mcp.openrouter.ai/mcp",
    "Cientos de modelos de IA",
    "Hundreds of AI models",
  ),
  r(
    "algolia",
    "Algolia",
    "algolia.com",
    "data",
    "https://mcp.algolia.com/mcp",
    "Buscador de tu web",
    "Your site's search",
  ),
  r(
    "clickhouse",
    "ClickHouse",
    "clickhouse.com",
    "data",
    "https://mcp.clickhouse.cloud/mcp",
    "Bases de datos analíticas",
    "Analytics databases",
  ),
  r(
    "motherduck",
    "MotherDuck",
    "motherduck.com",
    "data",
    "https://api.motherduck.com/mcp",
    "Análisis con DuckDB",
    "DuckDB analytics",
  ),
  {
    id: "firecrawl",
    name: "Firecrawl",
    domain: "firecrawl.dev",
    category: "data",
    npx: ["firecrawl-mcp"],
    help: "https://www.firecrawl.dev/app/api-keys",
    keys: [{ env: "FIRECRAWL_API_KEY", label: ["Clave de Firecrawl", "Firecrawl key"] }],
    desc: ["Leer y extraer webs", "Read and scrape sites"],
  },
  {
    id: "perplexity",
    name: "Perplexity",
    domain: "perplexity.ai",
    category: "data",
    npx: ["@perplexity-ai/mcp-server"],
    help: "https://www.perplexity.ai/account/api/keys",
    keys: [{ env: "PERPLEXITY_API_KEY", label: ["Clave de Perplexity", "Perplexity key"] }],
    desc: ["Búsqueda con respuestas", "Search with answers"],
  },
  {
    id: "brave",
    name: "Brave Search",
    domain: "search.brave.com",
    category: "data",
    npx: ["@modelcontextprotocol/server-brave-search"],
    help: "https://api-dashboard.search.brave.com/app/keys",
    keys: [{ env: "BRAVE_API_KEY", label: ["Clave de Brave Search", "Brave Search key"] }],
    desc: ["Búsqueda en la web", "Web search"],
  },
  {
    id: "brightdata",
    name: "Bright Data",
    domain: "brightdata.com",
    category: "data",
    npx: ["@brightdata/mcp"],
    help: "https://brightdata.com/cp/setting/users",
    keys: [{ env: "API_TOKEN", label: ["Clave de Bright Data", "Bright Data key"] }],
    desc: ["Extraer datos de webs", "Scrape data from sites"],
  },
  {
    id: "googlemaps",
    name: "Google Maps",
    domain: "maps.google.com",
    category: "data",
    npx: ["@modelcontextprotocol/server-google-maps"],
    help: "https://console.cloud.google.com/google/maps-apis/credentials",
    keys: [{ env: "GOOGLE_MAPS_API_KEY", label: ["Clave de Google Maps", "Google Maps key"] }],
    desc: ["Lugares, direcciones y rutas", "Places, addresses and routes"],
  },
  {
    id: "memory",
    name: "Memoria",
    domain: "modelcontextprotocol.io",
    category: "data",
    npx: ["@modelcontextprotocol/server-memory"],
    desc: ["Lo que los agentes recuerdan entre sesiones", "What agents remember across sessions"],
  },
  // Desarrollo
  {
    id: "github",
    name: "GitHub",
    domain: "github.com",
    category: "dev",
    url: "https://api.githubcopilot.com/mcp/",
    help: "https://github.com/settings/personal-access-tokens/new",
    keys: [{ env: "Authorization", label: TOKEN, bearer: true }],
    desc: ["Repositorios, incidencias y cambios", "Repos, issues and pull requests"],
  },
  r(
    "cloudflare",
    "Cloudflare",
    "cloudflare.com",
    "dev",
    "https://bindings.mcp.cloudflare.com/mcp",
    "Workers, bases y almacenamiento",
    "Workers, databases and storage",
  ),
  r(
    "vercel",
    "Vercel",
    "vercel.com",
    "dev",
    "https://mcp.vercel.com",
    "Proyectos y despliegues",
    "Projects and deployments",
  ),
  r(
    "netlify",
    "Netlify",
    "netlify.com",
    "dev",
    "https://netlify-mcp.netlify.app/mcp",
    "Webs y despliegues",
    "Sites and deploys",
  ),
  r(
    "supabase",
    "Supabase",
    "supabase.com",
    "dev",
    "https://mcp.supabase.com/mcp",
    "Bases de datos y autenticación",
    "Databases and auth",
  ),
  r("neon", "Neon", "neon.tech", "dev", "https://mcp.neon.tech/mcp", "Bases de datos Postgres", "Postgres databases"),
  r(
    "prisma",
    "Prisma",
    "prisma.io",
    "dev",
    "https://mcp.prisma.io/mcp",
    "Bases de datos Postgres",
    "Postgres databases",
  ),
  r(
    "sentry",
    "Sentry",
    "sentry.io",
    "dev",
    "https://mcp.sentry.dev/mcp",
    "Errores y rendimiento",
    "Errors and performance",
  ),
  r(
    "datadog",
    "Datadog",
    "datadoghq.com",
    "dev",
    "https://mcp.datadoghq.com/api/unstable/mcp-server/mcp",
    "Monitorización y registros",
    "Monitoring and logs",
  ),
  r("postman", "Postman", "postman.com", "dev", "https://mcp.postman.com/mcp", "Colecciones de API", "API collections"),
  r("jam", "Jam", "jam.dev", "dev", "https://mcp.jam.dev/mcp", "Informes de fallos", "Bug reports"),
  r(
    "stytch",
    "Stytch",
    "stytch.com",
    "dev",
    "https://mcp.stytch.dev/mcp",
    "Inicio de sesión de tu app",
    "Your app's sign-in",
  ),
  r(
    "railway",
    "Railway",
    "railway.com",
    "dev",
    "https://mcp.railway.com",
    "Proyectos, servicios y despliegues",
    "Projects, services and deploys",
  ),
  r("heroku", "Heroku", "heroku.com", "dev", "https://mcp.heroku.com/mcp", "Apps y despliegues", "Apps and deploys"),
  r(
    "digitalocean",
    "DigitalOcean",
    "digitalocean.com",
    "dev",
    "https://mcp.digitalocean.com/mcp",
    "Servidores y apps",
    "Servers and apps",
  ),
  r(
    "gitlab",
    "GitLab",
    "gitlab.com",
    "dev",
    "https://gitlab.com/api/v4/mcp",
    "Repositorios e incidencias",
    "Repos and issues",
  ),
  r(
    "bitbucket",
    "Bitbucket",
    "bitbucket.org",
    "dev",
    "https://mcp.atlassian.com/v1/sse",
    "Repositorios de Atlassian",
    "Atlassian repos",
  ),
  r(
    "planetscale",
    "PlanetScale",
    "planetscale.com",
    "dev",
    "https://mcp.pscale.dev/mcp/planetscale",
    "Bases de datos MySQL y Postgres",
    "MySQL and Postgres databases",
  ),
  r("upstash", "Upstash", "upstash.com", "dev", "https://mcp.upstash.com/mcp", "Redis y colas", "Redis and queues"),
  r("axiom", "Axiom", "axiom.co", "dev", "https://mcp.axiom.co/mcp", "Registros y eventos", "Logs and events"),
  r(
    "grafana",
    "Grafana",
    "grafana.com",
    "dev",
    "https://mcp.grafana.com/mcp",
    "Paneles y alertas",
    "Dashboards and alerts",
  ),
  r(
    "launchdarkly",
    "LaunchDarkly",
    "launchdarkly.com",
    "dev",
    "https://mcp.launchdarkly.com/mcp",
    "Interruptores de funciones",
    "Feature flags",
  ),
  u(
    "socket",
    "Socket",
    "socket.dev",
    "dev",
    "https://mcp.socket.dev/",
    "Seguridad de paquetes npm",
    "npm package security",
  ),
  {
    id: "mongodb",
    name: "MongoDB",
    domain: "mongodb.com",
    category: "dev",
    npx: ["mongodb-mcp-server"],
    help: "https://www.mongodb.com/docs/guides/atlas/connection-string/",
    keys: [
      {
        env: "MDB_MCP_CONNECTION_STRING",
        label: ["Dirección de conexión (mongodb+srv://…)", "Connection string (mongodb+srv://…)"],
      },
    ],
    desc: ["Tus bases de datos", "Your databases"],
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
    const headers = (c.keys ?? []).flatMap((k) => ["--header", `Authorization:\${${k.env}}`]);
    return { command: "npx", args: ["-y", "mcp-remote", c.remote, ...headers], env };
  }
  if ("url" in c) return { url: c.url, headers: env };
  return { command: "npx", args: ["-y", ...c.npx], env };
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
  const have = new Set((servers ?? []).filter((s) => s.scope === "global").map((s) => s.name));
  const q = query.trim().toLowerCase();
  const ownDesc = (i: Integration) => t(`res.catalog.own.${i.id as (typeof OWN_SOCIAL)[number]}`);
  const ownShown = own.filter((i) => !q || `${i.label} ${ownDesc(i)}`.toLowerCase().includes(q));
  const shown = CONNECTORS.filter((c) => !q || `${c.name} ${c.desc.join(" ")}`.toLowerCase().includes(q));
  const add = async (c: Connector) => {
    setBusy(c.id);
    for (const k of c.keys ?? []) {
      if (!(await setSecret(secretName(c, k), (values[k.env] ?? "").trim()))) return setBusy(undefined);
    }
    const ok = await setMcp(c.id, connectorServer(c));
    setBusy(undefined);
    if (ok) {
      setAsking(undefined);
      setValues({});
      await onAdded(c.id);
    }
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
                      <Icons.Check size={14} /> {t("res.catalog.added")}
                    </span>
                  ) : (
                    <Button size="sm" variant="secondary" onClick={() => setConnecting(i)}>
                      {t("res.catalog.add")}
                    </Button>
                  )}
                </div>
              ))}
              {items.map((c) => {
                const on = have.has(c.id);
                const open = asking === c.id && c.keys;
                const filled = (c.keys ?? []).every((k) => (values[k.env] ?? "").trim());
                return (
                  <div key={c.id} className={`catalog__card${open ? " catalog__card--open" : ""}`}>
                    <span className="catalog__logo">
                      <Logo domain={c.domain} />
                    </span>
                    <span className="catalog__text">
                      <span className="catalog__name">{c.name}</span>
                      <span className="catalog__desc" title={c.keys ? t("res.catalog.keyNeeded") : undefined}>
                        {es ? c.desc[0] : c.desc[1]}
                      </span>
                    </span>
                    {on ? (
                      <span className="catalog__on">
                        <Icons.Check size={14} /> {t("res.catalog.added")}
                      </span>
                    ) : open ? null : (
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={busy === c.id}
                        onClick={() => (c.keys ? (setValues({}), setAsking(c.id)) : void add(c))}
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
      <ConnectorCatalog servers={servers} onAdded={onAdded} />
    </Dialog>
  );
}
