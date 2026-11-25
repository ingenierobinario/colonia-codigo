import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";

test("HTTP MCP redirects never forward a business credential to another origin", async (t) => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  const received: Array<string | string[] | undefined> = [];
  const destination = http.createServer((req, res) => {
    received.push(req.headers["x-business-key"]);
    res.writeHead(500).end();
  });
  const presented: Array<string | string[] | undefined> = [];
  const origin = http.createServer((req, res) => {
    presented.push(req.headers["x-business-key"]);
    const port = (destination.address() as AddressInfo).port;
    res.writeHead(307, { location: `http://127.0.0.1:${port}/mcp` }).end();
  });
  t.after(async () => {
    await env.core.close();
    for (const server of [origin, destination]) {
      server.closeAllConnections();
      if (server.listening) await server[Symbol.asyncDispose]();
    }
    await env.cleanup();
  });
  for (const server of [destination, origin])
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  await env.client.call("secrets.set", { name: "redirect-key", value: "redirect-test-credential" });
  await env.client.call("mcp.set", {
    name: "redirecting",
    server: {
      url: `http://127.0.0.1:${(origin.address() as AddressInfo).port}/mcp`,
      headers: { "X-Business-Key": "secret://redirect-key" },
    },
  });
  const result = await env.client.call("mcp.tools", { scope: "global", server: "redirecting" });
  assert.ok(presented.includes("redirect-test-credential"), "the configured server receives its own credential");
  assert.deepEqual(received, [], "the other origin receives neither the request nor its credential");
  assert.deepEqual(result.tools, []);
  assert.match(result.error ?? "", /redirect|origin/i);
});

test("HTTP MCP redirects within the configured origin preserve a working connection", async (t) => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  const presented: Array<string | string[] | undefined> = [];
  const server = http.createServer((req, res) => {
    if (req.method !== "POST") return void res.writeHead(405).end();
    if (req.url === "/entry") return void res.writeHead(307, { location: "/mcp" }).end();
    presented.push(req.headers["x-business-key"]);
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => (body += chunk));
    req.on("end", () => {
      const message = JSON.parse(body) as { id?: number; method: string; params?: { protocolVersion?: string } };
      if (message.id === undefined) return void res.writeHead(202).end();
      const result =
        message.method === "initialize"
          ? {
              protocolVersion: message.params?.protocolVersion,
              capabilities: { tools: {} },
              serverInfo: { name: "fixture", version: "1" },
            }
          : { tools: [{ name: "echo", inputSchema: { type: "object", properties: {} } }] };
      res
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
    });
  });
  t.after(async () => {
    await env.core.close();
    server.closeAllConnections();
    if (server.listening) await server[Symbol.asyncDispose]();
    await env.cleanup();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  await env.client.call("secrets.set", { name: "redirect-key", value: "same-server-credential" });
  await env.client.call("mcp.set", {
    name: "redirecting",
    server: {
      url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/entry`,
      headers: { "X-Business-Key": "secret://redirect-key" },
    },
  });
  const result = await env.client.call("mcp.tools", { scope: "global", server: "redirecting" });
  assert.equal(result.error, undefined);
  assert.deepEqual(
    result.tools.map((tool) => tool.name),
    ["echo"],
  );
  assert.ok(presented.length > 0);
  assert.ok(presented.every((value) => value === "same-server-credential"));
});
