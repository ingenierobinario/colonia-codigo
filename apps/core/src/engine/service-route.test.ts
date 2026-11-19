import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { defineTool, type ToolContext } from "../tools/types.ts";
import { preferServiceTools } from "./service-route.ts";

test("Gmail usa las herramientas autorizadas antes de abrir una pestaña y respeta la petición visual", async () => {
  let opens = 0;
  const tool = (name: string) =>
    defineTool({
      name,
      description: name,
      args: z.object({}),
      effect: "none",
      deadlineMs: 1000,
      title: () => name,
      run: async () => {
        opens++;
        return "abierta";
      },
    });
  const [open] = preferServiceTools(
    ["browser_open", "gmail_search", "mcp_search", "mcp_call"].map(tool),
    ["gmail"],
    () => [],
  );
  assert.ok(open);
  const ctx = {} as ToolContext;
  assert.match(
    await open.run({ url: "https://mail.google.com/mail/u/0/" }, ctx),
    /mcp_search server gmail.*gmail_search/,
  );
  assert.equal(opens, 0);
  assert.equal(await open.run({ url: "https://mail.google.com/", purpose: "visual" }, ctx), "abierta");
  assert.equal(await open.run({ url: "https://mail.google.com.example/" }, ctx), "abierta");
  assert.equal(opens, 2);
});
