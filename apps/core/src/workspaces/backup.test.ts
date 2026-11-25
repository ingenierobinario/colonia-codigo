import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { ColoniaClient } from "@colonia/protocol/client";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { waitFor } from "../testkit/platform.ts";

test("restoring a business restarts only its worker and preserves the supervisor directory", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    const { workspace } = await env.client.call("workspaces.create", { name: "Business backup" });
    const business = new ColoniaClient({ url: `${env.core.url}/workspaces/${workspace.id}` });
    const agent = await business.call("agents.create", {
      slug: "backup-agent",
      name: "Before backup",
      role: "Backup fixture",
    });
    const password = "temporary-backup-test-password";
    await business.call("backup.create", { password, folder: path.join(env.home, "copias") });
    const saved = await waitFor(
      async () => {
        const status = await business.call("backup.status", {});
        assert.notEqual(status.state, "failed", status.why);
        return status.state === "done" && status.file;
      },
      "business backup completes",
      { ms: 30000 },
    );
    await business.call("agents.update", { agent: agent.id, name: "After backup" });
    await business.call("backup.restore", { file: saved, password, mode: "replace" });
    await waitFor(
      async () => {
        try {
          return (
            (await business.call("agents.list", {})).agents.find((item) => item.id === agent.id)?.name ===
            "Before backup"
          );
        } catch {
          return false;
        }
      },
      "the worker restarts and reads its restored database",
      { ms: 30000 },
    );
    assert.equal((await env.client.call("workspaces.list", {})).workspaces[0]?.name, "Business backup");
    assert.equal(
      (await env.client.call("agents.list", {})).agents.some((item) => item.id === agent.id),
      false,
    );
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
