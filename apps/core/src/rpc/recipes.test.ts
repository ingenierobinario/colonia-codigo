// RECETA-1 · Ida y vuelta: lo que el agente hizo en un Colonia se exporta como .md, otra persona lo importa en el suyo
// eligiendo SU modo, y su agente recibe los mismos pasos (por elemento y comprobación, sin coordenadas).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { z } from "zod";
import { ASK_INPUT, NO_TARGET, parseRecipe, recipeOf, renderRecipe } from "../domain/recipe.ts";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { threadMode } from "../tools/screen-mode.ts";
import { defineTool, type Tool } from "../tools/types.ts";

const fake = (name: string): Tool =>
  defineTool({
    name,
    description: name,
    args: z.looseObject({}),
    effect: "none",
    deadlineMs: 5_000,
    title: () => name,
    async run() {
      return "ok";
    },
  });

/** Lo que hizo el agente de quien exporta: abrir, mirar, y dos tandas de pasos en una app. */
const DONE: Array<[string, Record<string, unknown>]> = [
  ["screen_open", { url: "https://facturas.example.com/nueva?sesion=abc123", app: "Google Chrome" }],
  ["screen_snapshot", { app: "Google Chrome" }],
  [
    "screen_do",
    {
      app: "Google Chrome",
      note: "Rellenar la factura",
      steps: [
        { do: "click", px: 412, py: 233, target: "campo «Cliente»", expect: "el cursor queda en el campo" },
        { do: "type", text: "Acme   S.L.", expect: "se lee Acme S.L. en el campo" },
        { do: "key", keys: "tab" },
        { do: "type", text: "password: hunter2" },
        { do: "click", x: 900, y: 640 },
      ],
    },
  ],
  ["screen_do", { app: "Google Chrome", steps: [{ do: "click", px: 50, py: 60, target: "botón «Guardar»", expect: "aparece «Factura guardada»" }] }],
];

const script = () =>
  scriptedLlm((req, { said }) => {
    const done = req.messages.filter((m) => m.role === "tool").length;
    if (said.startsWith("haz la factura")) {
      const next = DONE[done];
      return next ? callTool(`c${done}`, next[0], next[1]) : say("Hecha.");
    }
    if (said.startsWith("sigue la receta"))
      return done ? say("Cargada.") : callTool("l1", "load_skill", { name: said.split(" ").at(-1) ?? "" });
    return say("ok");
  });

const tools = () => [fake("screen_open"), fake("screen_snapshot"), fake("screen_do")];

