import assert from "node:assert/strict";
import { test } from "node:test";
import {
  loadingSteps,
  RETRY_MS,
  type Remote,
  reachRemote,
  SILENT_MS,
  SLOW_MS,
  type WaitDeps,
  type Waiting,
  waiting,
  waitingHtml,
  waitingText,
} from "./remote-wait.ts";

/** A fake world: the server answers from `upAt` (ms) on; sleeping moves the clock. */
function world(opts: { upAt?: number; loads?: boolean[]; current?: () => boolean } = {}) {
  let clock = 0;
  const shown: string[] = [];
  const loaded: string[] = [];
  const loads = [...(opts.loads ?? [])];
  const deps: WaitDeps = {
    current: opts.current ?? (() => true),
    isUp: async () => opts.upAt !== undefined && clock >= opts.upAt,
    load: async (url) => {
      loaded.push(url);
      return loads.shift() ?? true;
    },
    show: async (w) => {
      shown.push(waitingText(w));
    },
    sleep: async (ms) => {
      clock += ms;
    },
    now: () => clock,
    es: false,
  };
  return { deps, shown, loaded, time: () => clock };
}

function tunnel(alive: (t: number) => boolean, time: () => number, problem?: string) {
  let restarts = 0;
  return {
    alive: () => alive(time()),
    problem: () => problem,
    restart: () => {
      restarts++;
    },
    restarts: () => restarts,
  };
}

test("a server restarting after an update is waited for on screen, then its panel loads by itself", async () => {
  const w = world({ upAt: 45_000 });
  const ssh = tunnel((t) => t >= 5_000, w.time, "ssh: connect to host box port 22: Connection refused");
  const remote: Remote = { where: "ops@box (SSH)", url: "http://127.0.0.1:7440", tunnel: ssh };
  assert.equal(await reachRemote(remote, w.deps), true);
  assert.deepEqual(w.loaded, ["http://127.0.0.1:7440"]);
  // Once while ssh cannot log in (with what ssh said), once while the server's Colonia is still starting.
  assert.equal(w.shown.length, 2);
  assert.match(w.shown[0] ?? "", /ops@box \(SSH\).*Connection refused/);
  assert.match(w.shown[1] ?? "", /SSH connection is up/);
  assert.ok(w.time() >= 45_000);
});

test("a forward that stays up with nothing answering through it is started again", async () => {
  const w = world({ upAt: SILENT_MS * 2 + RETRY_MS });
  const ssh = tunnel(() => true, w.time);
  await reachRemote({ where: "ops@box (SSH)", url: "http://127.0.0.1:7440", tunnel: ssh }, w.deps);
  assert.equal(ssh.restarts(), 2);
});

test("a load that fails puts the waiting text back instead of leaving a blank window", async () => {
  const w = world({ upAt: 0, loads: [false, true] });
  assert.equal(await reachRemote({ where: "http://box:7440", url: "http://box:7440" }, w.deps), true);
  assert.equal(w.loaded.length, 2);
  assert.equal(w.shown.length, 1);
});

test("changing connection ends the wait without loading anything", async () => {
  let checks = 0;
  const w = world({ current: () => ++checks < 4 });
  assert.equal(await reachRemote({ where: "http://box:7440", url: "http://box:7440" }, w.deps), false);
  assert.deepEqual(w.loaded, []);
});

test("the waiting text says how to pick another Colonia, in the app's language", () => {
  const remote: Remote = { where: "ops@box (SSH)", url: "http://127.0.0.1:7440" };
  assert.match(waitingText(waiting(remote, true, false)), /Colonia menu › Change connection/);
  assert.match(waitingText(waiting(remote, true, true)), /menú Colonia › Cambiar conexión/);
});

test("the waiting page keeps ssh's words apart and escaped", () => {
  const ssh = { alive: () => false, problem: () => "ssh: <host> refused", restart: () => {} };
  const html = waitingHtml(
    waiting({ where: "ops@box (SSH)", url: "http://127.0.0.1:7440", tunnel: ssh }, false, true),
    true,
  );
  assert.match(html, /<dt>Registro<\/dt><dd>ssh: &lt;host&gt; refused<\/dd>/);
  assert.doesNotMatch(html, /<host>/);
});

// CARGA-PINGUINO-1: a loading screen, not a system message.
const visible = (html: string) =>
  html
    .replace(/<style>[\s\S]*?<\/style>/, "")
    .replace(/<script>[\s\S]*?<\/script>/, "")
    .replace(/<section class="help"[\s\S]*?<\/section>/, "");

