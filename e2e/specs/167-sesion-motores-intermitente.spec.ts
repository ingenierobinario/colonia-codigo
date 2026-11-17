import fs from "node:fs";
import path from "node:path";
import { expect, rpc, test, world } from "./kit.ts";

// REV-CUOTAS-1: una comprobación de sesión que falla o tarda más de la cuenta nunca pinta «sin sesión» un motor que sí
// la tiene. Codex de mentira (e2e/fixtures.ts) contesta según bin/codex-login.

type Engine = { id: string; logged_in: boolean; checking?: boolean };
async function codex(refresh = true): Promise<Engine> {
  const { engines } = await rpc<{ engines: Engine[] }>("engines.status", { refresh });
  const engine = engines.find((item) => item.id === "codex");
  if (!engine) throw new Error("No se ha encontrado el motor simulado");
  return engine;
}

test("Codex con sesión no pasa a desconectado ni si la comprobación falla una vez ni si tarda demasiado", async () => {
  test.setTimeout(240_000);
  const bin = path.join((await world.info()).dir, "bin");
  const mode = path.join(bin, "codex-login");
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
  }
});
