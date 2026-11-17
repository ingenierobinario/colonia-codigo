import fs from "node:fs";
import path from "node:path";
import { parse } from "smol-toml";
import { FILE_MAX } from "../domain/project-package.ts";
import { parseFrontmatter, textField } from "./frontmatter.ts";
import { agentFile, writeAgentFromTemplate } from "./write.ts";

const slugPattern = /^[a-z][a-z0-9_-]{0,80}$/;
type Source = { slug: string; text: string };
type Engine = "claude" | "codex";

function regularDirectory(dir: string): boolean {
  try {
    return fs.lstatSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function asMarkdown(source: string, filename: string, engine: Engine): Source | undefined {
  if (engine === "claude") {
    const declared = textField(parseFrontmatter(source).fields.name);
    const slug = declared && slugPattern.test(declared) ? declared : path.basename(filename, ".md");
    return slugPattern.test(slug) ? { slug, text: source } : undefined;
  }
  const parsed = parse(source);
  const { name, description, developer_instructions: prompt, model } = parsed;
  if (
    typeof name !== "string" ||
    !slugPattern.test(name) ||
    typeof description !== "string" ||
    typeof prompt !== "string"
  )
    return;
  // Una restricción específica de Codex no puede desaparecer al pasar a otro motor.
  if (
    Object.keys(parsed).some(
      (k) =>
        ![
          "name",
          "description",
          "developer_instructions",
          "model",
          "model_reasoning_effort",
          "model_verbosity",
          "model_reasoning_summary",
        ].includes(k),
    )
  )
    return;
  if (model !== undefined && (typeof model !== "string" || !/^[a-zA-Z0-9_.:/-]+$/.test(model))) return;
  const desc = description.split(/\r?\n/);
  if (desc.some((l) => l.trim() === "---")) return;
  const lines = ["---", `name: ${name}`, "description: |", ...desc.map((l) => `  ${l}`)];
  if (model) {
    const effort = parsed.model_reasoning_effort;
    if (effort !== undefined && (typeof effort !== "string" || !/^[a-z]+$/.test(effort))) return;
    lines.push(`model: codex:${model}${effort ? `#${effort}` : ""}`);
  }
  return { slug: name, text: [...lines, "---", "", prompt.trim(), ""].join("\n") };
}

/** Definiciones adicionales que se pueden trasladar como agentes de Colonia sin modificar su origen. */
export function portableAgents(root: string, engine: Engine) {
  const agents: Source[] = [];
  let skipped = 0;
  const base = path.join(root, `.${engine}`);
  const dir = path.join(base, "agents");
  if (!regularDirectory(base) || !regularDirectory(dir)) return { agents, skipped };
  let visited = 0;
  function scan(folder: string, depth: number) {
    if (depth > 16 || visited >= 1000) {
      skipped++;
      return;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs
        .readdirSync(folder, { withFileTypes: true })
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    } catch {
      skipped++;
      return;
    }
    for (const entry of entries) {
      if (++visited > 1000) {
        skipped++;
        break;
      }
      if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.isSymbolicLink()) continue;
      const file = path.join(folder, entry.name);
      if (engine === "claude" && entry.isDirectory()) {
        scan(file, depth + 1);
        continue;
      }
      if (
        !entry.isFile() ||
        !(engine === "codex" ? entry.name.endsWith(".toml") : depth > 0 && entry.name.endsWith(".md"))
      )
        continue;
      try {
        const info = fs.lstatSync(file);
        if (!info.isFile() || info.size > FILE_MAX) {
          skipped++;
          continue;
        }
        const text = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
        const agent = text.includes("\0") ? undefined : asMarkdown(text, entry.name, engine);
        if (agent && agent.text.length <= FILE_MAX) agents.push(agent);
        else skipped++;
      } catch {
        skipped++;
      }
    }
  }
  scan(dir, 0);
  return { agents, skipped };
}

/** La importación explícita conserva el original y crea sólo las definiciones que faltan en el proyecto de destino. */
export function copyPortableAgents(root: string, engine: Engine) {
  const { agents, skipped } = portableAgents(root, engine);
  let added = 0;
  for (const agent of agents) {
    if (fs.existsSync(agentFile(root, agent.slug))) continue;
    writeAgentFromTemplate(root, agent.slug, agent.text, {});
    added++;
  }
  return { added, skipped };
}
