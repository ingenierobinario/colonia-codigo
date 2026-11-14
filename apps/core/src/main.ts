#!/usr/bin/env node
import { getDefaultAutoSelectFamilyAttemptTimeout, setDefaultAutoSelectFamilyAttemptTimeout } from "node:net";
import { exitWhenClosed } from "@colonia/protocol/exit";
import { legacyHome, loadConfig } from "./config.ts";
import { acquireDaemonLock } from "./daemon-lock.ts";
import { moveLegacyHome } from "./home.ts";
import { createLog } from "./log.ts";
import { stopWhenParentCloses } from "./processes.ts";
import { createCore } from "./server.ts";
import { surviveStrayErrors } from "./stray-errors.ts";
import { restartAfterClose } from "./updates.ts";

// See HISTORY.md#connection-attempt-timeout.
setDefaultAutoSelectFamilyAttemptTimeout(Math.max(2000, getDefaultAutoSelectFamilyAttemptTimeout()));

const config = loadConfig();
const startupLock = acquireDaemonLock(`${config.home}.startup`);
const lock = (() => {
  try {
    if (
      moveLegacyHome({ home: config.home, legacy: legacyHome(), explicit: Boolean(process.env.COLONIA_HOME) }) ===
      "moved"
    )
      console.warn(`Colonia moved its state from ${legacyHome()} to ${config.home}`);
    return acquireDaemonLock(config.home);
  } finally {
    startupLock.release();
  }
})();
process.once("exit", () => lock.release());
const core = await createCore(config, {
  // After an update: close, then the supervisor starts the new code.
  restart: () =>
    void restartAfterClose(
      () => core.close(),
      (code) => exitWhenClosed(code),
    ),
});
// ERR-3: once the core is up, a stray error anywhere is a line in the log, not the end of every agent and channel.
// Not before: a core that cannot start (the home taken by another, a bad config) must still end with an error.
surviveStrayErrors(createLog("core"));

let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  await core.close();
  exitWhenClosed(0);
};
// Windows: a closed console window is a HUP and Ctrl+Break a BREAK; neither may leave the agents' programs running.
const windows = process.platform === "win32" ? (["SIGHUP", "SIGBREAK"] as const) : [];
for (const signal of ["SIGINT", "SIGTERM", ...windows] as const) process.on(signal, stop);
// And a supervisor there cannot send a TERM: it closes the core's stdin.
stopWhenParentCloses(() => void stop());
