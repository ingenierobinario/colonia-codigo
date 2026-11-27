export type RoomShape = { id: string; agents: readonly { id: string }[] };

export function sceneLayout(rooms: readonly RoomShape[]) {
  const columns = Math.max(1, Math.ceil(Math.sqrt(rooms.length)));
  const sizes = rooms.map((room) => {
    const desks = Math.max(2, Math.min(6, Math.ceil(Math.sqrt(room.agents.length))));
    return { desks, width: desks * 3 + 0.5, depth: Math.max(7, Math.ceil(room.agents.length / desks) * 3 + 3) };
  });
  const columnWidths = Array.from(
    { length: columns },
    (_, column) => Math.max(0, ...sizes.filter((_, i) => i % columns === column).map((size) => size.width)) + 1.5,
  );
  const rowDepths = Array.from(
    { length: Math.ceil(rooms.length / columns) },
    (_, row) => Math.max(0, ...sizes.slice(row * columns, (row + 1) * columns).map((size) => size.depth)) + 1.5,
  );
  return rooms.map((room, index) => ({
    id: room.id,
    x: columnWidths.slice(0, index % columns).reduce((a, b) => a + b, 0),
    z: rowDepths.slice(0, Math.floor(index / columns)).reduce((a, b) => a + b, 0),
    width: sizes[index]?.width ?? 6.5,
    depth: sizes[index]?.depth ?? 7,
    stations: room.agents.map((agent, i) => ({
      id: agent.id,
      x: 1.7 + (i % (sizes[index]?.desks ?? 2)) * 3,
      z: 2 + Math.floor(i / (sizes[index]?.desks ?? 2)) * 3,
    })),
  }));
}
