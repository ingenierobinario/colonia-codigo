import fs from "node:fs";
import path from "node:path";
import { expect, rpc, test, world } from "./kit.ts";

// REV-CUOTAS-1: una comprobación de sesión que falla o tarda más de la cuenta nunca pinta «sin sesión» un motor que sí
// la tiene. Codex de mentira (e2e/fixtures.ts) contesta según bin/codex-login.

type Engine = { id: string; logged_in: boolean; checking?: boolean };
const codex = async (refresh = true) =>
  (await rpc<{ engines: Engine[] }>("engines.status", { refresh })).engines.find((e) => e.id === "codex")!;

test("Codex con sesión no pasa a desconectado ni si la comprobación falla una vez ni si tarda demasiado", async () => {
  test.setTimeout(240_000);
  const bin = path.join((await world.info()).dir, "bin");
  const mode = path.join(bin, "codex-login");
  // Windows no arranca el guion #!/bin/sh de fixtures.ts: el mismo Codex de mentira, como el .cmd que deja npm.
  const win = process.platform === "win32";
  const extra = win ? [path.join(bin, "codex.cmd"), path.join(bin, "codex-fake.cjs")] : [];
  if (win) {
    fs.writeFileSync(extra[1]!, FAKE);
    fs.writeFileSync(extra[0]!, SHIM.join("\r\n"));
  }
  try {
    fs.writeFileSync(mode, "out");
    expect((await codex()).logged_in).toBe(false);

    fs.writeFileSync(mode, "in");
    expect((await codex()).logged_in).toBe(true);

    // Falla una vez: se reintenta y sigue conectado.
    fs.writeFileSync(mode, "fail-once");
    const once = await codex();
    expect(once.logged_in).toBe(true);
    expect(once.checking).toBeFalsy();

    // Más lento que la comprobación: se conserva el último estado bueno, nunca «desconectado».
    fs.writeFileSync(mode, "slow");
    const slow = await codex();
    expect(slow.logged_in).toBe(true);
  } finally {
    fs.writeFileSync(mode, "out");
    for (const f of extra) fs.rmSync(f, { force: true });
  }
});

const FAKE = `
const fs = require("node:fs");
const path = require("node:path");
const file = path.join(__dirname, "codex-login");
const [cmd] = process.argv.slice(2);
if (cmd === "--version") { console.log("codex-cli 0.1.0"); process.exit(0); }
if (cmd !== "login") process.exit(0);
const m = fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim() : "";
const yes = () => { console.error("Logged in using ChatGPT"); process.exit(0); };
if (m === "in") yes();
else if (m === "slow") setTimeout(yes, 45000);
else if (m === "fail-once") { fs.writeFileSync(file, "in"); process.exit(3); }
else { console.error("Not logged in"); process.exit(1); }
`;

// El .cmd que escribe `npm install -g`: Colonia sabe sacar de él qué programa arrancar.
const SHIM = [
  "@ECHO off",
  "GOTO start",
  ":find_dp0",
  "SET dp0=%~dp0",
  "EXIT /b",
  ":start",
  "SETLOCAL",
  "CALL :find_dp0",
  "",
  'IF EXIST "%dp0%\\node.exe" (',
  '  SET "_prog=%dp0%\\node.exe"',
  ") ELSE (",
  '  SET "_prog=node"',
  "  SET PATHEXT=%PATHEXT:;.JS;=;%",
  ")",
  "",
  'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\codex-fake.cjs" %*',
  "",
];
