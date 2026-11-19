import assert from "node:assert/strict";
import test from "node:test";
import { browserLoginMcp, browserLoginUrl } from "./browserLoginMcp.ts";

test("conserva la URL de lectura al guardar y volver a editar un conector con inicio de sesión", () => {
  const url = "https://meta-ads.mcp.pipeboard.co/?read_only=true";
  const draft = browserLoginMcp(url);
  assert.deepEqual(draft.args, ["-y", "mcp-remote", url]);
  assert.equal(browserLoginUrl({ ...draft, headers: {} }), url);
});

test("mantiene el editor avanzado para servidores con parámetros o variables personalizados", () => {
  const def = { ...browserLoginMcp("https://example.org/mcp"), headers: {} };
  assert.equal(browserLoginUrl({ ...def, args: [...def.args, "--header", "X-Test: test"] }), undefined);
  assert.equal(browserLoginUrl({ ...def, env: { CUSTOM: "value" } }), undefined);
});
