import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { tempDir } from "../testkit/platform.ts";
import { readArchive, writeArchive } from "./archive.ts";
import { addProjectFile, projectFileAllowed, projectFiles } from "./project-files.ts";

test("la copia privada recoge los documentos y las definiciones del proyecto sin incluir otro proyecto anidado", async (t) => {
  const dir = tempDir("colonia-archivos-privados-");
  t.after(() => dir.remove());
  const root = path.join(dir.path, "proyecto");
  const home = path.join(dir.path, "colonia");
  const foreign = path.join(root, "cliente", "otro");
  const allowed = [
    "src/app.ts",
    "assets/diagrama.bin",
    ".claude/agents/equipo/revisor.md",
    ".codex/agents/redactor.toml",
    ".agents/skills/exportar/SKILL.md",
    ".apc/memory.md",
    ".apc/organization.json",
    ".apc/mcps.json",
    ".github/copilot-instructions.md",
    ".gitignore",
  ];
  const denied = [
    "cliente/otro/privado.md",
    ".apc/project.json",
    ".apc/agents/secrets.json",
    ".codex/auth.json",
    ".claude/settings.local.json",
    ".env.local",
    "credenciales/token.json",
    "Login Data",
    "sesion.colonia",
    ".git/config",
  ];
  const binary = Buffer.alloc(420_001, 137);
  for (const rel of [...allowed, ...denied]) {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, rel.endsWith(".bin") ? binary : rel);
  }
  const org = {
    areas: [{ slug: "ventas", name: "Ventas", campoPrivado: "dato-local" }],
    roles: [{ slug: "gestor", name: "Gestor", area: "ventas" }],
  };
  const mcp = {
    mcpServers: {
      correo: {
        url: "https://example.test/mcp?api_key=clave-sintetica",
        headers: { Authorization: "secreto-local" },
        env: { CLAVE: "clave-local" },
      },
    },
  };
  fs.writeFileSync(path.join(root, ".apc/organization.json"), JSON.stringify(org));
  fs.writeFileSync(path.join(root, ".apc/mcps.json"), JSON.stringify(mcp));
  const files = await projectFiles(root, home, [foreign]);
  assert.deepEqual(files.map((f) => f.rel).sort(), allowed.toSorted());
  assert.equal(files.find((f) => f.rel.endsWith(".bin"))?.size, binary.length);
  const organization = files.find((f) => f.rel === ".apc/organization.json")?.definition;
  assert.ok(organization);
  assert.deepEqual(JSON.parse(organization.toString()), {
    areas: [{ slug: "ventas", name: "Ventas" }],
    roles: org.roles,
  });
  const connectors = files.find((f) => f.rel === ".apc/mcps.json");
  assert.ok(connectors?.definition);
  assert.equal(connectors.archiveBytes, connectors.definition.length);
  assert.deepEqual(JSON.parse(connectors.definition.toString()), {
    mcpServers: { correo: { url: "https://example.test/mcp", headers: { Authorization: "" }, env: { CLAVE: "" } } },
  });
  const file = path.join(dir.path, "archivo.colonia");
  const writer = await writeArchive(file, "prueba-local", {
    created_at: new Date().toISOString(),
    app_version: "test",
  });
  const bin = files.find((f) => f.rel.endsWith(".bin"));
  assert.ok(bin);
  await addProjectFile(writer, `work/${bin.rel}`, root, bin);
  await writer.close();
  const chunks: Buffer[] = [];
  await readArchive(file, "prueba-local", (meta) => {
    assert.equal(meta.p, "work/assets/diagrama.bin");
    return { write: (chunk) => chunks.push(Buffer.from(chunk)), end: () => {} };
  });
  assert.deepEqual(Buffer.concat(chunks), binary);
  for (const rel of [
    ...denied.slice(1),
    "../otro",
    "sub/../escape",
    "D:/x",
    "a\\b",
    "/x",
    "aux.txt",
    "carpeta/nombre.",
  ])
    assert.equal(projectFileAllowed(rel), false, rel);
  await assert.rejects(projectFiles(root, home, [root]), /proyecto/i);
  await assert.rejects(projectFiles(dir.path, home, []), /carpeta/i);
});

test("un archivo sustituido por un enlace al preparar la copia nunca entra en el contenedor", async (t) => {
  const dir = tempDir("colonia-cambio-privado-");
  t.after(() => dir.remove());
  const root = path.join(dir.path, "proyecto");
  fs.mkdirSync(root);
  const file = path.join(root, "trabajo.txt");
  fs.writeFileSync(file, "Proyecto A");
  const [entry] = await projectFiles(root, path.join(dir.path, "home"), []);
  assert.ok(entry);
  const other = path.join(dir.path, "ajeno.txt");
  fs.writeFileSync(other, "Proyecto B");
  fs.unlinkSync(file);
  fs.linkSync(other, file);
  const writer = await writeArchive(path.join(dir.path, "copia.colonia"), "solo-prueba", {
    created_at: new Date().toISOString(),
    app_version: "test",
  });
  try {
    await assert.rejects(addProjectFile(writer, "work/trabajo.txt", root, entry));
  } finally {
    writer.abort();
  }
});

test("una copia verificada avisa si el documento se acorta mientras se lee", async (t) => {
  const dir = tempDir("colonia-fichero-acortado-");
  t.after(() => dir.remove());
  const file = path.join(dir.path, "trabajo.bin");
  fs.writeFileSync(file, Buffer.alloc(1_100_000, 9));
  const writer = await writeArchive(path.join(dir.path, "copia.colonia"), "clave-prueba", {
    created_at: new Date().toISOString(),
    app_version: "test",
  });
  const original = fs.statSync(file).size;
  let checks = 0;
  try {
    await assert.rejects(
      writer.addFile("files/trabajo.bin", file, (fd) => {
        if (fs.fstatSync(fd).size !== original) throw new Error("El archivo cambió");
        if (++checks === 1) fs.truncateSync(file, 123);
      }),
      /cambi/,
    );
  } finally {
    writer.abort();
  }
});