test("la pantalla de carga no enseña dirección, puerto, registro ni jerga hasta que hace falta", () => {
  for (const es of [true, false]) {
    const local: Remote = { where: "127.0.0.1:7440", url: "http://127.0.0.1:7440", local: "C:/Users/x/logs/core.log" };
    const html = waitingHtml(waiting(local, true, es), es);
    const shown = visible(html);
    assert.doesNotMatch(shown, /127\.0\.0\.1|7440|core\.log|Detalle|Details|SSH|servidor|server/i);
    assert.match(shown, /<svg class="peng"/);
    assert.match(shown, es ? /Despertando a tus agentes…/ : /Waking up your agents…/);
    assert.match(shown, /class="bar"/);
    // Lo técnico sigue ahí, plegado bajo «Ver detalles», con la salida a otra conexión.
    assert.match(html, es ? /<summary>Ver detalles<\/summary>/ : /<summary>See details<\/summary>/);
    assert.match(html, /core\.log/);
    assert.match(html, /href="#colonia-change"/);
  }
});

test("los mensajes avanzan hasta «Casi listo», respetan el movimiento reducido y se pliegan al minuto", () => {
  assert.deepEqual(loadingSteps("local", true).at(-1), "Casi listo…");
  assert.deepEqual(loadingSteps("remote", false)[0], "Finding your Colonia…");
  const html = waitingHtml(waiting({ where: "x", url: "http://x" }, true, true), true);
  assert.match(html, /prefers-reduced-motion:reduce/);
  assert.match(html, /prefers-color-scheme:dark/);
  assert.equal(SLOW_MS, 60_000);
  assert.match(html, /"slowMs":60000/);
});

test("un problema real abre la ayuda amable al momento, y un redibujo conserva el avance", async () => {
  const ssh = { alive: () => false, problem: () => "refused", restart: () => {} };
  const w = waiting({ where: "ops@box (SSH)", url: "http://127.0.0.1:7440", tunnel: ssh }, false, true);
  assert.equal(w.trouble, true);
  assert.match(waitingHtml(w, true), /"trouble":true/);
  assert.match(waitingHtml(w, true), /Colonia no consigue arrancar/);
  assert.equal(waiting({ where: "x", url: "http://x", local: "log" }, true, true).trouble, false);
  const seen: Waiting[] = [];
  const wd = world({ upAt: 3 * RETRY_MS });
  const show = wd.deps.show;
  wd.deps.show = async (x) => {
    seen.push(x);
    return show(x);
  };
  await reachRemote({ where: "x", url: "http://127.0.0.1:7440" }, wd.deps);
  assert.equal(seen[0]?.since, 0);
});

test("the core on this computer waits with its own words and what to check", async () => {
  const w = world({ upAt: 3 * RETRY_MS });
  const local: Remote = { where: "127.0.0.1:7440", url: "http://127.0.0.1:7440", local: "See the log" };
  assert.equal(await reachRemote(local, w.deps), true);
  assert.equal(w.shown.length, 1);
  assert.match(w.shown[0] ?? "", /Connecting to Colonia on this computer/);
  assert.match(w.shown[0] ?? "", /See the log/);
  assert.deepEqual(w.loaded, ["http://127.0.0.1:7440"]);
});

test("a confirmed local identity mismatch is explained without loading it, and a later matching core recovers", async () => {
  const w = world();
  const mismatch = "This port belongs to another home.";
  let problem: string | undefined;
  w.deps.isUp = async () => {
    if (w.time() === 0) {
      problem = mismatch;
      return false;
    }
    problem = undefined;
    return true;
  };
  const local: Remote = {
    where: "127.0.0.1:7440",
    url: "http://127.0.0.1:7440",
    local: "See the log",
    identityProblem: () => problem,
  };
  const load = w.deps.load;
  w.deps.load = async (url) => {
    assert.ok(w.time() >= RETRY_MS);
    assert.equal(problem, undefined);
    return load(url);
  };
  assert.equal(await reachRemote(local, w.deps), true);
  assert.equal(w.shown.length, 1);
  assert.ok(w.shown[0]?.includes(mismatch));
  assert.doesNotMatch(w.shown[0] ?? "", /Connecting to Colonia on this computer/);
  assert.deepEqual(w.loaded, [local.url]);
  assert.match(waitingText(waiting(local, true, false)), /Connecting to Colonia on this computer/);
});

test("detecta un arranque local breve sin esperar el intervalo de red", async () => {
  const w = world({ upAt: 180 });
  await reachRemote({ where: "local", url: "http://127.0.0.1:7440", local: "log" }, w.deps);
  assert.ok(w.time() <= 300);
});
