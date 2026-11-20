import assert from "node:assert/strict";
import { test } from "node:test";
import { downloads, providerOf, remoteBridge } from "./bridge.ts";

test("un puente mcp-remote se reconoce con su URL y sus cabeceras, en sus variantes", () => {
  const meta = remoteBridge("npx", ["-y", "mcp-remote", "https://mcp.facebook.com/ads"]);
  assert.deepEqual(meta, { url: "https://mcp.facebook.com/ads", headers: {}, provider: "Meta" });
  assert.equal(
    remoteBridge("npx.cmd", ["mcp-remote@0.1.29", "https://x.example.com/mcp"])?.url,
    "https://x.example.com/mcp",
  );
  assert.equal(remoteBridge("C:\\nodejs\\npx.cmd", ["--yes", "@acme/mcp-remote", "https://a.io/m"])?.provider, "A");
  assert.equal(remoteBridge("pnpm", ["dlx", "mcp-remote", "https://mcp.notion.com/mcp"])?.provider, "Notion");
  const h = remoteBridge("npx", [
    "-y",
    "mcp-remote",
    "https://h.dev/mcp",
    "--header",
    "Authorization: Bearer secret://T",
    "--transport",
    "http-only",
  ]);
  assert.deepEqual(h?.headers, { Authorization: "Bearer secret://T" });
});

test("lo que no es un puente no se toma por uno", () => {
  assert.equal(remoteBridge("npx", ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]), undefined);
  assert.equal(remoteBridge("node", ["mcp-remote", "https://x.io"]), undefined);
  assert.equal(remoteBridge("npx", ["mcp-remote"]), undefined);
  assert.equal(remoteBridge("npx", ["mcp-remote", "file:///etc/passwd"]), undefined);
  assert.equal(remoteBridge(undefined, []), undefined);
});

test("el proveedor sale en palabras del owner y npx cuenta como descarga", () => {
  assert.equal(providerOf("https://graph.instagram.com/x"), "Meta");
  assert.equal(providerOf("https://mcp.linear.app/sse"), "Linear");
  assert.equal(downloads("npx"), true);
  assert.equal(downloads("uvx"), true);
  assert.equal(downloads(process.execPath), false);
});
