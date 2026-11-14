import assert from "node:assert/strict";
import { test } from "node:test";
import { botStart, slackAppName, slackCreateUrl, slackManifest } from "./botStart.ts";

test("the Slack link carries the whole app: socket, direct messages, buttons and the four permissions", () => {
  const url = new URL(slackCreateUrl());
  assert.equal(url.origin + url.pathname, "https://api.slack.com/apps");
  assert.equal(url.searchParams.get("new_app"), "1");
  const manifest = JSON.parse(url.searchParams.get("manifest_json") ?? "");
  assert.deepEqual(manifest, slackManifest("Colonia"));
  assert.equal(manifest.settings.socket_mode_enabled, true);
  assert.equal(manifest.settings.interactivity.is_enabled, true);
  assert.deepEqual(manifest.settings.event_subscriptions.bot_events, ["message.im"]);
  assert.equal(manifest.features.app_home.messages_tab_enabled, true);
  assert.equal(manifest.features.app_home.messages_tab_read_only_enabled, false);
  assert.deepEqual(manifest.oauth_config.scopes.bot, ["chat:write", "im:history", "users:read", "files:write"]);
  // No public address anywhere: an app in Socket Mode takes none.
  assert.doesNotMatch(JSON.stringify(manifest), /request_url|redirect_urls/);
});

test("a second Slack account gets an app of its own name, and the link stays a plain encoded URL", () => {
  assert.equal(slackAppName(1), "Colonia");
  assert.equal(slackAppName(3), "Colonia 3");
  const second = JSON.parse(new URL(slackCreateUrl(2)).searchParams.get("manifest_json") ?? "");
  assert.equal(second.display_information.name, "Colonia 2");
  assert.equal(second.features.bot_user.display_name, "Colonia 2");
  assert.doesNotMatch(slackCreateUrl(2), /[\s{}"]/);
  assert.ok(slackCreateUrl(2).length < 2000);
});

test("kinds with a page of their own open on it over https; kinds on the owner's server have none", () => {
  for (const kind of ["telegram", "discord", "slack", "googlechat", "sms", "teams", "line"]) {
    const start = botStart(kind);
    assert.ok(start?.site, kind);
    assert.equal(new URL(start.url).protocol, "https:", kind);
  }
  for (const kind of ["matrix", "mattermost", "signal", "ntfy", "nextcloud", "irc", "twitch", "toString"]) {
    assert.equal(botStart(kind), undefined, kind);
  }
});
