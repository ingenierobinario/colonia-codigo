# Facebook Pages and Instagram: the owner's own Meta app

Cost: free. Time: about 15 minutes. One connection covers every Facebook Page the owner manages and the Instagram
account linked to each.

Before starting, check with the owner:

- They are an **admin of the Facebook Page** (full control).
- For Instagram: the account is **professional** (Business or Creator) and **linked to that Page** (Page settings ›
  Linked accounts › Instagram). A personal Instagram account cannot be reached.

1. **Developer account.** Open https://developers.facebook.com and register as a developer with their Facebook account
   (it asks to confirm a phone number or email).
2. **App.** Open https://developers.facebook.com/apps/creation/ and name the app. When it asks what the app does,
   choose the use cases about **managing a Page** and **managing messaging and content on Instagram** (the wording
   changes; if it offers "Other" and then the type **Business**, that works too). A business portfolio is optional.
3. **App id and secret.** In the app's dashboard open **App settings › Basic**. The owner will copy **App ID** and
   **App secret** (press Show) into Colonia in step 6. Not here in the chat.
4. **Access token.** Open https://developers.facebook.com/tools/explorer . At the right: **Meta App** = the app just
   made; **User or Page** = **User token**. Under **Permissions** add all of these:
   `pages_show_list`, `pages_read_engagement`, `pages_read_user_content`, `pages_manage_posts`,
   `pages_manage_engagement`, `business_management`, and for Instagram `instagram_basic`,
   `instagram_content_publish`, `instagram_manage_comments`.
5. Press **Generate access token**. In the Facebook window that opens, **select the Pages and the Instagram accounts**
   to connect (the ones left unticked will not appear in Colonia) and accept. The token shows in the "Access Token"
   box. It lasts about an hour: go straight to the next step.
6. **In Colonia.** Open [Resources › Integrations](colonia:resources/integrations) › **Facebook and Instagram**, type
   the App id, the App secret and the Access token, and press **Connect**. Colonia trades the token for a lasting one
   for each Page and keeps only those: the app secret and the token typed are not stored.

Then `social_accounts` lists each Page and its Instagram account.

## What to tell the owner

- **Development mode.** A new app is in "Development". Everything works for the people with a role in the app (the
  owner), but what an app in development publishes may be visible only to those people. To publish for everyone,
  switch the app to **Live** (top of the dashboard; it asks for a privacy policy address). App Review is **not**
  needed while only people with a role in the app use it; this is Meta's rule for one's own data and may change.
- If a permission in step 4 is not in the list, the matching use case is missing from the app: add it in the app's
  **Use cases**, then come back.
- If a Page is missing after connecting, it was not ticked in step 5, or the owner is not its admin: generate a new
  token and connect again.
- Instagram: images must be **JPEG** at a public https address; a video is published as a reel and takes a minute or
  more to process; at most 100 posts in 24 hours. A video on a Facebook Page is not supported here.
- Why there is no "Sign in with Facebook" button: Meta only sends a live app back to an https address, and Colonia
  runs on the owner's computer. The token from the Explorer is the way around it.

Official pages: https://developers.facebook.com/docs/pages-api/getting-started ,
https://developers.facebook.com/docs/instagram-platform/content-publishing and
https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived
