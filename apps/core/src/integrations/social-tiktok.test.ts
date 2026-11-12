import assert from "node:assert/strict";
import { test } from "node:test";
import { SOCIAL_CLIENT, setupSocial } from "./social-testkit.ts";
import { chunks, tiktokApi } from "./social-tiktok.ts";

const VIDEO = "https://videos.example.com/clip.mp4";

test("TikTok signs in with the owner's own app: client_key, comma scopes, a hex PKCE challenge, and only the refresh token is kept", async () => {
  const t = setupSocial();
  assert.throws(() => t.social.start("tiktok", {}), /client id and the client secret of your own app/);
  const url = new URL(t.social.start("tiktok", SOCIAL_CLIENT));
  assert.equal(url.origin + url.pathname, "https://www.tiktok.com/v2/auth/authorize/");
  assert.equal(url.searchParams.get("client_key"), "acme-client");
  assert.equal(url.searchParams.has("client_id"), false);
  assert.equal(url.searchParams.get("scope"), "user.info.basic,video.upload,video.publish");
  assert.equal(url.searchParams.get("redirect_uri"), "http://127.0.0.1:7440/oauth/social");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.match(url.searchParams.get("code_challenge") ?? "", /^[0-9a-f]{64}$/, "TikTok's desktop kit wants hex");

  const { code, state } = t.fake.consent(url.toString());
  await assert.rejects(t.social.finish("bad-code", state), /TikTok refused the sign-in: Authorization code is expired/);
  const again = t.fake.consent(t.social.start("tiktok", SOCIAL_CLIENT));
  assert.deepEqual(await t.social.finish(again.code, again.state), { id: "tiktok", account: "Acme Bakery" });
  await assert.rejects(t.social.finish(code, state), /not valid or expired/, "the refused flow was spent");
  assert.equal(t.social.connected("tiktok"), true);
  assert.equal(t.vault.get("tiktok-refresh_token"), "rft.1");
  assert.ok(![...t.settings.values()].some((v) => v.includes("s3cret") || v.includes("act.") || v.includes("rft.")));
  assert.deepEqual(t.social.client("tiktok"), { client_id: "acme-client", secret: true });

  t.social.disconnect("tiktok");
  assert.equal(t.social.connected("tiktok"), false);
  assert.deepEqual([...t.vault.keys()], []);
});

test("TikTok: a refused access is renewed once with the refresh token, which is replaced", async () => {
  const t = setupSocial();
  await t.signIn("tiktok");
  const tt = tiktokApi(t.social);
  t.fake.expireTikTok();
  assert.deepEqual(await tt.creator(), {
    username: "acme.bakery",
    nickname: "Acme Bakery",
    privacy: ["SELF_ONLY"],
    max_seconds: 600,
  });
  assert.equal(t.vault.get("tiktok-refresh_token"), "rft.2");
  const refresh = t.fake.seen.find((r) => r.form.get("grant_type") === "refresh_token");
  assert.equal(refresh?.form.get("client_key"), "acme-client");
  assert.equal(refresh?.form.get("refresh_token"), "rft.1");

  // A day later the access has run out on Colonia's side too: it is renewed before the call.
  t.tick(25 * 3600_000);
  await tt.creator();
  assert.equal(t.vault.get("tiktok-refresh_token"), "rft.3");
});

test("TikTok: a draft goes to the inbox as an upload of the fetched file, with no caption", async () => {
  const t = setupSocial();
  await t.signIn("tiktok");
  const tt = tiktokApi(t.social);
  await assert.rejects(tt.send({ video_url: VIDEO, mode: "draft", title: "Hi" }), /a draft takes no caption/);
  assert.deepEqual(await tt.send({ video_url: VIDEO, mode: "draft" }), { publish_id: "v_pub_1" });
  assert.deepEqual(t.fake.posted.at(-1), {
    network: "tiktok/post/publish/inbox/video/init/",
    body: { source_info: { source: "FILE_UPLOAD", video_size: 1000, chunk_size: 1000, total_chunk_count: 1 } },
  });
  assert.deepEqual(t.fake.uploads, [{ range: "bytes 0-999/1000", type: "video/mp4", bytes: 1000 }]);
  assert.deepEqual(await tt.status("v_pub_1"), { publish_id: "v_pub_1", status: "PUBLISH_COMPLETE", post_ids: [] });
  await assert.rejects(tt.status("../me"), /publish_id must be/);
});

test("TikTok: a direct post is always private; TikTok's audit refusal comes back in plain words", async () => {
  const t = setupSocial();
  await t.signIn("tiktok");
  const tt = tiktokApi(t.social);
  await tt.send({ video_url: VIDEO, mode: "private", title: "Fresh bread", pull: true });
  assert.deepEqual(t.fake.posted.at(-1), {
    network: "tiktok/post/publish/video/init/",
    body: {
      post_info: { privacy_level: "SELF_ONLY", title: "Fresh bread" },
      source_info: { source: "PULL_FROM_URL", video_url: VIDEO },
    },
  });
  assert.deepEqual(t.fake.uploads, [], "TikTok pulled it itself");

  t.fake.refuseTikTok("unaudited_client_can_only_post_to_private_accounts");
  await assert.rejects(tt.send({ video_url: VIDEO, mode: "private", pull: true }), /Make the account private/);
  t.fake.setTikTokPrivacy(["PUBLIC_TO_EVERYONE"]);
  await assert.rejects(tt.send({ video_url: VIDEO, mode: "private" }), /send it as a draft/);
});

test("TikTok: a lost answer to a send may have gone through; a big file is cut as TikTok asks", async () => {
  const t = setupSocial();
  await t.signIn("tiktok");
  t.fake.setDown(true);
  await assert.rejects(
    tiktokApi(t.social).send({ video_url: VIDEO, mode: "draft", pull: true }),
    /may have gone through anyway/,
  );
  const mb = 1024 * 1024;
  assert.deepEqual(chunks(64 * mb).total_chunk_count, 1);
  const big = chunks(105 * mb);
  assert.equal(big.chunk_size, 10 * mb);
  assert.equal(big.total_chunk_count, 10);
  assert.deepEqual(big.ranges.at(-1), [90 * mb, 105 * mb - 1], "the remainder rides in the last piece");
  assert.equal(big.ranges.length, 10);
});

test("TikTok is usable where it is connected and not turned off", async () => {
  const t = setupSocial();
  assert.equal(t.social.usable("tiktok", undefined), false);
  await t.signIn("tiktok");
  t.off.add("p1:tiktok");
  assert.equal(t.social.usable("tiktok", "p1"), false);
  assert.equal(t.social.usable("tiktok", "p2"), true);
});
