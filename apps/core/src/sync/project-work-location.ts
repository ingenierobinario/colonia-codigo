import type { DatabaseSync } from "node:sqlite";

export function prepareWorkLocations(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS sync_work_locations(
    project TEXT PRIMARY KEY, local_path TEXT NOT NULL, source_path TEXT
  );
  CREATE TABLE IF NOT EXISTS sync_work_origins(peer TEXT NOT NULL, project TEXT NOT NULL, folder TEXT NOT NULL, PRIMARY KEY(peer,project));
  CREATE TABLE IF NOT EXISTS sync_work_receipts(
    peer TEXT NOT NULL, transfer TEXT NOT NULL, project TEXT NOT NULL, sha TEXT NOT NULL, PRIMARY KEY(peer,transfer)
  );`);
}

/** La ruta física del receptor es local. El diario sigue anunciando la ruta lógica que ya conocía la pareja. */
export function workLocation(db: DatabaseSync, project: string) {
  return db
    .prepare(
      "SELECT coalesce(p.path,w.local_path) AS local_path, w.source_path FROM sync_work_locations w JOIN projects p ON p.id=w.project WHERE w.project=?",
    )
    .get(project) as { local_path: string; source_path: string | null } | undefined;
}
