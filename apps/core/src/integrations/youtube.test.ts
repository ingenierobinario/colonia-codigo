import assert from "node:assert/strict";
import { test } from "node:test";
import { socialTools } from "../tools/social.ts";
import { setup } from "./google-testkit.ts";
import { setupSocial } from "./social-testkit.ts";
import { youtubeApi } from "./youtube.ts";

/** A channel with two videos and one comment, as the Data API v3 answers. */
function channel(t: ReturnType<typeof setup>) {
  t.fake.respond((url, init) => {
    const part = url.pathname.replace("/youtube/v3/", "");
    if (part === "channels")
      return {
        items: [
          {
            id: "UCacme",
            snippet: { title: "Acme", customUrl: "@acme" },
            contentDetails: { relatedPlaylists: { uploads: "UUacme" } },
          },
        ],
      };
    if (part === "playlistItems")
      return { items: [{ contentDetails: { videoId: "vid-new" } }, { contentDetails: { videoId: "vid-old" } }] };
    if (part === "videos")
      return {
        items: [
          {
            id: "vid-old",
            snippet: { title: "How we bake", publishedAt: "2026-04-01T10:00:00Z" },
            statistics: { viewCount: "900", likeCount: "40", commentCount: "3" },
          },
          {
            id: "vid-new",
            snippet: { title: "New oven", publishedAt: "2026-05-01T10:00:00Z" },
            statistics: { viewCount: "120", likeCount: "9", commentCount: "1" },
          },
        ],
      };
    if (part === "commentThreads")
      return {
        items: [
          {
            snippet: {
              totalReplyCount: 0,
              topLevelComment: {
                id: "c-1",
                snippet: {
                  authorDisplayName: "Ana",
                  textOriginal: "Which flour?",
                  publishedAt: "2026-05-02T10:00:00Z",
                  likeCount: 2,
                },
              },
            },
          },
        ],
      };
    if (part === "comments" && init?.method === "POST") return { id: "c-1.reply" };
    return { items: [] };
  });
}

async function signedIn() {
  const t = setup();
  await t.g.finish("good-code", t.start("youtube").searchParams.get("state") ?? "");
  channel(t);
  return t;
}

test("YouTube needs the owner's own Google client: Colonia's own does not ask for a channel", () => {
  const t = setup({ builtin: true });
  assert.throws(
    () => t.g.start("youtube", {}),
    /needs the client id and the client secret/,
    "never Colonia's own by default",
  );
  assert.throws(() => t.g.start("youtube", { client: "colonia" }), /YouTube needs your own OAuth client/);
  assert.throws(() => t.g.start("gmail", {}, ["youtube"]), /needs the client id and the client secret/);
  const url = t.start("youtube");
  assert.match(url.searchParams.get("scope") ?? "", /auth\/youtube\.force-ssl/);
  assert.match(url.searchParams.get("client_id") ?? "", /^123-abc/);
});

test("YouTube: the latest videos newest first with their numbers, a video's comments, and a reply", async () => {
  const t = await signedIn();
  const y = youtubeApi(t.g);
  assert.deepEqual(await y.posts(5), [
    {
      id: "vid-new",
      text: "New oven",
      at: "2026-05-01T10:00:00Z",
      url: "https://www.youtube.com/watch?v=vid-new",
      views: 120,
      likes: 9,
      comments: 1,
    },
    {
      id: "vid-old",
      text: "How we bake",
      at: "2026-04-01T10:00:00Z",
      url: "https://www.youtube.com/watch?v=vid-old",
      views: 900,
      likes: 40,
      comments: 3,
    },
  ]);
  const asked = t.fake.seen.map((r) => new URL(r.url));
  assert.equal(asked.find((u) => u.pathname.endsWith("/playlistItems"))?.searchParams.get("playlistId"), "UUacme");
  assert.equal(asked.find((u) => u.pathname.endsWith("/videos"))?.searchParams.get("id"), "vid-new,vid-old");

  assert.deepEqual(await y.comments("vid-new", 10), [
    { id: "c-1", author: "Ana", text: "Which flour?", at: "2026-05-02T10:00:00Z", likes: 2, replies: 0 },
  ]);
  await assert.rejects(y.comments("vid new&part=id", 10), /not a video id/);

  assert.deepEqual(await y.reply("c-1", "Strong white"), { id: "c-1.reply" });
  const sent = t.fake.seen.at(-1);
  assert.equal(sent?.method, "POST");
  assert.deepEqual(sent?.body, { snippet: { parentId: "c-1", textOriginal: "Strong white" } });
});

test("the social tools serve YouTube through the Google sign-in, as outside data, and only while it is on", async () => {
  const t = await signedIn();
  const tools = socialTools(setupSocial().social, t.g);
  const tool = (name: string) => tools.find((x) => x.name === name);
  const ctx = { thread: { id: "t1" } } as never;
  assert.equal(tool("social_posts")?.when?.({ id: "t1" } as never), true);
  assert.equal(
    tool("social_publish")?.when?.({ id: "t1" } as never),
    false,
    "nothing connected publishes: YouTube takes no upload",
  );
  const posts = String(await tool("social_posts")?.run({ network: "youtube", limit: 5 } as never, ctx));
  assert.match(posts, /<social posts[^>]*untrusted/);
  assert.match(posts, /"text":"New oven"/);
  const accounts = String(await tool("social_accounts")?.run({} as never, ctx));
  assert.match(accounts, /"network":"youtube","account":"@acme"/);
  await assert.rejects(
    async () => tool("social_posts")?.run({ network: "x", limit: 5 } as never, ctx),
    /x is not connected/,
  );
  t.off.add("p1:youtube");
  assert.equal(tool("social_posts")?.when?.({ id: "t2", project_id: "p1" } as never), false);
});
