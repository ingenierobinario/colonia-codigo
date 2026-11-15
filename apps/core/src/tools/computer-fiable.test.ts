// CURSOR-FIABLE-1 · El agente fallaba «a veces» al manejar la pantalla. Dos causas, reproducidas aquí:
//  1. el clic sobre algo que solo se ve en la imagen lo calculaba el modelo con una fórmula (escala y desplazamiento);
//  2. tras actuar se esperaba un tiempo fijo y se miraba una sola vez: con una app lenta veía la pantalla a medias.
// Y los dos modos, que elige siempre la persona: en vivo o en segundo plano.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Store } from "../domain/store.ts";
import { computerTools } from "./computer.ts";
import { SETTLE } from "./screen-mode.ts";
import type { Tool, ToolContext } from "./types.ts";

type Call = { method: string; params: Record<string, unknown> };

/** Un ordenador de pega: cada mirada devuelve la siguiente pantalla de `frames` (la última se repite). */
function rig(o: { mode?: "ask" | "live" | "background"; frames?: string[]; answer?: string | undefined; fail?: number }) {
  const calls: Call[] = [];
  const seen: string[] = [];
  const asked: { prompt: string; options: string[] }[] = [];
  const frames = o.frames ?? ["a"];
  let n = 0;
  let fail = o.fail ?? 0;
  const store = {
    settings: {
      get: () => "es",
      read: () => ({ computer_mode: o.mode ?? "background" }),
    },
  } as unknown as Store;
  const ctx = {
    thread: { id: "t1" },
    run: { id: `r${Math.random()}` },
    see: (i: { media_id: string }) => seen.push(i.media_id),
    askOwner: async (prompt: string, options: string[] = []) => {
      asked.push({ prompt, options });
      return o.answer === undefined
        ? { state: "pending" }
        : { state: "answered", answer: options.find((x) => x.startsWith(o.answer as string)) };
    },
    call: async (method: string, params: Record<string, unknown>) => {
      calls.push({ method, params });
      if (method === "computer.snapshot") {
        if (fail-- > 0) throw new Error("the desktop did not answer in time");
        const f = frames[Math.min(n++, frames.length - 1)] as string;
        return {
          media: { id: `m-${f}-${n}`, mime: "image/jpeg" },
          app: "Notas",
          window: "Sin título",
          elements: "role\tname",
          digest: f,
          // Pantalla 2560x1440 capturada a 1600x900: cada píxel son 1,6 puntos.
          map: { x: 0, y: 0, width: 2560, height: 1440, px_width: 1600, px_height: 900 },
        };
      }
      if (method === "computer.click") return { app: "Notas", how: "pressed" };
      return { app: "Notas" };
    },
  } as unknown as ToolContext;
  const tools = computerTools(store);
  const tool = (name: string) => tools.find((t) => t.name === name) as Tool;
  /** Como el motor: los argumentos pasan por el esquema y por la comprobación previa antes de correr. */
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
  return { calls, seen, asked, run, clicks: () => calls.filter((c) => c.method === "computer.click") };
}

const quick = () => {
  const before = { ...SETTLE };
  SETTLE.pauseMs = 5;
  return () => Object.assign(SETTLE, before);
};

test("el clic sobre un píxel de la imagen cae en su punto de pantalla, sin que el modelo haga cuentas", async () => {
  const restore = quick();
  try {
    const r = rig({});
    await r.run("screen_snapshot", {});
    const out = await r.run("screen_do", { app: "Notas", steps: [{ do: "click", px: 800, py: 450 }] });
    assert.doesNotMatch(out, /rejected|failed/);
    const [click] = r.clicks();
    // El píxel (800,450) de 1600x900 es el centro de una pantalla de 2560x1440.
    assert.ok(Math.abs(Number(click?.params.x) - 1280) <= 1, `x = ${click?.params.x}`);
    assert.ok(Math.abs(Number(click?.params.y) - 720) <= 1, `y = ${click?.params.y}`);
  } finally {
    restore();
  }
});

