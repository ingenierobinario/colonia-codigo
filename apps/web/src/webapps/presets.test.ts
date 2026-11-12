import assert from "node:assert/strict";
import { test } from "node:test";
import { presetOf, unreadFromTitle, WEBAPP_PRESETS } from "./presets.ts";

test("el contador sale del título de Gmail, Outlook y Slack", () => {
  assert.equal(unreadFromTitle("Recibidos (3) - ana@gmail.com - Gmail"), 3);
  assert.equal(unreadFromTitle("Inbox (12) - ana@gmail.com - Gmail"), 12);
  assert.equal(unreadFromTitle("(5) Correo - Ana - Outlook"), 5);
  assert.equal(unreadFromTitle("general - Equipo - 2 new items - Slack"), 2);
  assert.equal(unreadFromTitle("general - Equipo - 4 elementos nuevos - Slack"), 4);
  assert.equal(unreadFromTitle("(3) Chat | Microsoft Teams"), 3);
  assert.equal(unreadFromTitle("Chat | Microsoft Teams"), 0);
});

test("sin cifra, vacío o borradores son 0", () => {
  assert.equal(unreadFromTitle("Recibidos - ana@gmail.com - Gmail"), 0);
  assert.equal(unreadFromTitle(""), 0);
  assert.equal(unreadFromTitle("Borradores (2) - ana@gmail.com - Gmail"), 0);
});

test("reconoce la ficha por el dominio", () => {
  assert.equal(presetOf({ url: "https://mail.google.com/mail/u/1/" })?.key, "gmail");
  assert.equal(presetOf({ url: "https://ejemplo.com" }), undefined);
  assert.equal(presetOf({ url: "https://teams.microsoft.com/v2/" })?.key, "teams");
  assert.equal(WEBAPP_PRESETS.length, 4);
});