test("exportar → importar → los mismos pasos, sin coordenadas, y el modo lo elige quien importa", async () => {
  const a = await startCore({ llm: script(), extraTools: tools() });
  const b = await startCore({ llm: script(), extraTools: tools() });
  try {
    // Quien exporta trabajó en segundo plano.
    a.core.store.settings.write("desktop", { ...a.core.store.settings.read("desktop"), computer_mode: "background" });
    const chat = await a.client.call("threads.create", { kind: "loose", agent_id: "superagent" });
    await a.client.call("threads.send", { thread: chat.id, text: "haz la factura de Acme" });
    await a.settle(chat.id);

    const out = await a.client.call("skills.recipe_export", { thread: chat.id, name: "factura-acme" });
    const made = recipeOf(a.core.store, chat.id, { mode: "background", name: "factura-acme" });
    assert.ok(made);
    assert.equal(out.mode, "background", "lleva el modo con que se hizo");
    assert.equal(out.steps, 7);
    assert.equal(out.unnamed, 1, "un clic sin elemento anotado se cuenta");
    assert.deepEqual(made.steps, [
      { do: "open", app: "Google Chrome", target: "facturas.example.com/nueva" },
      {
        do: "click",
        app: "Google Chrome",
        goal: "Rellenar la factura",
        target: "campo «Cliente»",
        check: "el cursor queda en el campo",
      },
      {
        do: "type",
        app: "Google Chrome",
        goal: "Rellenar la factura",
        input: "Acme S.L.",
        check: "se lee Acme S.L. en el campo",
      },
      { do: "key", app: "Google Chrome", goal: "Rellenar la factura", input: "tab" },
      { do: "type", app: "Google Chrome", goal: "Rellenar la factura", input: ASK_INPUT },
      { do: "click", app: "Google Chrome", goal: "Rellenar la factura", target: NO_TARGET },
      { do: "click", app: "Google Chrome", target: "botón «Guardar»", check: "aparece «Factura guardada»" },
    ]);
    // Nada que no sea portable o que sea secreto viaja en el fichero.
    for (const no of ["412", "233", "900", "640", "hunter2", "abc123", "sesion"])
      assert.ok(!out.content.includes(no), `sin ${no} en la receta`);
    assert.match(out.content, /^---\nname: factura-acme\n/);
    assert.match(out.content, /\nrecipe: colonia-1\nmode: background\n---\n/);
    assert.match(out.content, /# haz la factura de Acme/);

    // Otra persona, otro Colonia. Primero mira qué trae (sin modo no se guarda nada).
    const seen = await b.client.call("skills.recipe_import", { content: out.content, target: "global" });
    assert.deepEqual(
      { saved: seen.saved, preferred: seen.preferred, steps: seen.steps, name: seen.name },
      { saved: false, preferred: "background", steps: 7, name: "factura-acme" },
    );
    assert.ok(!(await b.client.call("skills.list", {})).skills.some((s) => s.name === "factura-acme"));
    // Y elige SU modo: en vivo, aunque el fichero prefiera segundo plano.
    const got = await b.client.call("skills.recipe_import", { content: out.content, target: "global", mode: "live" });
    assert.equal(got.saved, true);
    assert.equal(got.skill?.name, "factura-acme");
    const file = fs.readFileSync(path.join(b.home, "skills", "factura-acme", "SKILL.md"), "utf8");
    assert.deepEqual(parseRecipe(file)?.steps, made.steps, "los mismos pasos al otro lado");
    assert.equal(parseRecipe(file)?.goal, made.goal);

    // Su agente la carga: recibe los pasos, y el chat queda en el modo que eligió esta persona (su ajuste es «preguntar»).
    assert.equal(b.core.store.settings.read("desktop").computer_mode, "ask");
    const chatB = await b.client.call("threads.create", { kind: "loose", agent_id: "superagent" });
    assert.equal(threadMode(b.core.store, chatB.id), undefined);
    await b.client.call("threads.send", { thread: chatB.id, text: "sigue la receta factura-acme" });
    await b.settle(chatB.id);
    const run = b.core.store.runs.list(chatB.id, 1)[0];
    const loaded = b.core.store.runs.steps(run?.id ?? "").find((s) => s.tool === "load_skill");
    assert.equal(loaded?.state, "ok");
    assert.match(loaded?.result ?? "", /target: botón «Guardar»/);
    assert.match(loaded?.result ?? "", /the owner chose to run it live/);
    assert.equal(threadMode(b.core.store, chatB.id), "live");

    // Importarla otra vez no pisa la que hay salvo que se pida; y con otro modo, cambia el modo.
    await assert.rejects(
      b.client.call("skills.recipe_import", { content: out.content, target: "global", mode: "background" }),
      /already a skill named factura-acme/,
    );
    await b.client.call("skills.recipe_import", {
      content: out.content,
      target: "global",
      mode: "background",
      replace: true,
    });
    assert.equal(b.core.store.settings.read("recipe_modes")["factura-acme"], "background");
  } finally {
    await a.core.close();
    await a.cleanup();
    await b.core.close();
    await b.cleanup();
  }
});

test("lo que no es una receta no se importa, y un chat que no hizo nada no se exporta", async () => {
  const env = await startCore({ llm: script() });
  try {
    await assert.rejects(
      env.client.call("skills.recipe_import", {
        content: "---\nname: otra\ndescription: Una skill normal.\n---\n\nHaz esto.\n",
        target: "global",
        mode: "live",
      }),
      /not a Colonia recipe/,
    );
    const chat = await env.client.call("threads.create", { kind: "loose", agent_id: "superagent" });
    await assert.rejects(env.client.call("skills.recipe_export", { thread: chat.id }), /nothing to export/);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("el .md escrito y leído da la misma receta, también editado a mano con líneas de más", () => {
  const r = {
    name: "abrir-informe",
    description: "Recipe: abrir el informe",
    goal: "abrir el informe",
    mode: "live" as const,
    steps: [
      { do: "open", app: "Excel", target: "informes/ventas.xlsx" },
      { do: "click", app: "Excel", target: "pestaña «Resumen»", check: "se ve la tabla Resumen" },
      { do: "shell", target: "python informe.py" },
    ],
  };
  const md = renderRecipe(r);
  assert.deepEqual(parseRecipe(md), r);
  const edited = md.replace("## Steps\n", "## Steps\n\nNota mía: hazlo despacio.\n").replace(/\n/g, "\r\n");
  assert.deepEqual(parseRecipe(edited)?.steps, r.steps);
  assert.equal(parseRecipe(md.replace("recipe: colonia-1", "recipe: otra-cosa")), undefined);
});
