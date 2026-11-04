import { getCollection } from "astro:content";
import type { APIRoute } from "astro";
import { RESERVAR_URL } from "../config/site";
import { docSections } from "../doc-routes.mjs";
import { HOME } from "../i18n/home";

// El sitio como mapa para modelos de lenguaje (llmstxt.org): qué es Colonia y cada página de la guía en inglés con su resumen.
const sectionNames: Record<string, string> = {
  start: "Start here",
  concepts: "Core ideas",
  office: "Your office",
  channels: "Channels",
  extend: "Extend",
  devices: "Everywhere",
  reference: "Reference",
};

export const GET: APIRoute = async ({ site }) => {
  const base = import.meta.env.BASE_URL.replace(/\/?$/, "/");
  const url = (path: string) => new URL(`${base}${path.replace(/^\//, "")}`, site).href;
  const docs = (await getCollection("docs")).filter((entry) => entry.id.startsWith("docs/"));
  const order = (entry: (typeof docs)[number]) => entry.data.sidebar?.order ?? 999;
  const t = HOME.en;
  const lines = [
    "# Colonia",
    "",
    `> ${t.sub.strong} ${t.sub.rest}`,
    "",
    "Colonia installs on macOS, Windows or Linux, with an Android app that pairs with the computer. Everyone connects their own AI subscription or key. Agents talk through Telegram, WhatsApp, Discord, Slack and iMessage. Every page is also in Spanish under /es/.",
  ];
  for (const section of docSections) {
    const pages = docs.filter((entry) => entry.id.split("/")[1] === section).sort((a, b) => order(a) - order(b));
    if (pages.length === 0) continue;
    lines.push("", `## ${sectionNames[section] ?? section}`, "");
    for (const entry of pages)
      lines.push(
        `- [${entry.data.title}](${url(`/${entry.id}/`)})${entry.data.description ? `: ${entry.data.description}` : ""}`,
      );
  }
  lines.push("", "## Optional", "", `- [Compare](${url("/en/compare/")})`, `- [Reserve your place](${RESERVAR_URL})`);
  return new Response(`${lines.join("\n")}\n`, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
};
