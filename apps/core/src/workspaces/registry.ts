import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Workspace } from "@colonia/protocol";
import { z } from "zod";
import { badRequest, notFound } from "../errors.ts";
import { writeAtomic } from "../paths.ts";

const Directory = z.array(Workspace.omit({ state: true })).max(32);

export function workspaceRegistry(home: string) {
  const file = path.join(home, "workspaces", "registry.json");
  const rootFile = path.join(home, "workspaces", "root.json");
  const Root = z.object({ name: z.string().trim().min(1).max(80) }).strict();
  const write = (entries: Omit<Workspace, "state">[]) =>
    writeAtomic(file, JSON.stringify(Directory.parse(entries)), 0o600);
  return {
    rootName: () =>
      fs.existsSync(rootFile) ? Root.parse(JSON.parse(fs.readFileSync(rootFile, "utf8"))).name : undefined,
    renameRoot(name: string) {
      const metadata = Root.parse({ name });
      writeAtomic(rootFile, JSON.stringify(metadata), 0o600);
      return metadata;
    },
    list: () => (fs.existsSync(file) ? Directory.parse(JSON.parse(fs.readFileSync(file, "utf8"))) : []),
    get(id: string) {
      const found = this.list().find((entry) => entry.id === id);
      if (!found) throw notFound("workspace");
      return found;
    },
    create(name: string): Omit<Workspace, "state"> {
      const current = this.list();
      if (current.length >= 32) throw badRequest("workspace limit reached");
      const entry = { id: `w_${randomUUID().replaceAll("-", "")}`, name, created_at: new Date().toISOString() };
      write([...current, entry]);
      return entry;
    },
    rename(id: string, name: string) {
      const entry = { ...this.get(id), name };
      write(this.list().map((item) => (item.id === id ? entry : item)));
      return entry;
    },
  };
}
