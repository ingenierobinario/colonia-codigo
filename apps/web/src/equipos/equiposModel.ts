// EQUIPOS-ALIAS-1 y ESTE-EQUIPO-1 · Lo que la barra lateral y la pantalla «Mis equipos» comparten sin tocar React:
// en qué orden van los equipos, cuál es este ordenador y qué nombre vale al renombrar.
import type { Equipo, EquipoLocal } from "@colonia/protocol";
// PERF-2: de `/client`, que no lleva zod; desde la raíz esta constante metía los esquemas enteros en la primera carga.
import { THIS_EQUIPO_ID } from "@colonia/protocol/client";

/** El mismo tope que guarda el servidor. */
export const ALIAS_MAX = 60;

export type EquipoEntry = {
  id: string;
  /** El nombre que se enseña: el que le puso el dueño o el del propio equipo. */
  name: string;
  /** El nombre del propio equipo, que no cambia. */
  hostname: string;
  alias?: string;
  /** Es el ordenador donde corre Colonia. */
  self: boolean;
  connected: boolean;
};

type Listed = { equipos: Equipo[]; local?: EquipoLocal };

const ofEquipo = (e: Equipo, self: boolean): EquipoEntry => ({
  id: e.id,
  name: e.name,
  hostname: e.hostname ?? e.name,
  alias: e.alias,
  self,
  connected: e.connected,
});

/**
 * Los equipos en el orden en que se enseñan: este ordenador siempre el primero y una sola vez. Si además está conectado
 * como uno más de la red, esa conexión ocupa su sitio en vez de salir dos veces.
 */
export function equipoEntries(list: Listed | undefined): EquipoEntry[] {
  if (!list) return [];
  const own = list.equipos.find((e) => e.local);
  const rest = list.equipos.filter((e) => e !== own).map((e) => ofEquipo(e, false));
  if (own) return [ofEquipo(own, true), ...rest];
  if (!list.local) return rest;
  const { name, hostname, alias } = list.local;
  return [{ id: THIS_EQUIPO_ID, name, hostname, alias, self: true, connected: true }, ...rest];
}

/** Como lo deja el servidor: espacios y saltos de línea juntos en uno, sin bordes y con tope. */
export const cleanAlias = (raw: string): string => raw.replace(/\s+/g, " ").trim().slice(0, ALIAS_MAX).trim();

/** Lo que se manda al guardar: vacío (o el nombre del propio equipo) quita el nombre puesto. */
export function aliasToSave(raw: string, e: Pick<EquipoEntry, "hostname">): string {
  const alias = cleanAlias(raw);
  return alias === e.hostname ? "" : alias;
}

/** Otro equipo ya se llama así, por el nombre puesto o por el suyo propio. */
export function aliasTaken(alias: string, id: string, all: EquipoEntry[]): boolean {
  const wanted = cleanAlias(alias).toLowerCase();
  if (!wanted) return false;
  return all.some((e) => e.id !== id && [e.name, e.hostname].some((n) => n.toLowerCase() === wanted));
}

/** El nombre del propio equipo, solo cuando el que se enseña es otro. */
export const realName = (e: Pick<EquipoEntry, "name" | "hostname">): string | undefined =>
  e.hostname && e.hostname !== e.name ? e.hostname : undefined;
