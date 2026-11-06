// The demo office the screenshots show: "Brezo Cerámica", a small (fictitious) Spanish online shop of handmade
// ceramics run by Marta, with Lucía (product), Tomás (web), Inés (marketing) and Pablo (customer care), its tasks,
// routines, notes, chats and widgets, written through the protocol like any client would. Every text exists in
// Spanish (Spain, "tú") and in English: the Spanish captures get the first, the English ones the second.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export type Lang = "en" | "es";
type Rpc = <T = Record<string, unknown>>(method: string, params?: unknown) => Promise<T>;

const write = (file: string, text: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const lines = (...rows: unknown[]) => `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`;

/** The office's name and the owner's, shared by every file below. */
export const OFFICE = { es: "Brezo Cerámica", en: "Brezo Ceramics" } as const;
export const OWNER = "Marta";

const TEXT = {
  es: {
    agents: {
      lucia: `---
name: Lucía
role: Responsable de producto
description: Lleva el plan de la tienda y reparte el trabajo.
icon: orbita
area: product
autonomy: standard
---
Eres Lucía, responsable de producto de Brezo Cerámica. Divide los encargos grandes en tareas, asígnalas y haz seguimiento hasta cerrarlas.
`,
      tomas: `---
name: Tomás
role: Web y tienda online
description: Mantiene la tienda online y arregla lo que falla; abre una sesión de Claude Code para los cambios grandes.
icon: perla
parent: lucia
area: engineering
tools: [shell, browser]
---
Eres Tomás, quien cuida la tienda online de Brezo Cerámica. Cambios pequeños y probados.
`,
      ines: `---
name: Inés
role: Marketing
description: Escribe las campañas, el boletín y las publicaciones, y los programa.
icon: cobalto
parent: lucia
area: growth
---
Eres Inés, de marketing en Brezo Cerámica. Textos cercanos y concretos; propón siempre una fecha de envío.
`,
      pablo: `---
name: Pablo
role: Atención al cliente
description: Contesta a los clientes por WhatsApp y solo te pasa lo que necesita tu decisión.
icon: brasa
parent: lucia
area: growth
---
Atiendes a los clientes de Brezo Cerámica. Breve y amable; nunca prometas una devolución sin preguntar a Marta.
`,
    },
    agentsMd:
      "# Brezo Cerámica\n\nTienda online de cerámica hecha a mano: catálogo, carrito y pago.\n\n- `pnpm dev` la arranca.\n- Los cambios se publican los viernes.\n",
    projectDesc: "Nuestra tienda online",
    skill:
      "---\nname: notas-de-version\ndescription: Escribe las notas de una publicación de la tienda a partir de los cambios.\n---\nPrimero lo que cambia para el cliente y luego los arreglos. Menos de 120 palabras.\n",
    skillDir: "notas-de-version",
    readme: "# Brezo Cerámica\n\nCatálogo, carrito y pago.\n",
    catalog: [
      { sku: "taza-01", name: "Taza de gres esmaltada", price: 18 },
      { sku: "plato-02", name: "Plato llano azul cobalto", price: 24 },
    ],
    commit: "Catálogo, carrito y pago",
    claudeAsk: "Haz que el campo del cupón no distinga mayúsculas",
    claudeDone: "Hecho: los códigos se limpian de espacios y se pasan a mayúsculas antes de comprobarlos.",
    codexAsk: "Añade un pie de página con el horario de la tienda",
    homeSkills: {
      "resumen-semanal":
        "---\nname: resumen-semanal\ndescription: Convierte una semana de tareas y chats en un resumen de cinco líneas para Marta.\n---\nPrimero las decisiones, luego los riesgos y al final lo siguiente.\n",
      "respuesta-cliente":
        "---\nname: respuesta-cliente\ndescription: Contesta a un cliente con amabilidad y brevedad, sin prometer devoluciones.\n---\nDa las gracias, responde y di quién hace el seguimiento.\n",
    },
    about: "Lleva Brezo Cerámica, una pequeña tienda online de cerámica hecha a mano.",
    base: "Personal",
    areas: [
      { slug: "product", name: "Producto", goal: "Hacer lo que piden los clientes" },
      { slug: "engineering", name: "Web", goal: "Una tienda que no se caiga nunca" },
      { slug: "growth", name: "Clientes", goal: "Más clientes que repiten" },
    ],
    roles: [
      { slug: "pm", name: "Responsable de producto", area: "product" },
      { slug: "dev", name: "Web y tienda online", area: "engineering" },
      { slug: "mkt", name: "Marketing", area: "growth" },
    ],
    tasks: [
      "Rediseñar la página de pago",
      "Arreglar las fotos rotas del catálogo",
      "Campaña de Black Friday",
      "Boletín de primavera",
      "Preparar el plan del último trimestre",
      "Encuesta a los clientes que repiten",
    ],
    blocked: "Aprobar el presupuesto del lanzamiento",
    comment: "@tomás el campo del cupón falla cuando el carrito está vacío, ¿lo miras?",
    errand: "Recoger las muestras de las cajas nuevas",
    carlaNote: "Fotógrafa del catálogo de la tienda.",
    supplier: "Embalajes del Norte",
    supplierNote: "Proveedor de cajas y embalaje.",
    owe: ["Mandar a Carla la lista de fotos", "Entrega de las fotos del catálogo", "Presupuesto de las cajas de Navidad"],
    routines: [
      ["Resumen diario", "Resume las tareas abiertas: qué ha avanzado, qué está bloqueado y qué necesita a Marta."],
      ["Boletín del viernes", "Prepara el boletín de esta semana con las novedades y mándaselo a Marta para que lo apruebe."],
      ["Cambios pendientes de revisar", "Avísame solo cuando un cambio de la web necesite revisión."],
      ["Copia de seguridad nocturna", "Copia de seguridad del catálogo"],
    ],
    notes: [
      "Marta prefiere respuestas cortas, con la decisión primero.",
      "Marta está en Madrid; nada de mensajes antes de las 8:00.",
      "Los cambios de la tienda se publican los viernes a partir de las 10:00.",
      "En Black Friday: 20 % en los lotes y 10 % en piezas sueltas.",
      "El campo del cupón no debe distinguir mayúsculas ni espacios.",
      "El boletín sale el viernes a las 9:00; asunto de menos de 50 caracteres.",
    ],
    homeAsk: ["¿Qué tengo hoy?", "Sí, dile a Lucía que lo miro después de comer."],
    luciaTitle: "Lanzamiento de Navidad",
    luciaAsk: "Planifica con el equipo el lanzamiento de Navidad, en cuatro semanas.",
    tomasTitle: "Arreglo del pago",
    tomasAsk: "¿Puedes revisar el pago? Los clientes dicen que el cupón falla.",
    inesTitle: "Boletín del viernes",
    inesAsk: "Prepara el boletín del viernes.",
    salesTitle: "Ventas de la semana",
    ordersTitle: "Pedidos de hoy",
    launchTitle: "Lanzamiento de Navidad",
    telegram: "¡Hola! ¿Seguimos con la sesión de fotos del catálogo el jueves?",
  },
  en: {
    agents: {
      lucia: `---
name: Lucía
role: Product manager
description: Owns the shop's plan and hands out the work.
icon: orbita
area: product
autonomy: standard
---
You are Lucía, product manager at Brezo Ceramics. Split big asks into tasks, assign them and follow up until they close.
`,
      tomas: `---
name: Tomás
role: Web and online shop
description: Looks after the online shop and fixes what breaks; opens a Claude Code session for bigger changes.
icon: perla
parent: lucia
area: engineering
tools: [shell, browser]
---
You are Tomás, who looks after the Brezo Ceramics online shop. Keep changes small and tested.
`,
      ines: `---
name: Inés
role: Marketing
description: Writes the campaigns, the newsletter and the posts, and schedules them.
icon: cobalto
parent: lucia
area: growth
---
You are Inés, marketing at Brezo Ceramics. Friendly, concrete copy; always propose a send date.
`,
      pablo: `---
name: Pablo
role: Customer care
description: Answers customers on WhatsApp and passes on only what needs your decision.
icon: brasa
parent: lucia
area: growth
---
You answer Brezo Ceramics' customers. Be brief and kind; never promise a refund without asking Marta.
`,
    },
    agentsMd:
      "# Brezo Ceramics\n\nAn online shop of handmade ceramics: catalog, cart and checkout.\n\n- `pnpm dev` runs it.\n- Changes go out on Fridays.\n",
    projectDesc: "Our online shop",
    skill:
      "---\nname: release-notes\ndescription: Write the notes for a shop update from the changes.\n---\nWhat changes for customers first, then fixes. Under 120 words.\n",
    skillDir: "release-notes",
    readme: "# Brezo Ceramics\n\nCatalog, cart and checkout.\n",
    catalog: [
      { sku: "taza-01", name: "Glazed stoneware mug", price: 18 },
      { sku: "plato-02", name: "Cobalt blue dinner plate", price: 24 },
    ],
    commit: "Catalog, cart and checkout",
    claudeAsk: "Make the coupon field ignore case",
    claudeDone: "Done: codes are trimmed and upper-cased before the check.",
    codexAsk: "Add a footer with the shop's opening hours",
    homeSkills: {
      "weekly-brief":
        "---\nname: weekly-brief\ndescription: Turn a week of tasks and chats into a five-line brief for Marta.\n---\nDecisions first, then risks, then what is next.\n",
      "customer-reply":
        "---\nname: customer-reply\ndescription: Answer a customer kindly and briefly, without promising refunds.\n---\nThank them, answer, and say who follows up.\n",
    },
    about: "Runs Brezo Ceramics, a small online shop of handmade ceramics.",
    base: "Personal",
    areas: [
      { slug: "product", name: "Product", goal: "Make what customers ask for" },
      { slug: "engineering", name: "Web", goal: "A shop that never goes down" },
      { slug: "growth", name: "Customers", goal: "More repeat customers" },
    ],
    roles: [
      { slug: "pm", name: "Product manager", area: "product" },
      { slug: "dev", name: "Web and online shop", area: "engineering" },
      { slug: "mkt", name: "Marketing", area: "growth" },
    ],
    tasks: [
      "Redesign the checkout page",
      "Fix broken catalog photos",
      "Black Friday campaign",
      "Spring newsletter",
      "Plan the last quarter",
      "Survey our repeat customers",
    ],
    blocked: "Approve the launch budget",
    comment: "@tomás the coupon field breaks when the cart is empty, can you check it?",
    errand: "Pick up the new box samples",
    carlaNote: "Photographer for the shop's catalog.",
    supplier: "Embalajes del Norte",
    supplierNote: "Boxes and packaging supplier.",
    owe: ["Send Carla the shot list", "Catalog photos delivered", "Quote for the Christmas boxes"],
    routines: [
      ["Daily summary", "Summarize open tasks: what moved, what is blocked and what needs Marta."],
      ["Friday newsletter", "Draft this week's newsletter from what's new and send it to Marta for approval."],
      ["Web changes to review", "Tell me only when a change to the shop needs a review."],
      ["Nightly backup", "Back up the catalog"],
    ],
    notes: [
      "Marta prefers short answers with the decision first.",
      "Marta is in Madrid; no messages before 8:00.",
      "Shop changes go out on Fridays after 10:00.",
      "Black Friday: 20% off bundles, 10% off single pieces.",
      "The coupon field must ignore case and spaces.",
      "Newsletter goes out Friday 9:00; subject under 50 characters.",
    ],
    homeAsk: ["What's on my plate today?", "Yes, ping Lucía that I'll look at it after lunch."],
    luciaTitle: "Christmas launch",
    luciaAsk: "Plan the Christmas launch with the team, four weeks.",
    tomasTitle: "Checkout fix",
    tomasAsk: "Can you check the checkout? Customers say the coupon fails.",
    inesTitle: "Friday newsletter",
    inesAsk: "Draft the newsletter for Friday.",
    salesTitle: "Sales this week",
    ordersTitle: "Today's orders",
    launchTitle: "Christmas launch",
    telegram: "Hi! Are we still on for the catalog shoot on Thursday?",
  },
} as const;

/** A project folder like a real one: AGENTS.md, the crew's folder with four agents, some code and a short git history. */
export function writeDemoWorld(dir: string, lang: Lang) {
  const t = TEXT[lang];
  const repo = path.join(dir, "work", "brezo-ceramica");
  write(path.join(repo, "AGENTS.md"), t.agentsMd);
  write(
    path.join(repo, ".apc", "project.json"),
    JSON.stringify({ name: OFFICE[lang], description: t.projectDesc, kind: "company" }, null, 2),
  );
  for (const [slug, text] of Object.entries(t.agents)) write(path.join(repo, ".apc", "agents", `${slug}.md`), text);
  write(path.join(repo, ".apc", "skills", t.skillDir, "SKILL.md"), t.skill);
  write(
    path.join(repo, ".apc", "mcps.json"),
    JSON.stringify(
      { mcpServers: { filesystem: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "./src"] } } },
      null,
      2,
    ),
  );
  write(path.join(repo, "README.md"), t.readme);
  write(path.join(repo, "package.json"), JSON.stringify({ name: "brezo-ceramica", private: true, type: "module" }, null, 2));
  write(
    path.join(repo, "src", "cart.ts"),
    "export type Item = { sku: string; price: number; qty: number };\n\nexport const total = (items: Item[]) =>\n  items.reduce((sum, i) => sum + i.price * i.qty, 0);\n",
  );
  write(
    path.join(repo, "src", "checkout.ts"),
    'import { total, type Item } from "./cart";\n\nexport function applyCoupon(items: Item[], code: string) {\n  const sum = total(items);\n  return code === "BREZO10" ? sum * 0.9 : sum;\n}\n',
  );
  write(path.join(repo, "src", "catalog.json"), JSON.stringify(t.catalog, null, 2));
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: repo,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: OWNER,
        GIT_AUTHOR_EMAIL: "marta@example.com",
        GIT_COMMITTER_NAME: OWNER,
        GIT_COMMITTER_EMAIL: "marta@example.com",
      },
      stdio: "ignore",
    });
  git("init", "-q", "-b", "main");
  git("add", ".");
  git("commit", "-q", "-m", t.commit);
  // A change in progress, for the Changes panel.
  write(
    path.join(repo, "src", "checkout.ts"),
    'import { total, type Item } from "./cart";\n\nexport function applyCoupon(items: Item[], code: string) {\n  if (items.length === 0) return 0;\n  const sum = total(items);\n  return code.trim().toUpperCase() === "BREZO10" ? sum * 0.9 : sum;\n}\n',
  );

  // A Claude Code and a Codex session started outside Colonia, for "External sessions".
  const claude = path.join(dir, "claude");
  const codex = path.join(dir, "codex");
  write(
    path.join(claude, "projects", "-work-brezo-ceramica", "11111111-2222-3333-4444-555555555555.jsonl"),
    lines(
      { type: "user", cwd: repo, message: { role: "user", content: t.claudeAsk } },
      { type: "assistant", cwd: repo, message: { role: "assistant", content: [{ type: "text", text: t.claudeDone }] } },
    ),
  );
  write(
    path.join(codex, "sessions", "2026", "10", "06", "rollout-2026-10-06T10-00-00-cdx1.jsonl"),
    lines(
      { type: "session_meta", payload: { id: "cdx1", cwd: repo, originator: "codex_cli_rs" } },
      {
        type: "response_item",
        payload: { type: "message", role: "user", content: [{ type: "input_text", text: t.codexAsk }] },
      },
    ),
  );
  return { repo, claude, codex };
}

