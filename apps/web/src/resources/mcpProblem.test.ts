import assert from "node:assert/strict";
import { test } from "node:test";
import type { McpServerStatus } from "@colonia/protocol";
import { mcpProblem } from "./labels.ts";

const base = {
  name: "metaads",
  scope: "global",
  transport: "stdio",
  target: "npx -y mcp-remote https://mcp.facebook.com/ads",
  enabled: true,
  trusted: true,
  tools: 0,
  tool_names: [],
  tool_permission_mode: "unknown",
  vars: [],
  only: false,
  off_here: false,
  bridge: { url: "https://mcp.facebook.com/ads", provider: "Meta" },
} as const;
const s = (x: Partial<McpServerStatus>) => ({ ...base, status: "off", ...x }) as McpServerStatus;
const t = ((k: string, v?: Record<string, unknown>) => `${k}${v ? JSON.stringify(v) : ""}`) as never;

test("el rechazo del proveedor se cuenta con su nombre, nunca con el error crudo", () => {
  const p = mcpProblem(s({ status: "error", problem: "rejected", error: "Dynamic registration…" }));
  assert.equal(p?.kind, "rejected");
  assert.equal(p?.text(t), 'res.problem.rejected{"provider":"Meta"}');
});

test("arranque lento, preparación y fallo genérico; pedir conectar no es un fallo", () => {
  assert.equal(mcpProblem(s({ status: "error", problem: "slow", error: "no answer in 150s" }))?.kind, "slow");
  assert.equal(mcpProblem(s({ status: "error", error: "boom" }))?.kind, "other");
  assert.equal(mcpProblem(s({}), { ok: false, problem: "preparing" })?.kind, "preparing");
  assert.equal(
    mcpProblem(s({ status: "needs-sign-in" }), { ok: false, error: "it asked you to sign in: …" }),
    undefined,
  );
  assert.equal(mcpProblem(s({ status: "needs-sign-in" })), undefined);
  assert.equal(mcpProblem(s({ status: "error", problem: "rejected" }), { ok: true }), undefined);
});
