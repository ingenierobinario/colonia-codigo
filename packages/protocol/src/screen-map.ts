// Cómo se pasa de un píxel de la captura al punto de pantalla donde se hace clic. Antes lo calculaba el modelo con la
// fórmula que le daba el texto de la captura («px*1.2 + x»): con pantallas de más de 1600 px, monitores desplazados o
// una ventana recortada por el borde, el clic caía fuera unas veces sí y otras no. Ahora la cuenta la hace el código,
// siempre igual, y el modelo solo dice qué píxel de la imagen quiere.
import { z } from "zod";

/** La zona de la pantalla (en puntos) que muestra una captura, y el tamaño de esa captura en píxeles. */
export const ScreenMap = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  px_width: z.number().int().positive(),
  px_height: z.number().int().positive(),
});
export type ScreenMap = z.infer<typeof ScreenMap>;

/** Identidad de presentación que el motor añade a una acción para el escritorio. */
export const ComputerActor = z.object({ id: z.string().min(1), name: z.string().min(1), blob: z.string().optional() });
export type ComputerActor = z.infer<typeof ComputerActor>;

/** Cómo maneja el agente la pantalla: lo elige siempre la persona. `ask` = aún no lo ha dicho. */
export const ComputerMode = z.enum(["ask", "live", "background"]);
export type ComputerMode = z.infer<typeof ComputerMode>;

type Rect = { x: number; y: number; width: number; height: number };

/**
 * El punto de pantalla del píxel (px,py) de la captura: el centro de ese píxel. Falla si el píxel no está en la
 * imagen, en vez de hacer clic en otra parte.
 */
export function pictureToScreen(map: ScreenMap, px: number, py: number): { x: number; y: number } {
  if (!Number.isFinite(px) || !Number.isFinite(py) || px < 0 || py < 0 || px >= map.px_width || py >= map.px_height)
    throw new RangeError(
      `the pixel ${px},${py} is outside the picture (${map.px_width}x${map.px_height} px): look again and take it from the new picture`,
    );
  const x = map.x + ((px + 0.5) * map.width) / map.px_width;
  const y = map.y + ((py + 0.5) * map.height) / map.px_height;
  // Nunca fuera de la zona capturada, tampoco por el redondeo.
  return {
    x: Math.min(Math.max(Math.round(x), Math.ceil(map.x)), Math.floor(map.x + map.width - 1)),
    y: Math.min(Math.max(Math.round(y), Math.ceil(map.y)), Math.floor(map.y + map.height - 1)),
  };
}

/**
 * El recorte de una ventana dentro de la captura de su pantalla (`k` píxeles por punto) y la zona de pantalla que de
 * verdad muestra ese recorte. Una ventana maximizada en Windows mide -8,-8 y se sale de la pantalla: el recorte se
 * acota, y la zona devuelta es la acotada, no la de la ventana (dar la de la ventana desplazaba cada clic).
 */
export function windowCrop(
  bounds: Rect,
  display: Rect,
  k: number,
  size: { width: number; height: number },
): { crop: Rect; region: Rect } | undefined {
  const x = Math.max(0, Math.round((bounds.x - display.x) * k));
  const y = Math.max(0, Math.round((bounds.y - display.y) * k));
  const right = Math.min(size.width, Math.round((bounds.x + bounds.width - display.x) * k));
  const bottom = Math.min(size.height, Math.round((bounds.y + bounds.height - display.y) * k));
  const width = right - x;
  const height = bottom - y;
  if (width <= 0 || height <= 0) return undefined;
  return {
    crop: { x, y, width, height },
    region: { x: display.x + x / k, y: display.y + y / k, width: width / k, height: height / k },
  };
}
