// @ts-check
import { copyFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sitemap from "@astrojs/sitemap";
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import { sitePath } from "./src/doc-routes.mjs";

// Where the site is published. Pages write absolute links ("/concepts/agents/"); withBase() below puts this prefix in
// front of them, so moving the site (e.g. under /colonia/docs/) only changes these two values.
const site = process.env.DOCS_SITE ?? "https://colonia.ingenierobinario.com";
// DOCS-1: la documentación se publica en /docs/ (inglés) y /es/docs/ (español). COLONIA_DOCS=0 la apaga.
const fullDocs = process.env.COLONIA_DOCS !== "0";
const base = (process.env.DOCS_BASE ?? "/").replace(/\/?$/, "/");
/** What a link to any page shows when it is shared (public/og.jpg, 1200×630, drawn by scripts/og-image.ts). */
const ogImage = new URL(`${base}og.jpg`, site).href;
const ogImageAlt = "Your own team of AI agents, on your computer.";

/** A remark plugin: absolute links in Markdown and `href`s on components (LinkCard…) get the site's base. */
function withBase() {
  /** @param {string} url */
  const fix = (url) => sitePath(url, base);
  /** @param {any} node */
  const walk = (node) => {
    if (node.type === "link" || node.type === "definition") node.url = fix(node.url);
    if (node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement")
      for (const a of node.attributes ?? [])
        if (a.name === "href" && typeof a.value === "string") a.value = fix(a.value);
    for (const child of node.children ?? []) walk(child);
  };
  return walk;
}

/** The install scripts are served beside the site (<base>install.sh), copied from scripts/install/ at build time. */
function installScripts() {
  const from = new URL("../../scripts/install/", import.meta.url);
  return {
    name: "colonia-install-scripts",
    hooks: {
      /** @param {{ dir: URL }} options */
      "astro:build:done": async ({ dir }) => {
        for (const file of ["install.sh", "install.ps1"])
          await copyFile(fileURLToPath(new URL(file, from)), fileURLToPath(new URL(file, dir)));
      },
    },
  };
}

const section = (/** @type {string} */ label, /** @type {string} */ es, /** @type {string} */ directory) => ({
  label,
  translations: { es },
  items: [{ autogenerate: { directory } }],
});

export default defineConfig({
  site,
  base,
  trailingSlash: "always",
  devToolbar: { enabled: false },
  markdown: { remarkPlugins: [withBase] },
  integrations: [
    sitemap({
      filter: (page) => {
        const path = new URL(page).pathname.slice(base.length - 1);
        return fullDocs ? sitePath(path) === path && !["/docs/", "/es/docs/"].includes(path) : true;
      },
    }),
    ...(fullDocs ? [installScripts()] : []),
    ...(!fullDocs ? [] : [starlight({
      title: "Colonia",
      description: "Colonia: your own team of AI agents, on your computer.",
      logo: { src: "./src/assets/logo.png", alt: "Colonia" },
      favicon: "/favicon.svg",
      customCss: ["./src/styles/theme.css"],
      head: [
        { tag: "link", attrs: { rel: "apple-touch-icon", href: `${base}apple-touch-icon.png` } },
        { tag: "meta", attrs: { property: "og:image", content: ogImage } },
        { tag: "meta", attrs: { property: "og:image:width", content: "1200" } },
        { tag: "meta", attrs: { property: "og:image:height", content: "630" } },
        { tag: "meta", attrs: { property: "og:image:alt", content: ogImageAlt } },
        { tag: "meta", attrs: { name: "twitter:image", content: ogImage } },
        { tag: "link", attrs: { rel: "preconnect", href: "https://fonts.googleapis.com" } },
        { tag: "link", attrs: { rel: "preconnect", href: "https://fonts.gstatic.com", crossorigin: true } },
        {
          tag: "link",
          attrs: {
            rel: "stylesheet",
            href: "https://fonts.googleapis.com/css2?family=Geist:wght@300..800&family=Geist+Mono:wght@400;500;600&display=swap",
          },
        },
      ],
      defaultLocale: "root",
      locales: {
        root: { label: "English", lang: "en" },
        es: { label: "Español", lang: "es" },
      },
      components: { Footer: "./src/components/Footer.astro", SiteTitle: "./src/components/SiteTitle.astro" },
      lastUpdated: false,
      sidebar: [
        section("Start here", "Empezar", "start"),
        section("Use cases", "Casos prácticos", "cases"),
        section("Core ideas", "Ideas clave", "concepts"),
        {
          label: "Your office",
          translations: { es: "Tu oficina" },
          items: [
            "docs/office/chat",
            "docs/office/tasks",
            "docs/office/routines",
            "docs/office/secretary",
            "docs/office/code",
            "docs/office/email",
          ],
        },
        {
          label: "Apps and artifacts",
          translations: { es: "Apps y artefactos" },
          collapsed: false,
          items: ["docs/apps/overview", "docs/office/artifacts", "docs/apps/live-apps", "docs/office/board"],
        },
        {
          label: "Computers and browser",
          translations: { es: "Ordenadores y navegador" },
          collapsed: false,
          items: ["docs/computers/overview", "docs/office/computers", "docs/office/browser"],
        },
        section("Channels", "Canales", "channels"),
        section("Extend", "Extender", "extend"),
        section("Everywhere", "En todas partes", "devices"),
        section("Reference", "Referencia", "reference"),
      ],
    })]),
  ],
});
