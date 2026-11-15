// CURSOR-FIABLE-1 · La pantalla de otro equipo: el clic va por un píxel de su última captura (la cuenta la hace el
// core), tras actuar se espera a que la pantalla deje de cambiar, y solo se maneja en vivo si la persona lo eligió.
import assert from "node:assert/strict";
import { test } from "node:test";
import { equipoTools } from "./equipos.ts";
import { SETTLE } from "./screen-mode.ts";
import type { Tool, ToolContext } from "./types.ts";

/** Un JPEG mínimo de 1920x1080 (solo la cabecera que lee imageInfo), distinto por `frame`. */
const jpeg = (frame: string) =>
  Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x04, 0x38, 0x07, 0x80, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    Buffer.from(frame),
  ]);

function rig(o: { mode: "ask" | "live" | "background"; frames?: string[]; answer?: string }) {
  const commands: string[] = [];
  const seen: string[] = [];
  const asked: string[][] = [];
  const frames = o.frames ?? ["a"];
  let n = 0;
  const computers = [
    { id: "c1", name: "portatil", platform: "linux", public_key: "", agent_access: true, created_at: "" },
    { id: "c2", name: "sobremesa", platform: "linux", public_key: "", agent_access: true, created_at: "" },
  ];
  const store = {
    team: { list: () => computers },
    settings: { get: () => "es", read: () => ({ computer_mode: o.mode }) },
  } as never;
  let saved = 0;
  const tools = equipoTools(store, (a) => ({ id: `m-${a.bytes.subarray(20).toString()}-${++saved}` }));
  const ctx = {
    thread: { id: "t1" },
    run: { id: "r1" },
    see: (i: { media_id: string }) => seen.push(i.media_id),
    askOwner: async (_q: string, options: string[] = []) => {
      asked.push(options);
      return o.answer
        ? { state: "answered", answer: options.find((x) => x.startsWith(o.answer as string)) }
        : { state: "pending" };
    },
    call: async (method: string, p: { command?: string; timeout_s?: number }) => {
      if (method === "equipos.read_file") {
        const f = frames[Math.min(n++, frames.length - 1)] as string;
        return { content_base64: jpeg(f).toString("base64"), truncated: false, size: 30 };
      }
      if (method !== "equipos.run") return {};
      const command = p.command ?? "";
      if (p.timeout_s === 30) return { output: "" };
      commands.push(command);
      // Pantalla 4K: la imagen llega a 1920x1080, cada píxel son 2 puntos.
      return command.includes("COLONIA_GUI DONE")
        ? { output: "COLONIA_GUI DONE n=1" }
        : { output: "COLONIA_GUI SHOT x=0 y=0 sw=3840 sh=2160 file=colonia-gui-abc123.jpg" };
    },
  } as unknown as ToolContext;
  const tool = (name: string) => tools.find((t) => t.name === name) as Tool;
  const run = async (name: string, raw: Record<string, unknown>) => {
    const p = tool(name).parse(raw);
    if (!p.ok) return `rejected: ${p.error}`;
    try {
      await tool(name).check?.(p.args, ctx);
    } catch (e) {
      return `rejected: ${(e as Error).message}`;
    }
    return tool(name).run(p.args, ctx);
  };
  return { run, commands, seen, asked, did: () => commands.filter((c) => c.includes("COLONIA_GUI DONE")) };
}

const quick = () => {
  const before = { ...SETTLE };
  SETTLE.pauseMs = 5;
  return () => Object.assign(SETTLE, before);
};

test("en otro equipo el clic por píxel de su captura cae en su punto de pantalla", async () => {
  const restore = quick();
  try {
    const r = rig({ mode: "live" });
    const shot = await r.run("equipo_screenshot", { equipo: "portatil" });
    assert.doesNotMatch(shot, /px\*/, "ya no se le da una fórmula al modelo");
    await r.run("equipo_do", { equipo: "portatil", steps: [{ do: "click", px: 960, py: 540 }], look: false });
    // El píxel (960,540) de 1920x1080 es el centro de una pantalla de 3840x2160.
    assert.match(r.did()[0] ?? "", /xdotool mousemove 1921 1081 click 1|xdotool mousemove 1920 1080 click 1/);
  } finally {
    restore();
  }
});

test("un píxel de la captura de OTRO equipo, o sin captura, no hace clic en ninguno", async () => {
  const restore = quick();
  try {
    const r = rig({ mode: "live" });
    const none = await r.run("equipo_do", { equipo: "portatil", steps: [{ do: "click", px: 5, py: 5 }], look: false });
    assert.match(none, /take a equipo_screenshot first/);
    await r.run("equipo_screenshot", { equipo: "portatil" });
    const other = await r.run("equipo_do", { equipo: "sobremesa", steps: [{ do: "click", px: 5, py: 5 }], look: false });
    assert.match(other, /nothing was done/);
    assert.equal(r.did().length, 0);
  } finally {
    restore();
  }
});

test("tras actuar en otro equipo se mira hasta que su pantalla deja de cambiar, tres veces como mucho", async () => {
  const restore = quick();
  try {
    const r = rig({ mode: "live", frames: ["cargando", "lista", "lista"] });
    const out = await r.run("equipo_do", { equipo: "portatil", steps: [{ do: "key", keys: "enter" }] });
    assert.equal(r.seen.length, 1, "al modelo le llega una sola imagen");
    assert.match(r.seen[0] ?? "", /^m-lista-/);
    assert.doesNotMatch(out, /still changing/);
    const moving = rig({ mode: "live", frames: ["1", "2", "3", "4", "5", "6"] });
    const out2 = await moving.run("equipo_do", { equipo: "portatil", steps: [{ do: "key", keys: "enter" }] });
    assert.match(out2, /still changing/);
    assert.equal(moving.commands.length, 1 + 3, "una orden y tres miradas");
  } finally {
    restore();
  }
});

test("en segundo plano la pantalla de otro equipo no se toca, y sin elección se pregunta a la persona", async () => {
  const restore = quick();
  try {
    const bg = rig({ mode: "background" });
    const out = await bg.run("equipo_do", { equipo: "portatil", steps: [{ do: "click", x: 5, y: 5 }] });
    assert.match(out, /can only be driven live/);
    assert.equal(bg.commands.length, 0);
    const ask = rig({ mode: "ask" });
    const waiting = await ask.run("equipo_do", { equipo: "portatil", steps: [{ do: "click", x: 5, y: 5 }] });
    assert.match(waiting, /owner has to choose/);
    assert.equal(ask.commands.length, 0);
    assert.equal(ask.asked[0]?.length, 2);
    const yes = rig({ mode: "ask", answer: "En vivo" });
    await yes.run("equipo_do", { equipo: "portatil", steps: [{ do: "click", x: 5, y: 5 }], look: false });
    assert.equal(yes.did().length, 1);
  } finally {
    restore();
  }
});
