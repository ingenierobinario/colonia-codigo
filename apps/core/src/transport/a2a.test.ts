import assert from "node:assert/strict";
import test from "node:test";
import {z} from "zod";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";

test("un cliente A2A delega una sola vez, recupera su resultado y queda aislado de otros clientes", async (t) => {
  const original = [process.env.COLONIA_A2A_URL, process.env.COLONIA_A2A_AGENT];
  process.env.COLONIA_A2A_URL = "https://colonia.example/a2a";
  process.env.COLONIA_A2A_AGENT = "superagent";
  t.after(() => {
    for (const [i, k] of ["COLONIA_A2A_URL", "COLONIA_A2A_AGENT"].entries()) {
      const v = original[i];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
  const llm = scriptedLlm(() => say("Factura revisada"));
  const env = await startCore({ llm });
  t.after(async () => {
    await env.core.close();
    await env.cleanup();
  });
  const owner = await env.client.call("clients.create", { name: "Equipo A", scopes: ["chat"] });
  const other = await env.client.call("clients.create", { name: "Equipo B", scopes: ["chat"] });
  const base = env.core.url;
  const card = await fetch(base + "/.well-known/agent-card.json", {
    headers: { Authorization: "Bearer " + owner.token },
  });
  assert.equal(card.status, 200);
  assert.equal(z.object({supportedInterfaces:z.array(z.object({url:z.string()}))}).parse(await card.json()).supportedInterfaces.at(0)?.url, "https://colonia.example/a2a");
  const rpc = async (token: string, method: string, params: object) =>
    fetch(base + "/a2a", {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({ jsonrpc: "2.0", id: "r", method, params }),
    });
  const params = {
    message: { role: "ROLE_USER", messageId: "factura-1", parts: [{ text: "Revisa la factura" }] },
    configuration: { returnImmediately: true },
  };
  const sent = z.object({result:z.object({task:z.object({id:z.string(),contextId:z.string()})})});
  const error = z.object({error:z.object({code:z.number()})});
  const first=sent.parse(await (await rpc(owner.token,"SendMessage",params)).json());
  const {id,contextId}=first.result.task;
  const replay=sent.parse(await (await rpc(owner.token,"SendMessage",params)).json());
  assert.equal(replay.result.task.id,id);
  await env.settle(contextId);
  const answer=z.object({result:z.object({status:z.object({state:z.string()}),artifacts:z.array(z.object({parts:z.array(z.object({text:z.string()}))}))})});
  const result=answer.parse(await (await rpc(owner.token,"GetTask",{id})).json()).result;
  assert.equal(result.status.state,"TASK_STATE_COMPLETED");
  assert.equal(result.artifacts.at(0)?.parts.at(0)?.text,"Factura revisada");
  assert.equal(error.parse(await (await rpc(other.token,"GetTask",{id})).json()).error.code,-32001);
  assert.equal(llm.calls.length,1);
  assert.equal(error.parse(await (await rpc(other.token,"CancelTask",{id})).json()).error.code,-32001);
  assert.equal(error.parse(await (await rpc(owner.token,"CancelTask",{id})).json()).error.code,-32002);
  assert.equal((await rpc("sin-acceso","GetTask",{id})).status,401);
  await env.client.call("clients.revoke", { id: owner.client.id });
  assert.equal((await rpc(owner.token, "GetTask", { id })).status, 401);
});
