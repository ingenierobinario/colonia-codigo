# X: the owner's own app

Cost: **X's API is paid by use**: the owner buys credits in the developer console, and every call spends some.
Indicative prices in November 2026, which X changes: about $0.015 to create a post, $0.005 per post read, $0.010 per
profile read. Tell the owner before starting, and that the console shows what was spent. Time: about 10 minutes.

1. **Developer account.** Open https://console.x.com and sign in with the X account that will post. Accept the
   developer agreement; it asks what the API will be used for (a sentence such as "posting and reading replies for my
   own account" is fine).
2. **Credits.** In the console's billing section, add a payment method and buy a small amount of credits. Without
   credits calls are refused.
3. **App.** Create an app (the console may already have made a default one).
4. **User authentication.** In the app's settings open **User authentication settings** › **Set up**:
   - App permissions: **Read and write**.
   - Type of App: **Web App, Automated App or Bot** (this is what gives a client secret).
   - Callback URI / Redirect URL: the **Redirect URI the dialog shows** in Colonia, exactly (it starts with
     `http://127.0.0.1:`; X does not accept `localhost`).
   - Website URL: any site of theirs (their X profile address works).
5. **Keys.** Save. X shows the **OAuth 2.0 Client ID and Client Secret** once: keep that page open. (These are not the
   "API Key and Secret" nor the "Bearer Token": those are another kind of access and will not work.)
6. **In Colonia.** Open [Resources › Integrations](colonia:resources/integrations) › **X**, type the client id and the
   client secret, press **Sign in**, and approve in the X page that opens.

## What to tell the owner

- Colonia asks for `tweet.read`, `tweet.write`, `users.read` and `offline.access` (to stay signed in).
- Replies are read with X's recent search, which only goes back **7 days**.
- Posts are text (and a link). Images and video are not supported here.
- If the client secret was lost, **Regenerate** it in the app's **Keys and tokens** and enter the new one in Colonia.
- "Something went wrong" on X's approval page nearly always means the callback address does not match exactly.

Official pages: https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code and
https://docs.x.com/x-api/getting-started/pricing
