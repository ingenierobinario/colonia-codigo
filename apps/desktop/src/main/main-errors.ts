// FALLO-SIN-DIALOGO-1: sin manejador, Electron enseña una excepción no capturada del proceso principal en un diálogo
// modal («A JavaScript error occurred in the main process»). En Windows ese diálogo bloquea el proceso: si llega
// mientras la app sale, la salida (y la actualización que se instala al salir) se queda colgada hasta que alguien lo
// cierre. La excepción se escribe en logs/main.log con su traza completa y la app sigue; la causa se arregla en su
// sitio, esto solo evita que el usuario se quede atascado.
import fs from "node:fs";
import path from "node:path";

type Proc = { on(event: "uncaughtException", fn: (error: unknown, origin?: string) => void): unknown };

/** La línea que se guarda: hora, origen y la traza entera (o el valor, si no es un Error). */
export function uncaughtLine(error: unknown, origin = "uncaughtException", now = new Date()): string {
  const what = error instanceof Error ? (error.stack ?? `${error.name}: ${error.message}`) : String(error);
  return `${now.toISOString()} ${origin}: ${what}\n`;
}

export function logUncaught(proc: Proc, file: string, also: (line: string) => void = (l) => console.error(l)): void {
  proc.on("uncaughtException", (error, origin) => {
    const line = uncaughtLine(error, origin);
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.appendFileSync(file, line);
    } catch {
      // Sin disco donde escribir, al menos la consola.
    }
    try {
      also(line);
    } catch {}
  });
}
