import assert from "node:assert/strict";
import { type ChildProcess, type SpawnOptions, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { after, before, test } from "node:test";
import type { TabInfo } from "@colonia/protocol";
import { chromium } from "@playwright/test";
import { removeDir } from "../testkit/platform.ts";
import { createHeadlessBrowser } from "./headless-browser.ts";

const chrome = chromium.executablePath();
const PAGES: Record<string, string> = {
  "/": `<html><head><title>Acme home</title></head><body><h1>Acme</h1><a href="/prices">Prices</a>
    <form action="/search"><input name="q" aria-label="Search"><input type="password" aria-label="Password"></form></body></html>`,
  "/prices": `<html><head><title>Prices</title></head><body><p>From 10 a month.</p></body></html>`,
  "/to-colonia": "",
};
let srv: http.Server;
let base = "";
let coloniaPort = "";
let dir = "";
let chromeStderr = "";
let browser: ReturnType<typeof createHeadlessBrowser>;
const seen: TabInfo[][] = [];

before(async () => {
  assert.ok(fs.existsSync(chrome), "Install the browser first: pnpm exec playwright install chromium");
  srv = http.createServer((req, res) => {
    if (req.url === "/to-colonia") return res.writeHead(302, { location: `http://127.0.0.1:${coloniaPort}/rpc` }).end();
    const page = PAGES[req.url?.split("?")[0] ?? ""];
    if (page === undefined) return res.writeHead(404).end();
    res
      .writeHead(200, {
        "content-type": "text/html",
        "content-security-policy": "script-src 'none'; object-src 'none'",
      })
      .end(page);
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  // Stands in for Colonia's own port: a tab must never reach it, not even through a redirect.
  const colonia = http.createServer((_q, r) => r.end("Colonia"));
  await new Promise<void>((r) => colonia.listen(0, "127.0.0.1", r));
  coloniaPort = String((colonia.address() as AddressInfo).port);
  colonia.unref();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "colonia-headless-"));
  browser = createHeadlessBrowser({
    dir,
    chrome,
    // Chromium cannot start its sandbox as root in a disposable test container.
    // Keep this exception at the test's process boundary; production keeps its sandbox.
    spawn: ((command: string, args: readonly string[], options: SpawnOptions) => {
      const child = spawn(command, [...args, ...(process.getuid?.() === 0 ? ["--no-sandbox"] : [])], options);
      child.stderr?.on("data", (data) => {
        chromeStderr = `${chromeStderr}${data}`.slice(-4000);
      });
      return child;
    }) as typeof spawn,
    blockedPorts: () => new Set([coloniaPort]),
    onChange: (t) => seen.push(t),
  });
});
after(() => {
  browser?.close();
  srv.closeAllConnections();
  srv.close();
  // Chrome may still hold its profile while it exits; Windows keeps it locked until its last helper is gone, and a
  // temp folder left behind there is not a failure of the browser.
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 50, retryDelay: 200 });
  } catch (err) {
    if (process.platform !== "win32") throw err;
  }
});

test("CDP input and output pipe errors reject work and stop Chrome without an unhandled error", async () => {
  for (const stream of ["input", "output"] as const) {
    const input = new PassThrough();
    const output = new PassThrough();
    let killed = false;
    const child = Object.assign(new EventEmitter(), {
      stdio: [null, null, null, output, input],
      kill: () => {
        killed = true;
        return true;
      },
    }) as unknown as ChildProcess;
    const isolatedDir = fs.mkdtempSync(path.join(os.tmpdir(), "colonia-headless-pipe-"));
    const isolated = createHeadlessBrowser({
      dir: isolatedDir,
      chrome: process.execPath,
      spawn: (() => child) as never,
      blockedPorts: () => new Set(),
      onChange: () => {},
    });
    try {
      const opening = isolated.handle("browser.open", { url: "https://example.com", by: "superagent" });
      (stream === "input" ? input : output).emit("error", new Error("ECONNRESET"));
      await assert.rejects(opening, /ECONNRESET/);
      assert.equal(isolated.running(), false);
      assert.equal(killed, true);
      assert.deepEqual(isolated.list(), []);
    } finally {
      isolated.close();
      input.destroy();
      output.destroy();
      await removeDir(isolatedDir);
    }
  }
});