const widgetSales = (lang: Lang) => `<!doctype html><html><body style="margin:0;font:14px system-ui;color:#111;padding:14px">
<div style="display:flex;justify-content:space-between;align-items:baseline"><b>${TEXT[lang].salesTitle}</b><span style="color:#16a34a">+18 %</span></div>
<div style="font-size:30px;font-weight:600;margin:6px 0 10px">${lang === "es" ? "4.380 €" : "€4,380"}</div>
<svg viewBox="0 0 280 80" width="100%" height="80"><polyline fill="none" stroke="#16a34a" stroke-width="3" points="0,62 40,58 80,50 120,54 160,36 200,30 240,22 280,12"/></svg>
</body></html>`;
const widgetLaunch = (lang: Lang) => {
  const items =
    lang === "es"
      ? ["✅ Cerrar el catálogo", "✅ Arreglar el pago", "⏳ Página y correos", "⬜ Campaña de Black Friday"]
      : ["✅ Freeze the catalog", "✅ Fix the checkout", "⏳ Landing page and emails", "⬜ Black Friday campaign"];
  return `<!doctype html><html><body style="margin:0;font:14px system-ui;color:#111;padding:14px">
<b>${TEXT[lang].launchTitle}</b><ul style="padding-left:18px;line-height:1.9;margin:8px 0 0">
${items.map((i) => `<li>${i}</li>`).join("")}</ul>
</body></html>`;
};
/** The widget opened as an App: today's orders, drawn on load (it marks body[data-state] when it's ready). */
const widgetOrders = (lang: Lang) => {
  const es = lang === "es";
  const rows = es
    ? [
        ["#1042", "Lucía M. · Valencia", "Taza de gres esmaltada ×2", "36 €", "Enviado"],
        ["#1043", "Jorge P. · Bilbao", "Juego de platos cobalto", "96 €", "Preparando"],
        ["#1044", "Ana R. · Sevilla", "Jarra de agua blanca", "32 €", "Preparando"],
        ["#1045", "David L. · Zaragoza", "Cuenco grande de ensalada", "28 €", "Pendiente de pago"],
        ["#1046", "Elena G. · Madrid", "Lote de 4 tazas", "64 €", "Enviado"],
      ]
    : [
        ["#1042", "Lucía M. · Valencia", "Glazed stoneware mug ×2", "€36", "Shipped"],
        ["#1043", "Jorge P. · Bilbao", "Cobalt dinner set", "€96", "Packing"],
        ["#1044", "Ana R. · Sevilla", "White water jug", "€32", "Packing"],
        ["#1045", "David L. · Zaragoza", "Large salad bowl", "€28", "Awaiting payment"],
        ["#1046", "Elena G. · Madrid", "Set of 4 mugs", "€64", "Shipped"],
      ];
  const stats = es
    ? [["Pedidos", "14"], ["Ventas", "612 €"], ["Ticket medio", "43,70 €"], ["Por enviar", "5"]]
    : [["Orders", "14"], ["Sales", "€612"], ["Average order", "€43.70"], ["To ship", "5"]];
  const head = es ? ["Pedido", "Cliente", "Productos", "Importe", "Estado"] : ["Order", "Customer", "Items", "Total", "Status"];
  return `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;font:14px system-ui;color:#1c1917;background:#fffaf5;padding:22px}
h1{font-size:20px;margin:0 0 16px}.k{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:18px}
.k div{background:#fff;border:1px solid #eadfd3;border-radius:12px;padding:14px}.k span{display:block;color:#78716c;font-size:12px}
.k b{font-size:24px}table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #eadfd3;border-radius:12px;overflow:hidden}
th,td{text-align:left;padding:11px 14px;border-bottom:1px solid #f1e8de}th{color:#78716c;font-weight:500;font-size:12px}
.s{font-size:12px;padding:3px 9px;border-radius:99px;background:#f5ede4}
</style></head><body><h1>${TEXT[lang].ordersTitle}</h1><div class="k" id="k"></div><table><thead><tr>${head
    .map((h) => `<th>${h}</th>`)
    .join("")}</tr></thead><tbody id="r"></tbody></table><script>
const stats=${JSON.stringify(stats)},rows=${JSON.stringify(rows)};
document.getElementById("k").innerHTML=stats.map(([l,v])=>"<div><span>"+l+"</span><b>"+v+"</b></div>").join("");
document.getElementById("r").innerHTML=rows.map(r=>"<tr>"+r.map((c,i)=>"<td>"+(i===4?"<span class=s>"+c+"</span>":c)+"</td>").join("")+"</tr>").join("");
document.body.dataset.state="ready";
</script></body></html>`;
};

