# YouTube: the owner's own Google client

Cost: free. Time: about 10 minutes. YouTube connects through the Google sign-in, but only with the owner's own OAuth
client (Colonia's built-in Google sign-in does not ask for YouTube). If the owner already made a client for Gmail or
Drive, reuse it: only steps 2 and 5 are new.

1. **Project.** Open https://console.cloud.google.com/projectcreate and create a project (any name).
2. **Turn on the API.** Open https://console.cloud.google.com/apis/library/youtube.googleapis.com and press **Enable**
   ("YouTube Data API v3"), with that project selected at the top.
3. **Consent screen.** Open https://console.cloud.google.com/auth/overview and press **Get started**: app name, their
   email, audience **External**. Under **Audience**, add their own Google address as a **test user** (while the app is
   in "Testing", only test users can sign in).
4. **Client.** Open https://console.cloud.google.com/auth/clients/create, application type **Desktop app**, create it,
   and download its JSON. (A **Web application** client also works; then add the Redirect URI the dialog shows as an
   authorized redirect URI.)
5. **In Colonia.** Open [Resources › Integrations](colonia:resources/integrations) › **YouTube**, upload the JSON (or
   type the client id and secret), and press **Sign in with Google**. Google warns that the app is not verified:
   **Advanced** › **Go to (app name)** is expected for one's own app. They must pick the Google account (or brand
   account) that owns the channel.

## What to tell the owner

- **Testing mode: the sign-in ends after 7 days.** To stop that, in **Audience** press **Publish app** ("In
  production"). For personal use no verification is needed: the "unverified app" warning stays, and Google caps an
  unverified app at 100 users. This may change; check the Audience page.
- **Quota:** 10,000 units a day per project, free. Listing costs 1 unit a call; a reply to a comment costs 50. That is
  about 200 replies a day at most.
- The permission asked is `youtube.force-ssl`: see and manage the YouTube account. Colonia uses it to list the
  channel's videos, read comment threads and reply to comments. It does not upload videos.
- A channel with comments turned off, or a video made for kids, has no comments to read.

Official pages: https://developers.google.com/youtube/v3/getting-started and
https://developers.google.com/youtube/v3/determine_quota_cost