test("with no desktop app the core drives its own headless Chrome: open, read, click, type; never a password", async (t) => {
  assert.ok(browser.available());
  const tab = (await browser.handle("browser.open", { url: `${base}/`, by: "superagent" }).catch((error) => {
    t.diagnostic(`Browser executable: ${chrome}`);
    t.diagnostic(chromeStderr || "No browser stderr");
    throw error;
  })) as TabInfo;
  const snap = (await browser.handle("browser.snapshot", { tab: tab.tab })) as { tree: string; document: string };
  const evaluated = (await browser.handle("browser.evaluate", {
    tab: tab.tab,
    by: "superagent",
    script: "Promise.resolve({title: document.title, path: location.pathname})",
    origin: base,
    document: snap.document,
  })) as { json: string; url: string };
  assert.deepEqual(JSON.parse(evaluated.json), { title: "Acme home", path: "/" });
  assert.equal(evaluated.url, `${base}/`);
  await assert.rejects(
    browser.handle("browser.evaluate", {
      tab: tab.tab,
      by: "superagent",
      origin: "https://northwind.example",
      document: snap.document,
      script: "document.title = 'wrong'",
    }),
    /origin changed/,
  );
  await assert.rejects(
    browser.handle("browser.evaluate", {
      tab: tab.tab,
      by: "superagent",
      script: "(() => { throw new Error('expected failure') })()",
      origin: base,
      document: snap.document,
    }),
    /expected failure/,
  );
  assert.equal(tab.title, "Acme home");
  assert.deepEqual(tab.control.kind, "agent");
  assert.match(snap.tree, /^<untrusted_web source=/, "page content is marked as outside data");
  const link = /link "Prices" \[(e\d+)\]/.exec(snap.tree)?.[1];
  const search = /textbox "Search" \[(e\d+)\]/.exec(snap.tree)?.[1];
  const password = /textbox "Password" \[(e\d+)\]/.exec(snap.tree)?.[1];
  assert.ok(link && search && password, snap.tree);
  await browser.handle("browser.type", { tab: tab.tab, ref: search, text: "plans", by: "superagent" });
  await assert.rejects(
    browser.handle("browser.type", { tab: tab.tab, ref: password, text: "x", by: "superagent" }),
    /password/,
  );
  const clicked = (await browser.handle("browser.click", { tab: tab.tab, ref: link, by: "superagent" })) as {
    url: string;
  };
  assert.equal(clicked.url, `${base}/prices`);
  await assert.rejects(
    browser.handle("browser.evaluate", {
      tab: tab.tab,
      by: "superagent",
      origin: base,
      document: snap.document,
      script: "document.title = 'wrong'",
    }),
    /context|object|document/i,
  );
  const text = (await browser.handle("browser.text", { tab: tab.tab })) as { text: string };
  assert.match(text.text, /From 10 a month/);
  await assert.rejects(
    browser.handle("browser.handoff", { tab: tab.tab, reason: "log in", by: "superagent" }),
    /nobody can take over/,
  );
  await assert.rejects(
    browser.handle("browser.navigate", { tab: tab.tab, url: `http://127.0.0.1:${coloniaPort}/`, by: "superagent" }),
    /Colonia itself/,
  );
  await browser.handle("browser.navigate", { tab: tab.tab, url: `${base}/to-colonia`, by: "superagent" });
  const after = (await browser.handle("browser.text", { tab: tab.tab })) as { text: string };
  assert.doesNotMatch(after.text, /^Colonia$/, "a redirect to Colonia is blocked too");
  assert.ok(seen.length > 0, "tab changes reach the panel");
  await browser.handle("browser.close", { tab: tab.tab });
  assert.deepEqual(browser.list(), []);
});

