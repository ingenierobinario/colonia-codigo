// CHROME-1: the owner's downloads. A file a page hands over goes to the system's downloads folder under a name of its
// own; the panel hears when it starts and how it ends, and can open it or show it in its folder by its id (never by a
// path a page could make up).
import fs from "node:fs";
import type { DownloadItem } from "electron";
import { downloadPath, opensDirectly } from "./policy.ts";

export type DownloadNotice = {
  id: string;
  name: string;
  state: "started" | "completed" | "failed";
  /** A document or a picture opens from the notice; a program is only shown in its folder. */
  opens?: boolean;
};

export function createDownloads(opts: {
  dir: () => string;
  notify: (notice: DownloadNotice) => void;
  openPath: (file: string) => void;
  showInFolder: (file: string) => void;
}) {
  const files = new Map<string, string>();
  const pending = new Set<string>();
  let seq = 0;
  return {
    take(item: DownloadItem): void {
      const id = `d${++seq}`;
      let file: string;
      try {
        const dir = opts.dir();
        fs.mkdirSync(dir, { recursive: true });
        // Two downloads of the same name at once: the second must not take the first one's path.
        file = downloadPath(dir, item.getFilename(), (f) => pending.has(f) || fs.existsSync(f));
      } catch {
        item.cancel();
        opts.notify({ id, name: item.getFilename(), state: "failed" });
        return;
      }
      pending.add(file);
      item.setSavePath(file);
      const name = file.slice(Math.max(file.lastIndexOf("/"), file.lastIndexOf("\\")) + 1);
      opts.notify({ id, name, state: "started" });
      item.once("done", (_e, state) => {
        pending.delete(file);
        if (state !== "completed") return opts.notify({ id, name, state: "failed" });
        files.set(id, file);
        // The list of what can be opened does not grow without end.
        if (files.size > 200) for (const old of files.keys()) if (files.size > 200) files.delete(old);
        opts.notify({ id, name, state: "completed", opens: opensDirectly(file) });
      });
    },
    open(id: unknown): void {
      const file = typeof id === "string" ? files.get(id) : undefined;
      if (!file) return;
      if (opensDirectly(file)) opts.openPath(file);
      else opts.showInFolder(file);
    },
    show(id: unknown): void {
      const file = typeof id === "string" ? files.get(id) : undefined;
      if (file) opts.showInFolder(file);
    },
  };
}