/** Global skills Colonia keeps in its home (written before the core starts). */
export function writeHomeSkills(coloniaHome: string, lang: Lang) {
  for (const [name, text] of Object.entries(TEXT[lang].homeSkills))
    write(path.join(coloniaHome, "skills", name, "SKILL.md"), text);
}

/** Title of the widget the app-widget shot opens. */
export const ordersTitle = (lang: Lang) => TEXT[lang].ordersTitle;
/** Title of the task the task-drawer shot opens. */
export const drawerTask = (lang: Lang) => TEXT[lang].tasks[0];
/** The Telegram message the channel shot shows. */
export const telegramText = (lang: Lang) => TEXT[lang].telegram;

/** Fills the core: the owner, the crew, tasks, routines, notes, chats, widgets and a Telegram bot. */
export async function seed(
  rpc: Rpc,
  world: { repo: string; extension: string },
  log: (s: string) => void,
  lang: Lang,
) {
  const t = TEXT[lang];
  const step = async (what: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      log(`  ✗ ${what}: ${(e as Error).message}`);
    }
  };
  await step("setup", () => rpc("setup.finish", {}));
  await step("owner", () => rpc("owner.set", { name: OWNER, about: t.about, language: lang }));
  await step("extension", () => rpc("extensions.install", { path: world.extension }));
  await step("base", () => rpc("projects.update_base", { name: t.base, kind: "personal" }));

  const agents = (await rpc<{ agents: Array<{ id: string; name: string; kind?: string }> }>("agents.list")).agents;
  const home = agents.find((a) => a.kind === "secretary") ?? agents[0];
  if (!home) throw new Error("no Home agent");
  await step("home", () => rpc("agents.update", { agent: home.id, name: "Nova", blob: "menta" }));

  const reg = await rpc<{ project: { id: string } }>("projects.register", { path: world.repo });
  const shop = reg.project.id;
  await step("sync", () => rpc("projects.sync", { project: shop }));
  const crew = (await rpc<{ agents: Array<{ id: string; name: string; project_id?: string | null }> }>("agents.list"))
    .agents;
  const id = (name: string) => crew.find((a) => a.name === name && a.project_id === shop)?.id ?? home.id;
  const lucia = id("Lucía");
  const tomas = id("Tomás");
  const ines = id("Inés");

  await step("org", () => rpc("org.set", { project: shop, organization: { areas: t.areas, roles: t.roles } }));

  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  const [checkout, photos, bf, spring, plan, survey] = t.tasks;
  const tasks: Array<Record<string, unknown>> = [
    { title: checkout, assignee: tomas, status: "doing", priority: "high", tags: ["web"] },
    { title: photos, assignee: tomas, status: "review", priority: "normal" },
    { title: bf, assignee: ines, status: "todo", priority: "urgent", due_at: day(9) },
    { title: spring, assignee: ines, status: "todo", priority: "low", due_at: day(3) },
    { title: plan, assignee: lucia, status: "doing", priority: "high", due_at: day(5) },
    { title: survey, assignee: lucia, status: "backlog", priority: "normal" },
  ];
  const made: string[] = [];
  for (const task of tasks)
    await step(`task ${task.title}`, async () => {
      made.push((await rpc<{ id: string }>("tasks.create", { project: shop, ...task })).id);
    });
  await step("blocked", async () => {
    const b = await rpc<{ id: string }>("tasks.create", {
      project: shop,
      title: t.blocked,
      assignee: lucia,
      priority: "high",
    });
    await rpc("tasks.update", { task: b.id, awaits_owner: true });
  });
  await step("comment", () => rpc("tasks.comment", { task: made[0], text: t.comment }));
  await step("errand", () => rpc("tasks.create", { title: t.errand, kind: "errand", due_at: day(1) }));
  await step("commitments", async () => {
    await rpc("contacts.set", { name: "Carla Ruiz", relation: "provider", note: t.carlaNote });
    await rpc("contacts.set", { name: t.supplier, relation: "provider", note: t.supplierNote });
    await rpc("tasks.create", { title: t.owe[0], person: "Carla Ruiz", owed_by: "owner", due_at: day(2) });
    await rpc("tasks.create", { title: t.owe[1], person: "Carla Ruiz", owed_by: "person", due_at: day(6) });
    await rpc("tasks.create", { title: t.owe[2], person: t.supplier, owed_by: "person", due_at: day(4) });
  });

  const [daily, friday, review, backup] = t.routines;
  const routines: Array<Record<string, unknown>> = [
    { name: daily[0], agent: lucia, schedule: { kind: "cron", cron: "0 9 * * 1-5" }, prompt: daily[1] },
    { name: friday[0], agent: ines, schedule: { kind: "cron", cron: "0 9 * * 5" }, prompt: friday[1] },
    { name: review[0], agent: tomas, schedule: { kind: "every", minutes: 240 }, action: "watch", prompt: review[1] },
    {
      name: backup[0],
      agent: tomas,
      schedule: { kind: "cron", cron: "30 3 * * *" },
      action: "shell",
      prompt: backup[1],
      pre_command: "cp src/catalog.json backups/catalog.json",
    },
  ];
  const rids: string[] = [];
  for (const r of routines)
    await step(`routine ${r.name}`, async () => {
      rids.push((await rpc<{ id: string }>("routines.set", { project: shop, ...r })).id);
    });
  for (const r of rids.slice(0, 2)) await step("run", () => rpc("routines.run", { routine: r }));

  const n = t.notes;
  const notes: Array<Record<string, unknown>> = [
    { text: n[0], scope: "global" },
    { text: n[1], scope: "global" },
    { text: n[2], scope: "project", project: shop },
    { text: n[3], scope: "project", project: shop },
    { text: n[4], scope: "agent", project: shop, agent: tomas },
    { text: n[5], scope: "agent", project: shop, agent: ines },
  ];
  for (const note of notes) await step("note", () => rpc("memory.add", note));

  // Chats: Home and the crew answer through the scripted model.
  const send = async (thread: string, text: string) => {
    const { run } = await rpc<{ run: { id: string } }>("threads.send", { thread, text });
    await rpc("runs.wait", { run: run.id, timeout_s: 30 });
  };
  const chat = async (agent: string, title: string) =>
    (await rpc<{ id: string }>("threads.create", { kind: "agent", agent_id: agent, project_id: shop, title })).id;
  await step("home chat", async () => {
    await send("home", t.homeAsk[0]);
    await send("home", t.homeAsk[1]);
  });
  let luciaChat = "";
  await step("lucia chat", async () => {
    luciaChat = await chat(lucia, t.luciaTitle);
    await send(luciaChat, t.luciaAsk);
  });
  await step("tomas chat", async () => send(await chat(tomas, t.tomasTitle), t.tomasAsk));
  await step("ines chat", async () => send(await chat(ines, t.inesTitle), t.inesAsk));

  await step("widgets", async () => {
    const thread = luciaChat || (await chat(lucia, t.luciaTitle));
    await rpc("surfaces.show", { name: "weekly-sales", title: t.salesTitle, html: widgetSales(lang), pinned: true, thread });
    await rpc("surfaces.show", {
      name: "todays-orders",
      title: t.ordersTitle,
      html: widgetOrders(lang),
      app: true,
      thread: "home",
    });
    await rpc("surfaces.show", { name: "launch", title: t.launchTitle, html: widgetLaunch(lang), pinned: true, thread });
  });
  return { shop, home: home.id, lucia, tomas, ines, luciaChat };
}
