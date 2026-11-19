import assert from "node:assert/strict";
import test from "node:test";
import { remoteAgent } from "./a2a.ts";

const url = "https://agent.example/.well-known/agent-card.json";
const card = (rpc = "https://agent.example/rpc") => ({
  name: "Contabilidad",
  skills: [{ id: "facturas", name: "Facturas", description: "Revisar facturas" }],
  supportedInterfaces: [{ protocolVersion: "1.0", protocolBinding: "JSONRPC", url: rpc }],
});

test("descubre una vez y delega, consulta y cancela sin abrir el navegador", async () => {
  let reads = 0;
  const methods: string[] = [];
  const agent = remoteAgent(url, "prueba", async (target, init) => {
    assert.equal(init?.redirect, "error");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer prueba");
    if (String(target) === url) {
      reads++;
      return Response.json(card());
    }
    assert.equal(String(target), "https://agent.example/rpc");
    const { id, method, params } = JSON.parse(String(init?.body));
    methods.push(method);
    if (method === "SendMessage") {
      assert.deepEqual(params.message.parts, [{ text: "Revisa esta factura" }]);
      assert.equal(params.configuration.returnImmediately, true);
    } else assert.equal(params.id, "t1");
    return Response.json({
      jsonrpc: "2.0",
      id,
      result: method === "SendMessage" ? { task: { id: "t1" } } : { id: "t1" },
    });
  });
  await Promise.all([agent.skills(), agent.skills()]);
  assert.deepEqual(await agent.send("Revisa esta factura"), { task: { id: "t1" } });
  await agent.task("t1");
  await agent.cancel("t1");
  assert.deepEqual(methods, ["SendMessage", "GetTask", "CancelTask"]);
  assert.equal(reads, 1);
});

test("rechaza destinos fuera del origen sin reenviar la credencial", async () => {
  let calls = 0;
  const agent = remoteAgent(url, "prueba", async () => {
    calls++;
    return Response.json(card("https://otro.example/rpc"));
  });
  await assert.rejects(agent.send("privado"));
  assert.equal(calls, 1);
  assert.throws(() => remoteAgent("http://agent.example"));
});

test("una denegación al enviar se comunica sin repetir la escritura", async () => {
  let sends = 0;
  const agent = remoteAgent(url, undefined, async (target) => {
    if (String(target) === url) return Response.json(card());
    sends++;
    return new Response(null, { status: 403 });
  });
  await assert.rejects(agent.send("texto"), /403/);
  assert.equal(sends, 1);
});
