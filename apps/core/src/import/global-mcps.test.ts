// IMPORTAR-CONECTORES-1 · Los conectores de las otras IAs del dueño: se leen de ficheros de ejemplo (nunca del disco
// real), el mismo servidor en varias IAs es una entrada, las claves no salen en claro y lo que ya hay no se duplica.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { type TempDir, tempDir } from "../testkit/platform.ts";
import { findGlobalMcps, variableName, withVariables } from "./global-mcps.ts";

const dirs: TempDir[] = [];
after(async () => {
  for (const d of dirs) await d.remove();
});
const fresh = (prefix: string) => {
  const d = tempDir(prefix);
  dirs.push(d);
  return d.path;
};

/** Un equipo de ejemplo con Claude Code, Codex, Claude Desktop y Cursor configurados. */
function sampleHome(home = fresh("colonia-mcp-import-")) {
  const claude = path.join(home, "claude-home");
  const codex = path.join(home, "codex-home");
  const appData = path.join(home, "datos-de-apps-ejemplo");
  fs.mkdirSync(claude, { recursive: true });
  fs.mkdirSync(codex, { recursive: true });
  fs.mkdirSync(path.join(appData, "Claude"), { recursive: true });
  fs.mkdirSync(path.join(home, ".cursor"), { recursive: true });
  fs.writeFileSync(
    path.join(home, ".claude.json"),
    JSON.stringify({
      mcpServers: {
        github: {
          type: "http",
          url: "https://api.example.com/mcp/",
          headers: { Authorization: "Bearer ghp_abcdefghijklmnopqrstuvwxyz" },
        },
        files: { command: "npx", args: ["-y", "@example/files", "C:\\datos"] },
      },
      projects: { "C:\\otro": { mcpServers: { solo: { command: "solo" } } } },
    }),
  );
  fs.writeFileSync(
    path.join(codex, "config.toml"),
    [
      "[mcp_servers.archivos]",
      'command = "npx.cmd"',
      'args = ["-y", "@example/files", "C:\\\\datos"]',
      "",
      "[mcp_servers.notion]",
      'url = "https://notion.example.com/mcp"',
      "[mcp_servers.notion.http_headers]",
      'Authorization = "${NOTION_TOKEN}"',
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(appData, "Claude", "claude_desktop_config.json"),
    JSON.stringify({ mcpServers: { "github-remoto": { url: "https://api.example.com/mcp" } } }),
  );
  fs.writeFileSync(
    path.join(home, ".cursor", "mcp.json"),
    JSON.stringify({ mcpServers: { tiempo: { command: "node", args: ["tiempo.js"], env: { WEATHER_API_KEY: "" } } } }),
  );
  return { home, claude, codex, appData };
}

test("lee las cuatro IAs y junta el mismo servidor en una sola entrada", () => {
  const found = findGlobalMcps(sampleHome());
  assert.deepEqual(
    found.map((m) => [m.name, m.sources, m.local]),
    [
      ["files", ["claude-code", "codex"], true],
      ["github", ["claude-code", "claude-desktop"], false],
      ["notion", ["codex"], false],
      ["tiempo", ["cursor"], true],
    ],
  );
  // Los servidores de un proyecto concreto de Claude Code no son del usuario entero.
  assert.equal(
    found.some((m) => m.name === "solo"),
    false,
  );
});

test("separa la clave escrita en el fichero de la que tiene que dar el dueño", () => {
  const byName = Object.fromEntries(findGlobalMcps(sampleHome()).map((m) => [m.name, m]));
  assert.deepEqual([byName.github?.stored, byName.github?.needs], [["Authorization"], []]);
  assert.deepEqual([byName.notion?.stored, byName.notion?.needs], [[], ["Authorization"]]);
  assert.deepEqual([byName.tiempo?.stored, byName.tiempo?.needs], [[], ["WEATHER_API_KEY"]]);
  assert.deepEqual([byName.files?.stored, byName.files?.needs], [[], []]);
  // Claude Desktop also has github, without its key: the definition with the key is the one kept.
  assert.equal(byName.github?.server.headers?.Authorization?.startsWith("Bearer "), true);
});

test("la clave pasa a ser una variable (secret://) y no queda en claro", () => {
  const s = withVariables("github", { url: "https://x", headers: { Authorization: "Bearer abc", Accept: "json" } }, [
    "Authorization",
  ]);
  assert.deepEqual(s.headers, { Authorization: `secret://${variableName("github", "Authorization")}`, Accept: "json" });
  assert.equal(JSON.stringify(s).includes("Bearer abc"), false);
});

test("sin ficheros no hay nada que importar", () => {
  const home = fresh("colonia-mcp-import-vacio-");
  assert.deepEqual(findGlobalMcps({ home, appData: path.join(home, "nada") }), []);
});

test("RPC: lista, importa con la clave guardada como variable y no duplica lo que ya hay", async () => {
  const home = fresh("colonia-mcp-import-core-");
  const sample = sampleHome(home);
  // En un core de prueba la carpeta de apps es la del core; Claude Desktop se busca en su AppData de Windows o mac.
  const appData =
    process.platform === "win32"
      ? path.join(home, "AppData", "Roaming")
      : process.platform === "darwin"
        ? path.join(home, "Library", "Application Support")
        : path.join(home, ".config");
  fs.cpSync(sample.appData, appData, { recursive: true });
  const env = await startCore({ llm: scriptedLlm(() => say("ok")), home });
  try {
    const list = (await env.client.call("mcp.importable", {})).servers;
    assert.deepEqual(
      list.map((s) => s.name),
      ["files", "github", "notion", "tiempo"],
    );
    assert.equal(JSON.stringify(list).includes("ghp_"), false, "la lista no enseña claves");
    const key = (n: string) => list.find((s) => s.name === n)?.key ?? "";
    const r = await env.client.call("mcp.import", { keys: [key("github"), key("notion"), key("files")] });
    assert.deepEqual(r.added.sort(), ["files", "github"]);
    assert.deepEqual(r.need_values, [{ name: "notion", keys: ["Authorization"] }]);
    const r2 = await env.client.call("mcp.import", {
      keys: [key("notion"), key("github")],
      values: { [key("notion")]: { Authorization: "Bearer dado-a-mano" } },
    });
    assert.deepEqual([r2.added, r2.existing], [["notion"], ["github"]]);
    const servers = (await env.client.call("mcp.list", {})).servers.filter((s) => s.scope === "global");
    const github = servers.find((s) => s.name === "github");
    assert.deepEqual(github?.vars, [{ name: variableName("github", "Authorization"), set: true }]);
    assert.equal(JSON.stringify(servers).includes("ghp_"), false, "la definición guarda la referencia, no la clave");
    // Lo ya importado deja de ofrecerse.
    assert.deepEqual(
      (await env.client.call("mcp.importable", {})).servers.map((s) => s.name),
      ["tiempo"],
    );
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