test("real Chromium retires consent on reload, in-page navigation and tab closure", async () => {
  const tab = (await browser.handle("browser.open", { url: `${base}/`, by: "reader" })) as TabInfo;
  const snapshot = async () => (await browser.handle("browser.snapshot", { tab: tab.tab })) as { document: string };
  const context = async (document: string) =>
    (await browser.handle("browser.approval_context", {
      tab: tab.tab,
      origin: base,
      document,
    })) as { epoch: string };
  try {
    const first = await snapshot();
    const consent = await context(first.document);
    for (let i = 0; i < 3; i++) {
      const result = (await browser.handle("browser.evaluate", {
        tab: tab.tab,
        origin: base,
        document: first.document,
        epoch: consent.epoch,
        script: String(i),
        by: "reader",
      })) as { json: string };
      assert.equal(result.json, String(i));
    }
    await browser.handle("browser.history", { tab: tab.tab, action: "reload", by: "reader" });
    const second = await snapshot();
    assert.notEqual((await context(second.document)).epoch, consent.epoch);
    await assert.rejects(
      browser.handle("browser.evaluate", {
        tab: tab.tab,
        origin: base,
        document: second.document,
        epoch: consent.epoch,
        script: "42",
        by: "reader",
      }),
      /permission expired/,
    );
    const next = await context(second.document);
    await browser.handle("browser.evaluate", {
      tab: tab.tab,
      origin: base,
      document: second.document,
      epoch: next.epoch,
      script: "history.pushState({}, '', '/prices')",
      by: "reader",
    });
    const third = await snapshot();
    assert.notEqual((await context(third.document)).epoch, next.epoch);
  } finally {
    await browser.handle("browser.close", { tab: tab.tab });
  }
  await assert.rejects(context("doc1"), /tab|unknown|not found/i);
});

test("a remote browser transport failure kills its process and never launches host Chrome", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  let killed = false;
  let hostStarts = 0;
  const child = Object.assign(new EventEmitter(), {
    kill: () => {
      killed = true;
      return true;
    },
  }) as unknown as ChildProcess;
  const remote = createHeadlessBrowser({
    dir: "",
    chrome,
    spawn: (() => {
      hostStarts++;
      throw new Error("host launch refused");
    }) as never,
    remote: { selectAllModifiers: 2, launch: () => ({ child, input, output }) },
    blockedPorts: () => new Set(),
    onChange: () => {},
  });
  try {
    const work = remote.handle("browser.open", { url: "https://example.com", by: "superagent" });
    child.emit("error", new Error("SSH guest unavailable"));
    await assert.rejects(work, /SSH guest unavailable/);
    assert.equal(killed, true);
    assert.equal(hostStarts, 0);
    assert.equal(remote.running(), false);
    assert.deepEqual(remote.list(), []);
  } finally {
    remote.close();
    input.destroy();
    output.destroy();
  }
});

test("NAVEGADORES-2: headless, an owner's browser profile is refused instead of opening empty, and knows no sign-ins", async () => {
  await assert.rejects(
    browser.handle("browser.open", { url: `${base}/`, by: "superagent", profile: "nav:chrome-default" }),
    /Navegadores/,
  );
  assert.deepEqual(await browser.handle("browser.signed_in", { profile: "nav:chrome-default" }), { sites: [] });
});

