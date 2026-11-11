import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm: scriptedLlm(() => say("ok")) });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

/** An image as the panel sends a tile's picture: a temporary upload, unless `kept`. */
const upload = async (bytes = PNG, kept = false) =>
  (
    await env.client.call("media.upload", {
      name: "tile.png",
      mime: "image/png",
      data: bytes.toString("base64"),
      ...(kept ? {} : { task_asset: true }),
    })
  ).media.id;
/** Every uploaded file on disk. */
const files = () => {
  const root = path.join(env.home, "media", "uploads");
  return fs.existsSync(root) ? fs.readdirSync(root, { recursive: true }).filter((f) => String(f).includes(".")) : [];
};
const listed = async (id: string) => (await env.client.call("projects.list", {})).projects.find((p) => p.id === id);

test("a project's tile is an emoji or an icon with a colour, and Colonia keeps it through a reindex and a rename", async () => {
  const { project } = await env.client.call("projects.create", { name: "Acme" });
  assert.equal(project.mark, undefined, "a new project draws its initial");

  const emoji = await env.client.call("projects.update", {
    project: project.id,
    mark: { emoji: "🚀", tone: "violet" },
  });
  assert.deepEqual(emoji.project.mark, { emoji: "🚀", tone: "violet" });
  await env.client.call("projects.sync", { project: project.id });
  await env.client.call("projects.update", { project: project.id, name: "Acme Corp" });
  const renamed = await listed(project.id);
  assert.equal(renamed?.name, "Acme Corp");
  assert.deepEqual(renamed?.mark, { emoji: "🚀", tone: "violet" }, "the folder's files do not hold it");

  const icon = await env.client.call("projects.update", { project: project.id, mark: { icon: "rocket" } });
  assert.deepEqual(icon.project.mark, { icon: "rocket" }, "a tile replaces the one before, whole");
  const family = await env.client.call("projects.update", { project: project.id, mark: { emoji: "👨‍👩‍👧‍👦" } });
  assert.deepEqual(family.project.mark, { emoji: "👨‍👩‍👧‍👦" }, "an emoji of several code points is still one");

  const cleared = await env.client.call("projects.update", { project: project.id, mark: null });
  assert.equal(cleared.project.mark, undefined);
  const empty = await env.client.call("projects.update", { project: project.id, mark: {} });
  assert.equal(empty.project.mark, undefined, "a tile that sets nothing is the initial");

  await assert.rejects(
    env.client.call("projects.update", { project: project.id, mark: { emoji: "🚀", icon: "rocket" } }),
    /invalid params/,
  );
  await assert.rejects(
    env.client.call("projects.update", { project: project.id, mark: { emoji: "🚀🚀" } }),
    /one emoji/,
  );
  await assert.rejects(
    env.client.call("projects.update", { project: project.id, mark: { icon: "Not An Icon" as never } }),
  );
  assert.equal((await listed(project.id))?.mark, undefined, "a refused tile changes nothing");
});

test("a project's picture is an upload it takes, deleted when the tile changes to another", async () => {
  const { project } = await env.client.call("projects.create", { name: "Northwind" });
  const before = files().length;
  const first = await upload();
  const set = await env.client.call("projects.update", {
    project: project.id,
    mark: { image: first, tone: "ink" },
  });
  assert.deepEqual(set.project.mark, { image: first, tone: "ink" });
  await env.client.call("media.discard", { id: first });
  assert.equal((await env.client.call("media.get", { id: first })).bytes, PNG.length, "taken: no longer temporary");

  // Only the colour changes: the same picture stays, and is not asked to be a fresh upload again.
  const toned = await env.client.call("projects.update", { project: project.id, mark: { image: first } });
  assert.deepEqual(toned.project.mark, { image: first });

  const second = await upload();
  await env.client.call("projects.update", { project: project.id, mark: { image: second } });
  await assert.rejects(env.client.call("media.get", { id: first }));
  assert.equal(files().length, before + 1, "and its file deleted");

  await env.client.call("projects.update", { project: project.id, mark: { emoji: "🧭" } });
  await assert.rejects(env.client.call("media.get", { id: second }));
  assert.equal(files().length, before, "an emoji in its place deletes the picture too");

  const third = await upload();
  await env.client.call("projects.update", { project: project.id, mark: { image: third } });
  await env.client.call("projects.update", { project: project.id, mark: null });
  await assert.rejects(env.client.call("media.get", { id: third }));
  assert.equal(files().length, before, "and so does its initial again");
});

test("a picture that was not uploaded for a tile, is too large or belongs to another project is refused", async () => {
  const a = (await env.client.call("projects.create", { name: "Contoso" })).project.id;
  const b = (await env.client.call("projects.create", { name: "Fabrikam" })).project.id;

  const kept = await upload(PNG, true);
  await assert.rejects(env.client.call("projects.update", { project: a, mark: { image: kept } }), /uploaded for it/);
  await assert.rejects(
    env.client.call("projects.update", { project: a, mark: { image: "med_0000000000000000" } }),
    /uploaded for it/,
  );
  // A chat's own picture is never a tile's: deleting the tile's would take it from the chat.
  assert.equal((await env.client.call("media.get", { id: kept })).bytes, PNG.length);

  const large = await upload(Buffer.concat([PNG, Buffer.alloc(600 * 1024)]));
  await assert.rejects(env.client.call("projects.update", { project: a, mark: { image: large } }), /at most 512 KB/);

  const mine = await upload();
  await env.client.call("projects.update", { project: a, mark: { image: mine } });
  await assert.rejects(env.client.call("projects.update", { project: b, mark: { image: mine } }), /uploaded for it/);
  assert.deepEqual((await listed(a))?.mark, { image: mine });
  assert.equal((await listed(b))?.mark, undefined);
});

test("the base project keeps its tile across its other changes", async () => {
  const set = await env.client.call("projects.update_base", { mark: { emoji: "🏠", tone: "info" } });
  assert.deepEqual(set.base.mark, { emoji: "🏠", tone: "info" });
  const renamed = await env.client.call("projects.update_base", { name: "Home", description: "Everything else" });
  assert.equal(renamed.base.name, "Home");
  assert.deepEqual(renamed.base.mark, { emoji: "🏠", tone: "info" });
  assert.deepEqual((await env.client.call("projects.list", {})).base.mark, { emoji: "🏠", tone: "info" });

  const picture = await upload();
  const drawn = await env.client.call("projects.update_base", { mark: { image: picture } });
  assert.deepEqual(drawn.base.mark, { image: picture });
  const cleared = await env.client.call("projects.update_base", { mark: null });
  assert.equal(cleared.base.mark, undefined);
  assert.equal(cleared.base.name, "Home", "and its name through a change of tile");
  await assert.rejects(env.client.call("media.get", { id: picture }));
});