test("sin captura previa, o con un píxel que no está en ella, no se hace clic en ningún sitio", async () => {
  const restore = quick();
  try {
    const none = rig({});
    const out = await none.run("screen_do", { app: "Notas", steps: [{ do: "click", px: 10, py: 10 }], look: false });
    assert.match(out, /take a screen_snapshot first/);
    assert.equal(none.clicks().length, 0);
    const off = rig({});
    await off.run("screen_snapshot", {});
    const out2 = await off.run("screen_do", { app: "Notas", steps: [{ do: "click", px: 1700, py: 10 }], look: false });
    assert.match(out2, /outside the picture/);
    assert.equal(off.clicks().length, 0);
  } finally {
    restore();
  }
});

test("tras actuar espera a que la pantalla deje de cambiar: el modelo ve la que se quedó quieta", async () => {
  const restore = quick();
  try {
    // La app tarda en repintar: tres pantallas distintas y luego ya no cambia.
    const r = rig({ frames: ["cargando-1", "cargando-2", "lista", "lista"] });
    const out = await r.run("screen_do", { app: "Notas", steps: [{ do: "key", keys: "enter" }] });
    assert.equal(r.seen.length, 1, "al modelo le llega una sola imagen");
    assert.match(r.seen[0] ?? "", /^m-lista-/, `vio ${r.seen[0]}`);
    assert.doesNotMatch(out, /still changing/);
  } finally {
    restore();
  }
});

test("si no llega a quedarse quieta, mira un número acotado de veces y lo dice", async () => {
  const restore = quick();
  try {
    const r = rig({ frames: ["1", "2", "3", "4", "5", "6", "7", "8"] });
    const out = await r.run("screen_do", { app: "Notas", steps: [{ do: "key", keys: "enter" }] });
    assert.equal(r.calls.filter((c) => c.method === "computer.snapshot").length, SETTLE.looks);
    assert.match(out, /still changing/);
  } finally {
    restore();
  }
});

test("una mirada que falla una vez se repite; un clic no se repite nunca", async () => {
  const restore = quick();
  try {
    const r = rig({ fail: 1 });
    const out = await r.run("screen_snapshot", {});
    assert.match(out, /Notas/);
    assert.equal(r.calls.filter((c) => c.method === "computer.snapshot").length, 2);
  } finally {
    restore();
  }
});

test("el modo lo fija el ajuste de la persona y viaja en cada clic", async () => {
  const restore = quick();
  try {
    for (const mode of ["live", "background"] as const) {
      const r = rig({ mode });
      await r.run("screen_do", { app: "Notas", steps: [{ do: "click", x: 5, y: 5 }], look: false });
      assert.equal(r.clicks()[0]?.params.mode, mode);
      assert.equal(r.asked.length, 0, "con el ajuste puesto no se pregunta");
    }
  } finally {
    restore();
  }
});

test("sin ajuste se pregunta a la persona; sin respuesta no se toca nada y el agente no elige", async () => {
  const restore = quick();
  try {
    const waiting = rig({ mode: "ask" });
    const out = await waiting.run("screen_do", { app: "Notas", steps: [{ do: "click", x: 5, y: 5 }], look: false });
    assert.match(out, /owner has to choose/);
    assert.equal(waiting.clicks().length, 0);
    assert.equal(waiting.asked[0]?.options.length, 2);
    // El esquema no admite que el modelo diga el modo.
    const sneaky = await waiting.run("screen_do", { app: "Notas", mode: "live", steps: [{ do: "click", x: 5, y: 5 }] });
    assert.equal(waiting.clicks().length, 0, sneaky);

    const answered = rig({ mode: "ask", answer: "En vivo" });
    await answered.run("screen_do", { app: "Notas", steps: [{ do: "click", x: 5, y: 5 }], look: false });
    await answered.run("screen_do", { app: "Notas", steps: [{ do: "click", x: 6, y: 6 }], look: false });
    assert.deepEqual(
      answered.clicks().map((c) => c.params.mode),
      ["live", "live"],
    );
    assert.equal(answered.asked.length, 1, "se pregunta una vez por chat");
  } finally {
    restore();
  }
});