test("NAVEGADOR-AGIL-1: a whole form in one call, waiting for what loads late, a key, and what failed on the page", async () => {
  const pages: Record<string, (q: URLSearchParams) => string> = {
    "/form": () => `<html><head><title>Form</title></head><body><form action="/done">
      <label>Name <input name="name"></label>
      <label>Country <select name="country"><option value="">Choose</option><option value="ES">Spain</option><option value="MX">Mexico</option></select></label>
      <label><input type="radio" name="plan" value="month"> Monthly</label><label><input type="radio" name="plan" value="year"> Yearly</label>
      <label><input type="checkbox" name="terms"> Terms</label>
      <input type="password" aria-label="Password"><button>Send</button></form></body></html>`,
    "/done": (q) =>
      `<html><head><title>Done</title></head><body><h1>Got ${q.get("name")} ${q.get("country")} ${q.get("plan")} ${q.get("terms")}</h1></body></html>`,
    "/late":
      () => `<html><head><title>Late</title></head><body><input aria-label="Box" autofocus><ul id="r"></ul><script>
      fetch("/missing");
      document.querySelector("input").addEventListener("keydown", (e) => { if (e.key === "Escape") document.title = "escaped"; });
      setTimeout(() => { document.getElementById("r").innerHTML = "<li>Result one</li>"; }, 1500);
    </script></body></html>`,
  };
  const own = http.createServer((req, res) => {
    const u = new URL(req.url ?? "/", "http://x");
    const page = pages[u.pathname];
    if (!page) return res.writeHead(404).end();
    res.writeHead(200, { "content-type": "text/html" }).end(page(u.searchParams));
  });
  await new Promise<void>((r) => own.listen(0, "127.0.0.1", r));
  const at = `http://127.0.0.1:${(own.address() as AddressInfo).port}`;
  try {
    const tab = ((await browser.handle("browser.open", { url: `${at}/form`, by: "superagent" })) as TabInfo).tab;
    const tree = ((await browser.handle("browser.snapshot", { tab })) as { tree: string }).tree;
    const r = (re: RegExp) => re.exec(tree)?.[1] as string;
    const name = r(/textbox "Name" \[(e\d+)\]/);
    const country = r(/combobox "Country" \[(e\d+)\]/);
    const yearly = r(/radio "Yearly" \[(e\d+)\]/);
    const terms = r(/checkbox "Terms" \[(e\d+)\]/);
    const send = r(/button "Send" \[(e\d+)\]/);
    const password = r(/textbox "Password" \[(e\d+)\]/);
    assert.ok(name && country && yearly && terms && send && password, tree);
    // A password is refused inside a form as it is alone.
    await assert.rejects(
      browser.handle("browser.fill", { tab, fields: [{ ref: password, value: "x" }], by: "superagent" }),
      /password/,
    );
    // An option that does not exist is reported, and the form is not sent.
    const wrong = (await browser.handle("browser.fill", {
      tab,
      fields: [{ ref: country, value: "Peru" }],
      submit: send,
      by: "superagent",
    })) as { url: string; problems: string[] };
    assert.match(wrong.problems.join(), /no option "Peru".*Spain, Mexico/);
    assert.equal(wrong.url, `${at}/form`);
    const done = (await browser.handle("browser.fill", {
      tab,
      fields: [
        { ref: name, value: "Ana" },
        { ref: country, value: "Mexico" },
        { ref: yearly, value: true },
        { ref: terms, value: true },
        // Already checked: setting it again must not uncheck it.
        { ref: terms, value: true },
      ],
      submit: send,
      by: "superagent",
    })) as { url: string; problems: string[] };
    assert.deepEqual(done.problems, []);
    assert.match(done.url, /\/done\?/);
    const text = (await browser.handle("browser.text", { tab })) as { text: string };
    assert.match(text.text, /Got Ana MX year on/);

    await browser.handle("browser.navigate", { tab, url: `${at}/late`, by: "superagent" });
    const t0 = Date.now();
    const seen = (await browser.handle("browser.wait", { tab, text: "result ONE", timeout_s: 5 })) as {
      found: boolean;
    };
    assert.equal(seen.found, true);
    assert.ok(Date.now() - t0 < 4_500, "it returns when the text shows, not at the timeout");
    const never = (await browser.handle("browser.wait", { tab, text: "Nothing like it", timeout_s: 0.5 })) as {
      found: boolean;
    };
    assert.equal(never.found, false);
    assert.equal(
      ((await browser.handle("browser.wait", { tab, gone: "Result one", timeout_s: 0.5 })) as { found: boolean }).found,
      false,
    );
    await browser.handle("browser.press", { tab, key: "Escape", by: "superagent" });
    const info = (await browser.handle("browser.tabs", {})) as { tabs: TabInfo[] };
    assert.equal(info.tabs.find((x) => x.tab === tab)?.title, "escaped");
    await assert.rejects(browser.handle("browser.press", { tab, key: "F13", by: "superagent" }), /unknown key/);
    const logs = (await browser.handle("browser.console", { tab, clear: true })) as { entries: string[] };
    assert.ok(
      logs.entries.some((l) => /404 .*\/missing/.test(l)),
      logs.entries.join("\n"),
    );
    assert.deepEqual(((await browser.handle("browser.console", { tab })) as { entries: string[] }).entries, []);
    await browser.handle("browser.close", { tab });
  } finally {
    own.closeAllConnections();
    own.close();
  }
});
