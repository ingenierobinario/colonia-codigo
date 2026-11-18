import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const fuente = process.env.COLONIA_RAILWAY_SOURCE ?? fileURLToPath(new URL(".", import.meta.url));
const manifest = readFileSync(join(fuente, "estable.txt"), "utf8");
const source = readFileSync(join(fuente, "obtener.sh"), "utf8");
const version = manifest.split(/\r?\n/)[0];
const image = process.env.COLONIA_RAILWAY_IMAGE ?? `colonia-railway-prueba:${version}`;
const execute = promisify(execFile);
const node = "/opt/colonia/node/bin/node";

// Este cliente se ejecuta en un segundo contenedor. Todas sus peticiones llegan al servidor por su red privada.
async function client() {
  const operation = process.argv[1];
  const base = "http://servidor:17440";
  const origin = "https://colonia.example.test";
  const rpc = async (method, body, authorization, from = origin) => {
    const res = await fetch(`${base}/rpc/${method}`, {
      method: "POST",
      signal: AbortSignal.timeout(8000),
      headers: {
        "content-type": "application/json",
        "idempotency-key": crypto.randomUUID(),
        origin: from,
        "x-forwarded-for": "192.0.2.10",
        "x-forwarded-proto": "https",
        ...(authorization ? { authorization: `Bearer ${authorization}` } : {}),
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return { status: res.status, ok: data.ok, code: data.error?.code, result: data.result };
  };
  let result;
  if (operation === "health") {
    const deadline = Date.now() + 60000;
    while (true) {
      try {
        const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(5000) });
        if (res.ok) {
          const envelope = await res.json();
          if (envelope.ok && envelope.result) {
            result = envelope.result;
            break;
          }
        }
      } catch {}
      if (Date.now() >= deadline) throw Error("El servidor no respondió a /health.");
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  } else if (operation === "authorization") {
    const none = await rpc("projects.list", {}, undefined);
    const foreign = await rpc("projects.list", {}, process.env.COLONIA_TOKEN, "https://colonia.example.test.otro.test");
    const invalid = await rpc("projects.list", {}, "valor-de-prueba-incorrecto");
    const local = await rpc("access.get", {}, process.env.COLONIA_TOKEN);
    result = {
      none: { status: none.status, code: none.code },
      invalid: { status: invalid.status, code: invalid.code },
      foreign: { status: foreign.status, code: foreign.code },
      local: local.status,
      urls: local.result?.urls,
    };
  } else if (operation === "create") {
    const made = await rpc("projects.create", { name: "Proyecto persistente de prueba" }, process.env.COLONIA_TOKEN);
    result = { status: made.status, id: made.result?.project?.id };
  } else if (operation === "projects") {
    const list = await rpc("projects.list", {}, process.env.COLONIA_TOKEN);
    result = list.result?.projects?.map((p) => ({ id: p.id, name: p.name }));
  }
  console.log(JSON.stringify(result));
}

test("servidor de plantilla de Railway con el bundle público, volumen y acceso autenticado", async (t) => {
  const suffix = randomUUID();
  const name = `colonia-prueba-${suffix}`;
  const volume = `${name}-datos`;
  const network = `${name}-red`;
  const vars = {
    ...process.env,
    RAILWAY_SERVICE_ID: "railway-prueba",
    RAILWAY_VOLUME_MOUNT_PATH: "/data",
    RAILWAY_PUBLIC_DOMAIN: "colonia.example.test",
    PORT: "17440",
    COLONIA_TOKEN: randomBytes(32).toString("hex"),
  };
  const envFlags = [
    "RAILWAY_SERVICE_ID",
    "RAILWAY_VOLUME_MOUNT_PATH",
    "RAILWAY_PUBLIC_DOMAIN",
    "PORT",
    "COLONIA_TOKEN",
  ].flatMap((k) => ["--env", k]);
  const label = `colonia.prueba.railway=${suffix}`;
  const docker = async (args, env = vars) => {
    const command = args[0] === "run" ? ["run", "--pull=never", "--label", label, ...args.slice(1)] : args;
    const result = await execute("docker", command, { env, windowsHide: true, timeout: 300000, maxBuffer: 1_000_000 });
    return result.stdout.trim();
  };
  t.after(async () => {
    // Una operación agotada en el cliente de Docker puede haberse aceptado en el motor.
    const ids = await docker(["ps", "-aq", "--filter", `label=${label}`]);
    if (ids) await docker(["rm", "-fv", ...ids.split(/\s+/)]);
    if (await docker(["volume", "ls", "-q", "--filter", `label=${label}`])) await docker(["volume", "rm", volume]);
    if (await docker(["network", "ls", "-q", "--filter", `label=${label}`])) await docker(["network", "rm", network]);
  });
  const mount = `type=volume,source=${volume},target=/data,volume-nocopy`;
  const start = async () => {
    await docker([
      "run",
      "-d",
      "--name",
      name,
      "--network",
      network,
      "--network-alias",
      "servidor",
      "--user",
      "0",
      "--mount",
      mount,
      ...envFlags,
      image,
    ]);
  };
  await docker(["network", "create", "--internal", "--label", label, network]);
  await docker(["volume", "create", "--label", label, volume]);
  const observer = `${name}-cliente`;
  await docker([
    "run",
    "-d",
    "--name",
    observer,
    "--network",
    network,
    "--no-healthcheck",
    "--mount",
    "type=tmpfs,destination=/data",
    ...envFlags,
    "--entrypoint",
    node,
    image,
    "-e",
    "setInterval(() => {}, 60000)",
  ]);
  const probe = async (operation) =>
    JSON.parse(
      await docker(["exec", observer, node, "--input-type=module", "-e", `await (${client.toString()})()`, operation]),
    );
  await t.test("rechaza un bundle alterado antes de extraerlo", async () => {
    const fake = [
      "set -eu",
      "mkdir -p /tmp/prueba",
      "cd /tmp/prueba",
      'printf %s "$1" > obtener.sh',
      'printf %s "$2" > estable.txt',
      `printf '%s\\n' '#!/bin/sh' 'printf alterado > /tmp/prueba/descarga' > curl`,
      "chmod +x curl",
      "PATH=/tmp/prueba:$PATH sh obtener.sh estable.txt /tmp/prueba/descarga",
    ].join("\n");
    await assert.rejects(
      docker(["exec", observer, "sh", "-c", fake, "sh", source, manifest]),
      (err) => err.code === 1 && /SHA-256/.test(err.stderr),
    );
  });
  await t.test("verifica el archivo local contra el pin, incluso sin acceso a la descarga", async () => {
    const script = [
      "set -eu",
      'cd "$(mktemp -d)"',
      'printf %s "$1" > obtener.sh',
      "printf original > candidato.tar.gz",
      "hash=$(sha256sum candidato.tar.gz | cut -d' ' -f1)",
      'printf "2.0.0\\nx64 %s\\narm64 %s\\n" "$hash" "$hash" > pin',
      "printf '#!/bin/sh\\nexit 92\\n' > curl",
      "chmod +x curl",
      'export PATH="$PWD:$PATH"',
      "sh obtener.sh pin verificado.tar.gz candidato.tar.gz",
      "cmp candidato.tar.gz verificado.tar.gz",
      "printf alterado > candidato.tar.gz",
      "if sh obtener.sh pin verificado.tar.gz candidato.tar.gz 2>motivo; then exit 1; fi",
      "grep -q SHA-256 motivo",
    ].join("\n");
    await docker(["exec", observer, "sh", "-c", script, "sh", source]);
  });
  await t.test("exige un secreto, un dominio válido y el volumen de la plantilla", async () => {
    for (const [change, expected] of [
      [{ COLONIA_TOKEN: "" }, /COLONIA_TOKEN/],
      [{ RAILWAY_PUBLIC_DOMAIN: "colonia.example.test/ruta" }, /dominio HTTP/],
      [{ RAILWAY_VOLUME_MOUNT_PATH: "/otro" }, /volumen permanente/],
    ]) {
      await assert.rejects(
        docker(["exec", "--user", "0", ...envFlags, observer, "/usr/local/bin/colonia-iniciar"], {
          ...vars,
          ...change,
        }),
        (err) => err.code === 1 && expected.test(err.stderr),
      );
    }
  });
  await t.test("usa un volumen vacío que inicialmente pertenece a root", async () => {
    // Es la misma imagen y el mismo volumen que usará el motor. El cliente remoto tiene otro /data.
    const state = await docker([
      "run",
      "--rm",
      "--no-healthcheck",
      "--network",
      "none",
      "--user",
      "0",
      "--mount",
      mount,
      ...envFlags,
      "--entrypoint",
      node,
      image,
      "-e",
      [
        'const fs = require("node:fs"), cp = require("node:child_process");',
        'const native = cp.spawnSync("setpriv", ["--reuid=colonia", "--regid=colonia", "--clear-groups", "/usr/local/bin/colonia-iniciar"], {encoding:"utf8"});',
        'console.log(JSON.stringify({owner:fs.statSync("/data").uid,files:fs.readdirSync("/data"),status:native.status,reason:native.stderr}));',
      ].join("\n"),
    ]);
    const data = JSON.parse(state);
    assert.deepEqual([data.owner, data.files, data.status], [0, [], 1]);
    assert.match(data.reason, /RAILWAY_RUN_UID=0/);
  });
  await start();
  let identity, project;
  await t.test("responde en PORT con el identificador de la instalación y la versión oficial", async () => {
    const health = await probe("health");
    assert.equal(health.version, version);
    assert.ok(health.home_id);
    identity = health.home_id;
  });
  await t.test("el proceso inicial y el motor son no privilegiados y pueden escribir en /data", async () => {
    const check =
      'const fs=require("node:fs");const uid=pid=>fs.readFileSync("/proc/"+pid+"/status","utf8").match(/^Uid:\\s+(.*)/m)[1].trim().split(/\\s+/).map(Number);const child=fs.readFileSync("/proc/1/task/1/children","utf8").trim().split(/\\s+/).find(p=>fs.readFileSync("/proc/"+p+"/cmdline","utf8").includes("apps/core/src/main.ts"));console.log(JSON.stringify([uid(1),uid(child),fs.statSync("/data/colonia").uid,fs.existsSync("/data/colonia.startup/daemon-lock.sqlite")]))';
    const state = await docker(["exec", "--user", "1000", name, node, "-e", check]);
    assert.deepEqual(JSON.parse(state), [[1000, 1000, 1000, 1000], [1000, 1000, 1000, 1000], 1000, true]);
  });
  await t.test(
    "el origen HTTPS exacto y el token dan acceso y el anónimo, el token erróneo y otro origen reciben 403",
    async () => {
      const result = await probe("authorization");
      for (const key of ["none", "invalid", "foreign"])
        assert.deepEqual(result[key], { status: 403, code: "unauthorized" });
      assert.equal(result.local, 200);
      assert.ok(result.urls.includes("https://colonia.example.test"));
    },
  );
  await t.test("otro contenedor conserva home_id y el proyecto guardado en el mismo volumen", async () => {
    const made = await probe("create");
    assert.equal(made.status, 200);
    assert.ok(made.id);
    project = made.id;
    await docker(["stop", name]);
    await docker(["rm", name]);
    await start();
    const health = await probe("health");
    assert.equal(health.home_id, identity);
    assert.ok((await probe("projects")).some((p) => p.id === project && p.name === "Proyecto persistente de prueba"));
  });
});
