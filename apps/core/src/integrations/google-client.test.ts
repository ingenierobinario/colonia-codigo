import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { coloniaGoogleClient, CLIENT_FILE, clientFromJson, clientFromPair } from "./google-client.ts";

const want = { clientId: "123-abc.apps.googleusercontent.com", clientSecret: "public-by-design" };

test("Colonia's Google client is read from the file beside build.json, as Cloud Console downloads it or as a build writes it", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "colonia-gclient-"));
  try {
    assert.equal(coloniaGoogleClient(root), undefined, "a build or checkout without the file has none");
    fs.writeFileSync(
      path.join(root, CLIENT_FILE),
      JSON.stringify({ installed: { client_id: want.clientId, client_secret: want.clientSecret, project_id: "x" } }),
    );
    assert.deepEqual(coloniaGoogleClient(root), want);
    fs.writeFileSync(
      path.join(root, CLIENT_FILE),
      JSON.stringify({ client_id: want.clientId, client_secret: want.clientSecret }),
    );
    assert.deepEqual(coloniaGoogleClient(root), want);
    fs.writeFileSync(path.join(root, CLIENT_FILE), "{ not json");
    assert.equal(coloniaGoogleClient(root), undefined);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a client needs both halves, written as id:secret or as JSON", () => {
  assert.deepEqual(clientFromPair(`${want.clientId}:${want.clientSecret}`), want);
  assert.equal(clientFromPair(want.clientId), undefined);
  assert.equal(clientFromPair(`${want.clientId}:`), undefined);
  const downloaded = JSON.stringify({ installed: { client_id: want.clientId, client_secret: want.clientSecret } });
  assert.equal(clientFromPair(downloaded), undefined, "Cloud Console's JSON is never split as id:secret");
  assert.deepEqual(clientFromJson(downloaded), want);
  assert.equal(clientFromJson(JSON.stringify({ installed: { client_id: want.clientId } })), undefined);
});
