import { Icons } from "@colonia/ui";

export function Set() {
  const entries = Object.entries(Icons) as [string, any][];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 72px)", gap: 8, color: "var(--colonia-fg)" }}>
      {entries.map(([name, I]) => (
        <div key={name} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
          <I size={18} />
          <span style={{ fontSize: 9, color: "var(--colonia-fg-subtle)" }}>{name}</span>
        </div>
      ))}
    </div>
  );
}
