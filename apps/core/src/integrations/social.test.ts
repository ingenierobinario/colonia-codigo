import assert from "node:assert/strict";
import { test } from "node:test";
import { linkedinApi } from "./social-linkedin.ts";
import { metaApi } from "./social-meta.ts";
import { META_APP, SOCIAL_CLIENT, setupSocial } from "./social-testkit.ts";
import { xApi } from "./social-x.ts";

const last = (t: ReturnType<typeof setupSocial>) => t.fake.seen.at(-1);

test("X signs in with the owner's own app: PKCE, the client in a Basic header, and only the refresh token is kept", async () => {
  const t = setupSocial();
  assert.throws(() => t.social.start("x", {}), /client id and the client secret of your own app/);
  const url = new URL(t.social.start("x", SOCIAL_CLIENT));
  assert.equal(url.origin + url.pathname, "https://x.com/i/oauth2/authorize");
  assert.equal(url.searchParams.get("redirect_uri"), "http://127.0.0.1:7440/oauth/social");
  assert.equal(url.searchParams.get("scope"), "tweet.read tweet.write users.read offline.access");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.ok((url.searchParams.get("state") ?? "").length < 500, "X refuses a state over 500 characters");
  assert.equal(t.social.connected("x"), false);

  const { code, state } = t.fake.consent(url.toString());
  await assert.rejects(t.social.finish(code, `${state}x`), /not valid or expired/);
  assert.deepEqual(await t.social.finish(code, state), { id: "x", account: "@acme" });
  await assert.rejects(t.social.finish(code, state), /not valid or expired/, "a state is used once");
  assert.equal(t.social.connected("x"), true);
  assert.equal(t.vault.get("x-refresh_token"), "xr-1");
  assert.equal(t.vault.get("x-client_secret"), "s3cret");
  assert.ok(![...t.settings.values()].some((v) => v.includes("s3cret") || v.includes("xa-") || v.includes("xr-")));
  assert.deepEqual(t.social.client("x"), { client_id: "acme-client", secret: true });

  t.social.disconnect("x");
  assert.equal(t.social.connected("x"), false);
  assert.deepEqual([...t.vault.keys()], []);
});

test("a state signed by another core, or a wrong code, connects nothing", async () => {
  const t = setupSocial();
  const other = setupSocial();
  const foreign = other.fake.consent(other.social.start("x", SOCIAL_CLIENT));
  assert.equal(t.social.owns(foreign.state), false);
  await assert.rejects(t.social.finish("good-code", foreign.state), /not valid or expired/);
  const mine = t.fake.consent(t.social.start("x", SOCIAL_CLIENT));
  assert.equal(t.social.owns(mine.state), true);
  await assert.rejects(
    t.social.finish("bad-code", mine.state),
    /X refused the sign-in: Value passed for the authorization code/,
  );
  assert.equal(t.social.connected("x"), false);
});

test("X: posts with their numbers, replies, a post and a reply; an expired access is minted again once", async () => {
  const t = setupSocial();
  await t.signIn("x");
  const x = xApi(t.social);
  assert.deepEqual(await x.posts(3), [
    {
      id: "1001",
      text: "We open on Monday",
      at: "2026-05-01T10:00:00.000Z",
      url: "https://x.com/acme/status/1001",
      views: 300,
      likes: 7,
      replies: 2,
      reposts: 1,
    },
  ]);
  assert.equal(last(t)?.url.searchParams.get("max_results"), "5", "X takes no fewer than 5 a page");
  assert.equal(last(t)?.url.searchParams.get("exclude"), "replies,retweets");

  const replies = await x.comments("1001", 10);
  assert.equal(last(t)?.url.searchParams.get("query"), "conversation_id:1001");
  assert.equal(replies[0]?.author, "northwind");
  await assert.rejects(x.comments("1001 OR from:acme", 10), /numeric id/);

  // X ends the access on its side: the refresh token is spent and replaced, and the call goes through.
  t.fake.expireAccess();
  assert.deepEqual(await x.publish("Hello from Acme"), { id: "2001", url: "https://x.com/acme/status/2001" });
  assert.equal(t.vault.get("x-refresh_token"), "xr-2");
  assert.deepEqual(t.fake.posted.at(-1), { network: "x", body: { text: "Hello from Acme" } });
  await x.publish("Thank you", "1002");
  assert.deepEqual(t.fake.posted.at(-1)?.body, { text: "Thank you", reply: { in_reply_to_tweet_id: "1002" } });

  // Two calls at once after the access ran out share one refresh: a second would void the sign-in.
  t.tick(3 * 3_600_000);
  const before = t.fake.seen.filter((r) => r.url.pathname === "/2/oauth2/token").length;
  await Promise.all([x.posts(5), x.posts(5)]);
  assert.equal(t.fake.seen.filter((r) => r.url.pathname === "/2/oauth2/token").length, before + 1);

  t.fake.revoke();
  t.tick(3 * 3_600_000);
  await assert.rejects(x.posts(5), /X no longer accepts the sign-in; sign in again/);
});

