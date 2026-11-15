import assert from "node:assert/strict";
import { test } from "node:test";
import { en } from "../i18n/en.ts";
import { channelProblem, problemKey } from "./problems.ts";

test("no error is no problem", () => {
  assert.equal(channelProblem(undefined), undefined);
  assert.equal(channelProblem(null), undefined);
  assert.equal(channelProblem("  "), undefined);
});

test("a rejected key asks for the key again", () => {
  assert.equal(channelProblem("401: Unauthorized"), "badKey");
  assert.equal(channelProblem("An API error occurred: invalid_auth"), "badKey");
  assert.equal(channelProblem("Error [TokenInvalid]: An invalid token was provided."), "badKey");
});

test("a service that does not answer is a connection problem", () => {
  assert.equal(channelProblem("getaddrinfo ENOTFOUND api.telegram.org"), "offline");
  assert.equal(channelProblem("fetch failed"), "offline");
  assert.equal(channelProblem("request timed out"), "offline");
});

test("WhatsApp unlinked from the phone asks to link again", () => {
  assert.equal(channelProblem("Connection Failure: logged out"), "loggedOut");
  assert.equal(channelProblem("401 device_removed"), "loggedOut");
});

test("two programs on one bot is a conflict", () => {
  assert.equal(channelProblem("409: Conflict: terminated by other getUpdates request"), "conflict");
});

test("anything else still says what to try", () => {
  assert.equal(channelProblem("boom"), "other");
});

test("every problem has its message", () => {
  for (const p of ["badKey", "offline", "loggedOut", "conflict", "other"] as const)
    assert.ok(((en as Record<string, string>)[problemKey(p)] ?? "").length > 20, p);
});
