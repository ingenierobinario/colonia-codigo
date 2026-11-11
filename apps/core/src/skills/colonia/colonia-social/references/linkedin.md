# LinkedIn: the owner's own app

Cost: free. Time: about 10 minutes. What it gives: **publishing on the owner's personal profile**. Reading posts,
numbers or comments, and posting as a company Page, need LinkedIn's Community Management API, which LinkedIn grants
only to reviewed companies: not available here.

1. **A company Page.** LinkedIn requires every app to be tied to a LinkedIn Page. If the owner has none, they create
   one free at https://www.linkedin.com/company/setup/new/ (it is only for the app; nothing is posted on it).
2. **App.** Open https://www.linkedin.com/developers/apps and press **Create app**: a name, that Page, a logo (any
   square image), accept the terms.
3. **Verify the Page.** In the app's **Settings** tab press **Verify** next to the Page, and open the link it gives
   while signed in as the Page's admin. Do this before asking for products.
4. **Products.** In the **Products** tab press **Request access** on both:
   - **Share on LinkedIn** (gives `w_member_social`: posting as the member)
   - **Sign In with LinkedIn using OpenID Connect** (gives `openid`, `profile`: knowing whose profile it is)
   Both are self-service and normally granted at once.
5. **Redirect address.** In the **Auth** tab, under **OAuth 2.0 settings** › **Authorized redirect URLs for your
   app**, add the **Redirect URI the dialog shows** in Colonia, exactly. On the same tab are the **Client ID** and the
   **Primary Client Secret**.
6. **In Colonia.** Open [Resources › Integrations](colonia:resources/integrations) › **LinkedIn**, type the client id
   and the client secret, press **Sign in**, and allow in the LinkedIn page that opens.

## What to tell the owner

- **The sign-in lasts 60 days** and LinkedIn gives this kind of app no way to renew it silently: every two months they
  open the integration and press **Sign in again** (the app stays as it is).
- A post is text, optionally with one link shown as a preview. Images and video are not supported here.
- If LinkedIn refuses the redirect address in step 5, tell the owner exactly what it says and stop: Colonia's address
  is an `http://127.0.0.1` one and has not been tried against a real LinkedIn app.

Official pages: https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow and
https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin
