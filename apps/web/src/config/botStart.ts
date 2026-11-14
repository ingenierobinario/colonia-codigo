// CANALES-SENCILLOS-1: where the setup of a bot channel starts, as one press. Slack takes a ready-made description of
// the app (its "manifest") in the link itself, so the owner creates it with every setting in place instead of
// walking six screens; the other platforms open on the page their first step names.

/** The name a Slack app gets: "Colonia" for the first account, "Colonia 2" for the one after it (MULTI-CUENTA-1). */
export const slackAppName = (ordinal: number): string => (ordinal > 1 ? `Colonia ${ordinal}` : "Colonia");

/**
 * What the Slack adapter needs, and no more: direct messages over a socket the app opens (no public address), answers
 * and files out, names of who writes, and button presses back.
 */
export function slackManifest(name: string) {
  return {
    display_information: { name },
    features: {
      app_home: { home_tab_enabled: false, messages_tab_enabled: true, messages_tab_read_only_enabled: false },
      bot_user: { display_name: name, always_online: true },
    },
    oauth_config: { scopes: { bot: ["chat:write", "im:history", "users:read", "files:write"] } },
    settings: {
      event_subscriptions: { bot_events: ["message.im"] },
      interactivity: { is_enabled: true },
      org_deploy_enabled: false,
      socket_mode_enabled: true,
      token_rotation_enabled: false,
    },
  };
}

/** Slack's "new app" page with the app already described: the owner picks a workspace and confirms. */
export const slackCreateUrl = (ordinal = 1): string =>
  `https://api.slack.com/apps?new_app=1&manifest_json=${encodeURIComponent(JSON.stringify(slackManifest(slackAppName(ordinal))))}`;

/** The page a kind's first step happens on; kinds on the owner's own server have none. */
const START: Record<string, { site: string; url(ordinal: number): string }> = {
  telegram: { site: "BotFather", url: () => "https://t.me/BotFather" },
  discord: { site: "Discord Developer Portal", url: () => "https://discord.com/developers/applications" },
  slack: { site: "Slack", url: slackCreateUrl },
  googlechat: { site: "Google Cloud", url: () => "https://console.cloud.google.com/apis/library/chat.googleapis.com" },
  sms: { site: "Twilio", url: () => "https://console.twilio.com/" },
  teams: {
    site: "Azure",
    url: () => "https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade",
  },
  line: { site: "LINE Developers", url: () => "https://developers.line.biz/console/" },
};

/** Where to send the owner for a kind's first step, if it has a page of its own. */
export function botStart(kind: string, ordinal = 1): { site: string; url: string } | undefined {
  const s = Object.hasOwn(START, kind) ? START[kind] : undefined;
  return s && { site: s.site, url: s.url(ordinal) };
}
