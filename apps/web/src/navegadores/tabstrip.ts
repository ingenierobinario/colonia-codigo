// NAVFIX-1: la tira de pestañas de un perfil: las reales (del navegador) y las nuevas aún vacías. Una pestaña vacía
// es una pestaña más, no un modo de la pantalla: «+» abre todas las que se quieran, y cada una se cierra por separado.
// Antes «+» solo encendía un interruptor: con una vacía a la vista, pulsarlo otra vez no hacía nada.
let seq = 0;

/** El id de una pestaña vacía nueva; nunca choca con los de las reales (t1, t2…). */
export const blankId = (): string => `blank:${++seq}`;
export const isBlank = (id: string | undefined): boolean => Boolean(id?.startsWith("blank:"));

/** La pestaña a la vista: la elegida si sigue en la tira; si no, la primera. */
export function activeOf(
  real: readonly string[],
  blanks: readonly string[],
  picked: string | undefined,
): string | undefined {
  if (picked && (real.includes(picked) || blanks.includes(picked))) return picked;
  return real[0] ?? blanks[0];
}

/** Tras cerrar `closed`: si era la que se veía, pasa a su vecina de la derecha (o la de la izquierda), como Chrome. */
export function afterClose(strip: readonly string[], closed: string, active: string | undefined): string | undefined {
  if (closed !== active) return active;
  const i = strip.indexOf(closed);
  return i < 0 ? active : (strip[i + 1] ?? strip[i - 1]);
}

/**
 * La pestaña real que acaba de aparecer mientras se abría una: el navegador la anuncia en cuanto existe, antes de
 * que la página termine de cargar, y la vista pasa a ella sin esperar (la espera dejaba la pestaña «frita»).
 */
/**
 * CHROME-1: la pestaña que acaba de abrir la página a la vista (un enlace que pide pestaña nueva, la ventana de
 * «Iniciar sesión con Google»): la vista pasa a ella, como en cualquier navegador.
 */
export function born(
  known: readonly string[],
  tabs: ReadonlyArray<{ tab: string; opener?: string | undefined }>,
  from: string | undefined,
): string | undefined {
  if (!from) return undefined;
  return tabs.filter((x) => x.opener === from && !known.includes(x.tab)).at(-1)?.tab;
}

export function adopted(known: readonly string[], real: readonly string[]): string | undefined {
  return real.filter((id) => !known.includes(id)).at(-1);
}
