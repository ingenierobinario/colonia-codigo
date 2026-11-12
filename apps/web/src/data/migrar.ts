// IMPORTAR-1: estado del asistente de importación (abierto o no) y si ya se ofreció en el primer uso.
import { createStore, useSlice } from "./createStore.ts";

const store = createStore<{ open: boolean }>({ open: false });
export const useMigrar = <T>(select: (s: { open: boolean }) => T): T => useSlice(store, select);
export const abrirAsistente = () => store.set({ open: true });
export const cerrarAsistente = () => store.set({ open: false });

const CLAVE = "colonia.importar.ofrecido";
export const yaOfrecido = (): boolean => {
  try {
    return localStorage.getItem(CLAVE) === "1";
  } catch {
    return true;
  }
};
export const marcarOfrecido = (): void => {
  try {
    localStorage.setItem(CLAVE, "1");
  } catch {
    /* sin almacenamiento: no se vuelve a abrir solo en esta sesión */
  }
};

/**
 * PERFIL-AGENTE-1: lo importado de un perfil no se ancla en la barra lateral; queda como UNA nota global de Memoria
 * (la que ya ven todos los agentes en cada turno), para que sepan qué herramientas usa el dueño y puedan conectarlas.
 */
export const MAX_NOTA = 2000;
export function notaDelPerfil(
  cabecera: string,
  rotulos: { apps: string; sitios: string },
  reconocidas: readonly { name: string; url: string }[],
  marcadores: readonly { url: string }[],
  visitadas: readonly { host: string }[],
): string | undefined {
  const hostDe = (u: string) => {
    try {
      return new URL(u).host.toLowerCase();
    } catch {
      return undefined;
    }
  };
  const vistos = new Set(reconocidas.map((w) => hostDe(w.url)).filter(Boolean));
  const sitios: string[] = [];
  for (const h of [...visitadas.map((v) => v.host.toLowerCase()), ...marcadores.map((m) => hostDe(m.url))]) {
    if (h && !vistos.has(h)) {
      vistos.add(h);
      sitios.push(h);
    }
  }
  if (!reconocidas.length && !sitios.length) return undefined;
  const partes = [`${cabecera}.`];
  if (reconocidas.length) partes.push(`${rotulos.apps}: ${reconocidas.map((w) => `${w.name} (${w.url})`).join(", ")}.`);
  let texto = partes.join(" ");
  if (sitios.length) {
    let linea = ` ${rotulos.sitios}: `;
    for (const [i, s] of sitios.entries()) {
      const trozo = `${i ? ", " : ""}${s}`;
      if (texto.length + linea.length + trozo.length + 1 > MAX_NOTA) break;
      linea += trozo;
    }
    texto += `${linea}.`;
  }
  return texto.slice(0, MAX_NOTA);
}