test("a post whose answer never came says it may have gone through", async () => {
  const t = setupSocial();
  await t.signIn("x");
  t.fake.setDown(true);
  await assert.rejects(xApi(t.social).publish("Hello"), /may have gone through anyway: check before trying again/);
  await assert.rejects(xApi(t.social).posts(5), /^Error: X: no answer$/);
});

test("LinkedIn signs in without PKCE and publishes on the profile; after 60 days it asks to sign in again", async () => {
  const t = setupSocial();
  const url = new URL(t.social.start("linkedin", SOCIAL_CLIENT));
  assert.equal(url.origin + url.pathname, "https://www.linkedin.com/oauth/v2/authorization");
  assert.equal(url.searchParams.get("scope"), "openid profile w_member_social");
  assert.equal(url.searchParams.has("code_challenge"), false);
  const { code, state } = t.fake.consent(url.toString());
  assert.deepEqual(await t.social.finish(code, state), { id: "linkedin", account: "Acme Owner" });
  assert.equal(
    t.fake.seen.find((r) => r.url.pathname === "/oauth/v2/accessToken")?.form.get("client_secret"),
    "s3cret",
  );

  const made = await linkedinApi(t.social).publish("We are hiring", "https://example.com/jobs");
  assert.deepEqual(made, { id: "urn:li:share:9001", url: "https://www.linkedin.com/feed/update/urn:li:share:9001/" });
  assert.equal(last(t)?.headers["x-restli-protocol-version"], "2.0.0");
  const body = t.fake.posted.at(-1)?.body as Record<string, unknown>;
  assert.equal(body.author, "urn:li:person:abc123");
  assert.deepEqual(body.specificContent, {
    "com.linkedin.ugc.ShareContent": {
      shareCommentary: { text: "We are hiring" },
      shareMediaCategory: "ARTICLE",
      media: [{ status: "READY", originalUrl: "https://example.com/jobs" }],
    },
  });

  t.tick(61 * 86_400_000);
  assert.equal(t.social.connected("linkedin"), true, "still listed, so the owner sees where to sign in again");
  await assert.rejects(linkedinApi(t.social).publish("Again"), /lasts 60 days and has ended; sign in again/);
});

test("Meta trades the Explorer's token for each Page's lasting one and keeps only those", async () => {
  const t = setupSocial();
  await assert.rejects(t.social.connectMeta({ app_id: "1" }), /app id, the app secret and the access token/);
  await assert.rejects(t.social.connectMeta({ ...META_APP, user_token: "wrong" }), /Meta: Invalid OAuth access token/);
  assert.equal(t.social.connected("meta"), false);
  await t.social.connectMeta(META_APP);
  assert.equal(t.social.connected("meta"), true);
  assert.deepEqual(t.social.pages(), [
    { id: "111", name: "Acme Bakery", instagram: { id: "999", username: "acme.bakery" } },
    { id: "222", name: "Northwind" },
  ]);
  assert.equal(t.social.account("meta"), "Acme Bakery, Northwind");
  assert.deepEqual([...t.vault.keys()].sort(), ["meta-page_111", "meta-page_222"], "no app secret, no user token");
  const kept = JSON.stringify([...t.settings.values(), ...t.vault.values()]);
  assert.ok(!kept.includes(META_APP.app_secret) && !kept.includes("user-token"));

  t.social.disconnect("meta");
  assert.equal(t.social.connected("meta"), false);
  assert.deepEqual([...t.vault.keys()], []);
});

