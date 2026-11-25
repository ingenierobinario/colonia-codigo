import fs from "node:fs";
import path from "node:path";
import { exitWhenClosed } from "@colonia/protocol/exit";
import { loadConfig } from "../config.ts";
import { acquireDaemonLock } from "../daemon-lock.ts";
import { createCore } from "../server.ts";
import { workspaceComputer } from "./environment.ts";

const config = loadConfig();
for (const dir of ["account", "tmp"]) fs.mkdirSync(path.join(config.home, dir), { recursive: true });
const lock = acquireDaemonLock(config.home);
let core: Awaited<ReturnType<typeof createCore>> | undefined;
let requested = !process.connected;
let stopping = false;
const stop = async () => {
  requested = true;
  if (stopping || !core) return;
  stopping = true;
  await core.close();
  lock.release();
  if (process.connected) process.disconnect?.();
  exitWhenClosed(0);
};
process.on("message", (message) => {
  if (message === "stop") void stop();
});
process.once("disconnect", () => void stop());
process.once("SIGTERM", () => void stop());
process.once("SIGINT", () => void stop());
if (requested) {
  lock.release();
  exitWhenClosed(0);
} else {
  core = await createCore(config, {
    workspaceWorker: true,
    computer: workspaceComputer(config.home),
    restart: () => {
      process.send?.({ type: "restart" }, () => void stop());
    },
  });
  if (requested || !process.connected) await stop();
  else
    process.send?.({ type: "ready", url: core.url }, (error) => {
      if (error) void stop();
    });
}
