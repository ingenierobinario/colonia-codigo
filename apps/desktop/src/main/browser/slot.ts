// NAVFIX-1: dónde va la vista nativa de la pestaña. El panel informa de su hueco en px de CSS; la ventana coloca las
// vistas en DIP. Coinciden mientras el zoom del panel sea 1 (el escalado del sistema —125 %, 150 %, Retina— no cuenta:
// va dentro del DIP). Con el panel ampliado hay que multiplicar, y la vista nunca sale del área de su ventana: una
// vista más ancha que la ventana pinta la página centrada fuera de la pantalla.
export type Bounds = { x: number; y: number; width: number; height: number };

const finite = (b: unknown): b is Bounds =>
  typeof b === "object" &&
  b !== null &&
  (["x", "y", "width", "height"] as const).every((k) => Number.isFinite((b as Record<string, unknown>)[k]));

/** El hueco que informa el panel (px de CSS), en DIP de su ventana; null si no es un rectángulo. */
export function slotToDip(b: unknown, zoom: number): Bounds | null {
  if (!finite(b)) return null;
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  // Se redondean los bordes, no el ancho: así el hueco no deja una rendija ni pisa un píxel de la barra de al lado.
  const left = Math.round(b.x * z);
  const top = Math.round(b.y * z);
  return {
    x: left,
    y: top,
    width: Math.max(0, Math.round((b.x + b.width) * z) - left),
    height: Math.max(0, Math.round((b.y + b.height) * z) - top),
  };
}

/** El hueco recortado al área de contenido de la ventana (la ventana puede encoger antes de que el panel lo diga). */
export function clipToArea(b: Bounds, area: { width: number; height: number }): Bounds {
  const x = Math.min(Math.max(0, b.x), area.width);
  const y = Math.min(Math.max(0, b.y), area.height);
  return {
    x,
    y,
    width: Math.max(0, Math.min(b.x + b.width, area.width) - x),
    height: Math.max(0, Math.min(b.y + b.height, area.height) - y),
  };
}
