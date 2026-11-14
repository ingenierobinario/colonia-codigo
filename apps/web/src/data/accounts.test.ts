import assert from "node:assert/strict";
import { test } from "node:test";
import { accountLabel, accountsOf, newAccountId, pickAccount } from "./accounts.ts";

const channels = [
  { id: "telegram", type: "telegram", label: "Telegram", account: "@sales_bot" },
  { id: "slack", type: "slack", label: "Slack" },
  { id: "telegram-0123456789abcdef", type: "telegram", label: "Support", account: "@support_bot" },
];

test("two accounts of one channel are both listed, and each is reached by its own id", () => {
  const accounts = accountsOf(channels, "telegram");
  assert.deepEqual(
    accounts.map((c) => c.id),
    ["telegram", "telegram-0123456789abcdef"],
  );
  assert.equal(pickAccount(accounts, "telegram-0123456789abcdef")?.account, "@support_bot");
  assert.equal(pickAccount(accounts, "telegram")?.account, "@sales_bot");
  // Nothing chosen yet, or the chosen one was removed: the first, never one of another kind.
  assert.equal(pickAccount(accounts, "")?.id, "telegram");
  assert.equal(pickAccount(accounts, "slack")?.id, "telegram");
  assert.equal(pickAccount(accountsOf(channels, "discord"), "telegram"), undefined);
});

test("a second account never takes the id of the first", () => {
  assert.equal(newAccountId("telegram", []), "telegram");
  const tails = ["0123456789abcdef-0000", "fedcba98-7654-3210-ffff"];
  const id = newAccountId("telegram", ["telegram", "telegram-0123456789abcdef"], () => tails.shift() ?? "");
  assert.equal(id, "telegram-fedcba9876543210");
  assert.match(newAccountId("googlechat", ["googlechat"]), /^[a-z0-9][a-z0-9-]{0,31}$/);
});

test("an account reads by its name and what it is connected as", () => {
  assert.equal(
    accountLabel({ id: "t2", type: "telegram", label: "Support", account: "@support_bot" }),
    "Support · @support_bot",
  );
  assert.equal(accountLabel({ id: "slack", type: "slack", label: "Slack" }), "Slack");
  assert.equal(accountLabel({ id: "x", type: "irc", label: "acme", account: "acme" }), "acme");
});
