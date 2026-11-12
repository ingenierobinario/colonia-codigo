import assert from "node:assert/strict";
import { test } from "node:test";
import { parseClaudeUsage, readClaudeUsage } from "./claude-usage.ts";

const body = {
  five_hour: { utilization: 15, resets_at: "2026-10-26T13:49:59.857235+00:00" },
  seven_day: { utilization: 87, resets_at: null },
  seven_day_opus: { utilization: 3, resets_at: null },
  extra_usage: { is_enabled: false },
};
const login = (expiresAt = 2_000) => JSON.stringify({ claudeAiOauth: { accessToken: "tok", expiresAt } });
const reply =
  (value: unknown, status = 200): typeof fetch =>
  async () =>
    new Response(JSON.stringify(value), { status });

test("Claude account limits exclude scoped model quotas and normalize reset times", () => {
  assert.deepEqual(parseClaudeUsage(body), [
    { id: "primary", used_percent: 15, window_minutes: 300, resets_at: "2026-10-26T13:49:59.857Z" },
    { id: "secondary", used_percent: 87, window_minutes: 10080 },
  ]);
  // A plan with only the weekly window (five_hour null) still shows its bar.
  assert.deepEqual(parseClaudeUsage({ five_hour: null, seven_day: { utilization: 7, resets_at: null } }), [
    { id: "secondary", used_percent: 7, window_minutes: 10080 },
  ]);
});

test("Claude rejects invalid limits and empty reports", () => {
  for (const value of [
    "bad",
    {},
    { five_hour: null, seven_day: null },
    { five_hour: { utilization: 101, resets_at: null } },
    { five_hour: { utilization: 10, resets_at: "tomorrow" } },
  ])
    assert.equal(parseClaudeUsage(value), undefined, JSON.stringify(value));
});

test("Claude reads the account endpoint with the stored login and never sends the refresh token", async () => {
  let seen: { url: string; init?: RequestInit } | undefined;
  const windows = await readClaudeUsage("claude", {
    credentials: async () => login(),
    now: () => 1_000,
    fetch: async (url, init) => {
      seen = { url: String(url), init };
      return new Response(JSON.stringify(body));
    },
  });
  assert.equal(windows?.[0]?.used_percent, 15);
  assert.equal(seen?.url, "https://api.anthropic.com/api/oauth/usage");
  const headers = seen?.init?.headers as Record<string, string>;
  assert.equal(headers.authorization, "Bearer tok");
  assert.equal(headers["anthropic-beta"], "oauth-2025-04-20");
});

test("Claude without a usable login or answer is unavailable", async () => {
  const ok = reply(body);
  for (const [label, options] of [
    ["no login", { credentials: async () => undefined, fetch: ok }],
    ["broken login", { credentials: async () => "{", fetch: ok }],
    ["expired login", { credentials: async () => login(500), now: () => 1_000, fetch: ok }],
    ["rejected", { credentials: async () => login(), now: () => 1_000, fetch: reply({}, 401) }],
    ["bad body", { credentials: async () => login(), now: () => 1_000, fetch: reply({ five_hour: 1 }) }],
    [
      "network",
      {
        credentials: async () => login(),
        now: () => 1_000,
        fetch: async () => {
          throw new Error("offline");
        },
      },
    ],
  ] as const)
    assert.equal(await readClaudeUsage("claude", options), undefined, label);
});

test("Claude reads the login from CLAUDE_CONFIG_DIR", async () => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "colonia-claude-"));
  try {
    await writeFile(join(dir, ".credentials.json"), login(Date.now() + 60_000));
    const windows = await readClaudeUsage("claude", { env: { CLAUDE_CONFIG_DIR: dir }, fetch: reply(body) });
    assert.equal(windows?.[1]?.used_percent, 87);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
