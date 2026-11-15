import assert from "node:assert/strict";
import { test } from "node:test";
import { guessServers, PROVIDERS, passwordPage, providerOf } from "./mailProviders.ts";

test("the address alone says whose servers a mailbox uses", () => {
  assert.equal(providerOf("agent@gmail.com"), "gmail");
  assert.equal(providerOf(" Agent@Hotmail.com "), "outlook");
  assert.equal(providerOf("agent@me.com"), "icloud");
  assert.equal(providerOf("agent@example.org"), undefined);
});

test("a domain nobody listed gets the usual server names, ready to connect", () => {
  assert.deepEqual(guessServers("agent@example.org"), {
    imap: { host: "imap.example.org", port: 993, tls: "implicit" },
    smtp: { host: "smtp.example.org", port: 465, tls: "implicit" },
  });
  // Half an address guesses nothing: the form stays closed until it is whole.
  assert.equal(guessServers("agent@"), undefined);
  assert.equal(guessServers("agent"), undefined);
});

test("every known provider opens the page that makes its app password; an unknown one has none", () => {
  for (const id of Object.keys(PROVIDERS) as Array<keyof typeof PROVIDERS>) {
    const page = passwordPage(id);
    assert.equal(page?.name, PROVIDERS[id].name);
    assert.match(page?.url ?? "", /^https:\/\//);
  }
  assert.equal(passwordPage("other"), undefined);
});

test("two mailboxes on different providers resolve each to its own servers", () => {
  const servers = (address: string) => {
    const p = providerOf(address);
    return p && p !== "other" ? PROVIDERS[p].imap.host : guessServers(address)?.imap.host;
  };
  assert.deepEqual(["one@gmail.com", "two@example.org"].map(servers), ["imap.gmail.com", "imap.example.org"]);
});
