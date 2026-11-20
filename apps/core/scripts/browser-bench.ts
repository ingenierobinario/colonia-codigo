// NAVEGADOR-AGIL-1: cronometra una tarea típica del agente en el navegador (abrir, buscar, abrir un resultado,
// rellenar un formulario y leer la respuesta) llamando a las herramientas browser_* de verdad sobre Chromium headless.
// Un "modelo" simulado lee las refs de cada respuesta, como haría el agente. Cuenta llamadas, tiempo y caracteres
// devueltos (lo que gasta contexto).
//   node --no-warnings apps/core/scripts/browser-bench.ts [clasico|agil]
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";
import { createHeadlessBrowser } from "../src/nodes/headless-browser.ts";
import { browserTools } from "../src/tools/browser.ts";

const PAGES: Record<string, (q: URLSearchParams) => string> = {
  "/": () =>
    `<html><head><title>Acme</title></head><body><h1>Acme</h1><form action="/search"><input name="q" aria-label="Search"><button>Go</button></form></body></html>`,
  // Los resultados llegan después de cargar, por una petición que tarda 700 ms, como en una web real.
  "/search": (q) =>
    `<html><head><title>Search ${q.get("q")}</title></head><body><h1>Results</h1><ul id="r"></ul><script>
      fetch("/api").then((r) => r.text()).then((t) => { document.getElementById("r").innerHTML = t; });
    </script></body></html>`,
  "/signup": () => `<html><head><title>Sign up</title></head><body><h1>Sign up</h1><form action="/done">
      <label>Name <input name="name"></label><label>Email <input name="email" type="email"></label>
      <label>Country <select name="country"><option value="">Choose</option><option value="ES">Spain</option><option value="MX">Mexico</option></select></label>
      <label><input type="radio" name="plan" value="month"> Monthly</label><label><input type="radio" name="plan" value="year"> Yearly</label>
      <label><input type="checkbox" name="terms"> I accept the terms</label>
      <label>Message <textarea name="msg"></textarea></label><button>Send</button></form></body></html>`,
  "/done": (q) =>
    `<html><head><title>Done</title></head><body><h1>Thanks ${q.get("name")}: ${q.get("email")} · ${q.get("country") || "no country"} · ${q.get("plan") || "no plan"} · ${q.get("terms") ? "terms ok" : "no terms"} · ${q.get("msg")}</h1></body></html>`,
};

const WANT = "Thanks Ana: ana@example.com · MX · year · terms ok · Hola";

/** La ref de la primera línea con ese rol y nombre en lo último que devolvió una herramienta. */
function ref(out: string, role: string, name: RegExp): string {
  for (const line of out.split("\n")) {
    const m = line.match(/- (\w+) "([^"]*)".*\[(e\d+)\]/);
    if (m && m[1] === role && name.test(m[2] ?? "")) return m[3] as string;
  }
  throw new Error(`no ${role} ${name} in:\n${out.slice(0, 2000)}`);
}

