export type OfficeLabel = { id: string; x: number; y: number; width: number; height: number };
type Rect = { x: number; y: number; width: number; height: number };

/** Earlier labels have priority; crowded room names yield to clickable teammates. */
export function arrangeOfficeLabels(labels: OfficeLabel[], width: number, height: number, obstacles: Rect[] = []) {
  const placed = new Map<string, Rect>();
  const grid = new Map<string, Rect[]>();
  const bottom = width < 600 ? 120 : 80;
  const cells = (rect: Rect) => {
    const keys: string[] = [];
    for (let x = Math.floor(rect.x / 32); x <= Math.floor((rect.x + rect.width) / 32); x++)
      for (let y = Math.floor(rect.y / 32); y <= Math.floor((rect.y + rect.height) / 32); y++) keys.push(`${x}:${y}`);
    return keys;
  };
  for (const rect of obstacles) for (const key of cells(rect)) grid.set(key, [...(grid.get(key) ?? []), rect]);
  for (const label of labels) {
    if (label.width > width - 16 || label.height > height - 48 - bottom) continue;
    const step = Math.max(12, Math.min(label.width, label.height) / 2);
    const attempt = (dx: number, dy: number) => {
      const rect = {
        x: Math.max(8, Math.min(width - label.width - 8, label.x - label.width / 2 + dx * step)),
        y: Math.max(48, Math.min(height - label.height - bottom, label.y - label.height + dy * step)),
        width: label.width,
        height: label.height,
      };
      const padded = { x: rect.x - 3, y: rect.y - 3, width: rect.width + 6, height: rect.height + 6 };
      const keys = cells(padded);
      if (
        keys.some((key) =>
          (grid.get(key) ?? []).some(
            (other) =>
              padded.x < other.x + other.width &&
              padded.x + padded.width > other.x &&
              padded.y < other.y + other.height &&
              padded.y + padded.height > other.y,
          ),
        )
      )
        return false;
      placed.set(label.id, rect);
      for (const key of cells(rect)) grid.set(key, [...(grid.get(key) ?? []), rect]);
      return true;
    };
    if (attempt(0, 0)) continue;
    let found = false;
    for (let ring = 1; ring <= 20 && !found; ring++) {
      for (let offset = -ring; offset <= ring && !found; offset++)
        found = attempt(offset, -ring) || attempt(offset, ring);
      for (let offset = -ring + 1; offset < ring && !found; offset++)
        found = attempt(-ring, offset) || attempt(ring, offset);
    }
  }
  return placed;
}
