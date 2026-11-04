import assert from "node:assert/strict";
import { test } from "node:test";
import { coreEnvDefaults, parseCoreEnv, serializeCoreEnv } from "./core-env.ts";

test("parses KEY=VALUE lines, skipping comments and blanks and trimming quotes", () => {
  const vars = parseCoreEnv(
    '# header\n\nCOLONIA_HOST = 0.0.0.0\r\nCOLONIA_TOKEN="abc=def"\nnot a line\n=nokey\nCOLONIA_PUBLIC_URL=https://colonia.example.ts.net\n',
  );
  assert.deepEqual(vars, {
    COLONIA_HOST: "0.0.0.0",
    COLONIA_TOKEN: "abc=def",
    COLONIA_PUBLIC_URL: "https://colonia.example.ts.net",
  });
});

test("serializes in a stable order with a header and a trailing newline, and reads back the same", () => {
  const vars = { OTHER: "x", COLONIA_TOKEN: "t", COLONIA_HOST: "0.0.0.0" };
  const text = serializeCoreEnv(vars);
  assert.ok(text.startsWith("# "));
  assert.ok(text.endsWith("\n"));
  assert.deepEqual(text.split("\n").slice(1, -1), ["COLONIA_HOST=0.0.0.0", "COLONIA_TOKEN=t", "OTHER=x"]);
  assert.deepEqual(parseCoreEnv(text), vars);
  assert.equal(serializeCoreEnv({}).split("\n").length, 2);
});

test("only the known keys become core defaults, and empty values do not", () => {
  assert.deepEqual(coreEnvDefaults({ COLONIA_PORT: "7500", COLONIA_HOME: "/elsewhere", COLONIA_TOKEN: "" }), { COLONIA_PORT: "7500" });
});