export async function bench(plan: "clasico" | "agil") {
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url ?? "/", "http://x");
    const page = PAGES[u.pathname];
    if (u.pathname === "/api") {
      setTimeout(
        () => res.writeHead(200).end('<li><a href="/signup">Plan Pro</a></li><li><a href="/x">Plan Free</a></li>'),
        700,
      );
      return;
    }
    if (!page) return res.writeHead(404).end();
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(page(u.searchParams));
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "colonia-bench-"));
  const node = createHeadlessBrowser({
    dir,
    chrome: chromium.executablePath(),
    blockedPorts: () => new Set(),
    onChange: () => {},
    // biome-ignore lint/suspicious/noExplicitAny: banco de pruebas, dependencias mínimas
  } as any);
  // biome-ignore lint/suspicious/noExplicitAny: almacén mínimo para las herramientas
  const store = { settings: { read: () => [] }, messages: { list: () => [] } } as any;
  const tools = new Map(browserTools(store, dir).map((t) => [t.name, t]));
  const ctx = {
    agent: { id: "bench", browser_profile: "shared" },
    thread: { id: "bench" },
    signal: new AbortController().signal,
    untrusted: () => true,
    upsertPart: () => {},
    see: () => {},
    call: (m: string, p: unknown) => node.handle(m, p),
    // biome-ignore lint/suspicious/noExplicitAny: contexto mínimo
  } as any;
  const log: Array<{ tool: string; ms: number; chars: number }> = [];
  const call = async (name: string, args: object): Promise<string> => {
    const tool = tools.get(name);
    if (!tool) throw new Error(`no tool ${name}`);
    const t0 = performance.now();
    // biome-ignore lint/suspicious/noExplicitAny: llamada directa a la herramienta
    const out = String(await (tool as any).run(args, ctx));
    log.push({ tool: name, ms: Math.round(performance.now() - t0), chars: out.length });
    return out;
  };
  const tabOf = (out: string) => (out.match(/^tab (\S+) ·/m) ?? out.match(/tab="([^"]+)"/))?.[1] as string;
  let result = "";
  try {
    if (plan === "clasico") {
      // Lo que el agente podía hacer antes: cada acción pide un browser_snapshot nuevo para ver qué pasó.
      const tab = tabOf(await call("browser_open", { url: `${base}/` }));
      let snap = await call("browser_snapshot", { tab });
      await call("browser_type", { tab, ref: ref(snap, "textbox", /Search/), text: "pro", submit: true });
      snap = await call("browser_snapshot", { tab });
      // Los resultados aún no están: el agente espera a ciegas y vuelve a mirar.
      if (!/Plan Pro/.test(snap)) snap = await call("browser_snapshot", { tab, wait_s: 1 });
      await call("browser_click", { tab, ref: ref(snap, "link", /Plan Pro/) });
      snap = await call("browser_snapshot", { tab });
      await call("browser_type", { tab, ref: ref(snap, "textbox", /Name/), text: "Ana" });
      await call("browser_type", { tab, ref: ref(snap, "textbox", /Email/), text: "ana@example.com" });
      // Un desplegable no tiene herramienta: el agente lo intenta escribiendo en él.
      await call("browser_type", { tab, ref: ref(snap, "combobox", /Country/), text: "Mexico" });
      await call("browser_click", { tab, ref: ref(snap, "radio", /Yearly/) });
      await call("browser_click", { tab, ref: ref(snap, "checkbox", /terms/) });
      await call("browser_type", { tab, ref: ref(snap, "textbox", /Message/), text: "Hola" });
      await call("browser_click", { tab, ref: ref(snap, "button", /Send/) });
      result = await call("browser_text", { tab });
    } else {
      // Ahora: cada acción espera a que la página se asiente y devuelve el árbol nuevo.
      let out = await call("browser_open", { url: `${base}/` });
      const tab = tabOf(out);
      out = await call("browser_type", { tab, ref: ref(out, "textbox", /Search/), text: "pro", submit: true });
      // Si los resultados aún no están, el agente espera a ese texto en vez de dormir a ciegas.
      if (!/Plan Pro/.test(out)) out = await call("browser_wait", { tab, text: "Plan Pro" });
      out = await call("browser_click", { tab, ref: ref(out, "link", /Plan Pro/) });
      result = await call("browser_fill", {
        tab,
        fields: [
          { ref: ref(out, "textbox", /Name/), value: "Ana" },
          { ref: ref(out, "textbox", /Email/), value: "ana@example.com" },
          { ref: ref(out, "combobox", /Country/), value: "Mexico" },
          { ref: ref(out, "radio", /Yearly/), value: true },
          { ref: ref(out, "checkbox", /terms/), value: true },
          { ref: ref(out, "textbox", /Message/), value: "Hola" },
        ],
        submit: ref(out, "button", /Send/),
      });
    }
  } finally {
    await node.stop?.();
    srv.close();
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch {}
  }
  const ms = log.reduce((n, l) => n + l.ms, 0);
  const chars = log.reduce((n, l) => n + l.chars, 0);
  return { plan, calls: log.length, ms, chars, ok: result.includes(WANT), log };
}

if (import.meta.main) {
  const plan = process.argv[2] === "agil" ? "agil" : "clasico";
  const r = await bench(plan);
  for (const l of r.log)
    console.log(`${l.tool.padEnd(18)} ${String(l.ms).padStart(6)} ms ${String(l.chars).padStart(6)} car.`);
  console.log(
    `${r.plan}: ${r.calls} llamadas · ${(r.ms / 1000).toFixed(2)} s · ${r.chars} car. · resultado ${r.ok ? "correcto" : "INCORRECTO"}`,
  );
  process.exit(0);
}