test("Facebook Pages: posts, comments, publishing and replying, on the Page named", async () => {
  const t = setupSocial();
  await t.social.connectMeta(META_APP);
  const meta = metaApi(t.social);
  await assert.rejects(meta.posts("facebook", undefined, 5), /say which account: Acme Bakery, Northwind/);
  assert.deepEqual(await meta.posts("facebook", "acme bakery", 5), [
    {
      id: "111_500",
      text: "Fresh bread today",
      at: "2026-05-01T08:00:00+0000",
      url: "https://www.facebook.com/acme/posts/500",
      likes: 12,
      comments: 4,
      shares: 3,
    },
  ]);
  assert.equal(last(t)?.headers.authorization, "Bearer page-token-111");
  assert.equal(last(t)?.url.searchParams.has("access_token"), false, "the token never rides in the address");
  assert.equal((await meta.comments("facebook", "111", "111_500", 5))[0]?.author, "Ana");
  await assert.rejects(meta.comments("facebook", "111", "../me", 5), /must be an id/);

  assert.deepEqual(
    await meta.publish("facebook", "Northwind", { text: "Closed on Sunday", link: "https://example.com" }),
    {
      id: "222_501",
      url: "https://www.facebook.com/222_501",
    },
  );
  assert.deepEqual(t.fake.posted.at(-1), {
    network: "/222/feed",
    body: { message: "Closed on Sunday", link: "https://example.com" },
  });
  assert.equal(
    (await meta.publish("facebook", "111", { text: "Look", image_url: "https://example.com/a.jpg" })).id,
    "111_601",
  );
  await assert.rejects(
    meta.publish("facebook", "111", { text: "Clip", video_url: "https://example.com/a.mp4" }),
    /not supported/,
  );
  await meta.reply("facebook", "111", "111_500_1", "Thank you");
  assert.deepEqual(t.fake.posted.at(-1), { network: "/111_500_1/comments", body: { message: "Thank you" } });
});

test("Instagram: the account linked to a Page; a video is published once Instagram has processed it", async () => {
  const t = setupSocial();
  await t.social.connectMeta(META_APP);
  const meta = metaApi(t.social);
  const posts = await meta.posts("instagram", undefined, 5);
  assert.equal(last(t)?.url.pathname, "/v27.0/999/media", "the only Page with an Instagram account");
  assert.deepEqual(posts[0], {
    id: "800",
    text: "Our new loaf",
    at: "2026-05-01T09:00:00+0000",
    url: "https://www.instagram.com/p/abc/",
    kind: "IMAGE",
    likes: 30,
    comments: 5,
  });
  assert.equal((await meta.comments("instagram", "@acme.bakery", "800", 5))[0]?.author, "northwind");
  await assert.rejects(meta.publish("instagram", undefined, { text: "Words only" }), /needs image_url or video_url/);

  t.fake.setProcessing(2);
  const made = await meta.publish("instagram", undefined, { text: "Baking", video_url: "https://example.com/a.mp4" });
  assert.deepEqual(made, { id: "801", url: "https://www.instagram.com/p/new/" });
  assert.deepEqual(t.waits, [10_000, 10_000], "it waited while Instagram processed");
  assert.deepEqual(
    t.fake.posted.map((p) => p.network),
    ["/999/media", "/999/media_publish"],
  );
  assert.deepEqual(t.fake.posted[0]?.body, {
    media_type: "REELS",
    video_url: "https://example.com/a.mp4",
    caption: "Baking",
  });
  assert.deepEqual(t.fake.posted[1]?.body, { creation_id: "700" });

  await meta.reply("instagram", undefined, "900", "Yes, we do");
  assert.equal(t.fake.posted.at(-1)?.network, "/900/replies");
});

test("an integration is usable where it is connected and not turned off", async () => {
  const t = setupSocial();
  assert.equal(t.social.usable("x", undefined), false);
  await t.signIn("x");
  t.off.add("p1:x");
  assert.equal(t.social.usable("x", "p1"), false);
  assert.equal(t.social.usable("x", "p2"), true);
});
