// colonia equipo: este portátil como equipo de un Colonia principal. El código se teclea AQUÍ (nunca va en argumentos,
// que quedarían en el historial) y la contraseña, si hace falta, tampoco se muestra. Solo el dueño, desde el propio equipo.
import readline from "node:readline/promises";
import type { ColoniaClient } from "@colonia/protocol/client";

const USAGE = `colonia equipo                               Estado de este equipo
colonia equipo emparejar <url> <huella>      Emparejar con un Colonia (pide el código que ves en su pantalla)
colonia equipo desbloquear                   Desbloquear la clave con tu contraseña
colonia equipo desconectar                   Desconectar y borrar la clave de este equipo`;

export type Ask = (question: string, secret?: boolean) => Promise<string>;

/** Pregunta por la terminal; con secret no repite lo que se teclea. */
export const askTerminal: Ask = async (question, secret) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(secret) });
  if (secret) {
    const out = rl as unknown as { _writeToOutput: (s: string) => void };
    out._writeToOutput = () => {};
    process.stdout.write(question);
  }
  try {
    return (await rl.question(secret ? "" : question)).trim();
  } finally {
    rl.close();
    if (secret) process.stdout.write("\n");
  }
};

export async function equipo(client: ColoniaClient, [sub, url, fingerprint]: string[], ask: Ask = askTerminal) {
  if (sub === "emparejar") {
    if (!url || !fingerprint) throw new Error(USAGE);
    const s = await client.call("equipos.local_state", {});
    let passphrase: string | undefined;
    if (s.needs_passphrase) {
      console.log(
        "Este equipo no tiene almacén seguro de claves del sistema: la clave se guardará cifrada con una contraseña que elijas ahora.",
      );
      passphrase = await ask("Elige una contraseña (mínimo 8 caracteres): ", true);
      if (passphrase.length < 8) throw new Error("La contraseña necesita al menos 8 caracteres: no se empareja.");
    }
    const code = await ask("Código de 6 cifras que ves en Colonia: ");
    const r = await client.call("equipos.local_pair", {
      url,
      fingerprint,
      code,
      ...(passphrase ? { passphrase } : {}),
    });
    console.log(`Emparejado: este equipo es «${r.name}» en ese Colonia.`);
    return;
  }
  if (sub === "desbloquear") {
    const passphrase = await ask("Contraseña: ", true);
    console.log(
      (await client.call("equipos.local_unlock", { passphrase })).unlocked ? "Desbloqueado" : "Contraseña incorrecta",
    );
    return;
  }
  if (sub === "desconectar") {
    console.log(
      (await client.call("equipos.local_disconnect", {})).disconnected
        ? "Desconectado y clave borrada"
        : "Este equipo no estaba emparejado",
    );
    return;
  }
  if (sub) throw new Error(USAGE);
  const s = await client.call("equipos.local_state", {});
  if (!s.paired) {
    console.log(
      `Sin emparejar.${s.needs_passphrase ? " (Sin almacén de claves del sistema: se pedirá una contraseña.)" : ""}\n\n${USAGE}`,
    );
    return;
  }
  console.log(
    `${s.name ?? "este equipo"} · ${s.connected ? "conectado" : s.locked ? "bloqueado (colonia equipo desbloquear)" : "sin conexión"} · ${s.principal?.url ?? ""}`,
  );
  console.log(`Permitir siempre: ${s.always_allow ? "sí" : "no"} · peticiones pendientes: ${s.pending.length}`);
  for (const a of s.audit.slice(0, 10)) console.log(`  ${new Date(a.at).toLocaleString()}  ${a.detail}`);
}
