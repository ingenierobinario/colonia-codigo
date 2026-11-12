import assert from "node:assert/strict";
import { test } from "node:test";
import { reconocerWebs } from "./presets.ts";

test("reconoce webs conocidas, una por web, y los marcadores mandan sobre las visitas", () => {
  const r = reconocerWebs(
    [
      { url: "https://mail.google.com/mail/u/1/#inbox" },
      { url: "chrome://settings" },
      { url: "https://x.example.org/" },
    ],
    [{ host: "mail.google.com" }, { host: "app.slack.com" }, { host: "www.notion.so" }],
  );
  assert.deepEqual(
    r.map((w) => [w.name, w.origen]),
    [
      ["Gmail", "marcador"],
      ["Slack", "visitada"],
      ["Notion", "visitada"],
    ],
  );
  assert.equal(r[0]?.url, "https://mail.google.com/mail/u/0/");
});

test("no reconoce dominios parecidos", () => {
  assert.deepEqual(
    reconocerWebs([{ url: "https://mail.google.com.evil.example/" }], [{ host: "slack.com.evil.io" }]),
    [],
  );
});
