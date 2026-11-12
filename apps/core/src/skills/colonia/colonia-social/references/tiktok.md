# TikTok: the owner's own app

Cost: free. Time: about 20 minutes, plus TikTok's review of the app if the owner later wants public posts. What it
gives: **sending a video to the owner's TikTok**, either as a **draft** (it lands in their TikTok inbox; they add the
caption and sound and post it from the TikTok app) or as a **private post** (published at once, seen only by them).
Reading posts, numbers or comments is not available here.

Say this up front, in plain words: **TikTok does not let a new app post anything public.** Until TikTok reviews
(audits) the owner's app, every post the app makes is private, and direct posting only works on a private account.
Drafts are the practical way: Colonia sends the video, the owner presses Post in TikTok and chooses who sees it there.

1. **Developer account.** Open https://developers.tiktok.com and **Log in** with the owner's TikTok account (or sign
   up there). Accept the developer terms.
2. **App.** Go to **Manage apps** (https://developers.tiktok.com/apps/) and press **Connect an app**. Give it a name
   (any, for example "Colonia de <their business>"), an icon (any square image), a category, and a short description
   ("Sends my own videos to my TikTok account"). Terms of service and privacy policy addresses are asked for: their
   own website's pages are fine.
3. **Platform.** Under **Platforms** tick **Desktop**. (Not Web: TikTok's Web kit only accepts `https` return
   addresses, and Colonia's runs on this computer.)
4. **Products.** Press **Add products** and add **Login Kit** and **Content Posting API**.
   - In **Login Kit**, under **Redirect URI** for Desktop, add the **Redirect URI the dialog shows** in Colonia,
     exactly as written (it is `http://127.0.0.1:<port>/oauth/social`).
   - In **Content Posting API**, turn on **Direct Post** if they want private posting; drafts work without it.
5. **Scopes.** Under **Scopes** make sure **user.info.basic**, **video.upload** and **video.publish** are there.
6. **Sandbox, to use it now.** A new app is not live yet. In the app's top bar switch to **Sandbox** (create one if
   asked), and under **Target users** add the owner's own TikTok account. In sandbox the app works only for those
   accounts, which is all Colonia needs.
7. **Keys.** In the app (the Sandbox one, if they use it) open **Credentials** (or **App details**): copy the
   **Client key** and **Client secret**.
8. **In Colonia.** Open [Resources › Integrations](colonia:resources/integrations) › **TikTok**, type the client key and
   the client secret, press **Sign in**, and allow in the TikTok page that opens.
9. **Check.** Call `social_accounts`: TikTok should be listed. Then send a short test video as a draft with
   `tiktok_send` and follow it with `tiktok_status` until it says `SEND_TO_USER_INBOX`.

## What to tell the owner

- **Drafts**: they get a notice in the TikTok app; the caption is written there, not in Colonia.
- **Private posts**: only for a private account while the app is not reviewed (TikTok › Settings and privacy ›
  Privacy › Private account). The post is seen only by them; they can change who sees it later in TikTok.
- **Public posts** need TikTok's review of the app: in the app's page press **Submit for review**, explain the use
  (posting their own videos from their own computer) and show a short screen recording of the sign-in and a send.
  TikTok decides; it can take days or weeks, and nothing in Colonia changes after it.
- The video must be at a public https address (MP4, MOV or WebM, up to 512 MB). Colonia downloads it and uploads it,
  so no site needs verifying with TikTok.
- The sign-in renews itself; if it stops (unused for about six months, or removed in TikTok), sign in again.
- If TikTok refuses the redirect address in step 4, tell the owner exactly what it says and stop: Colonia's address
  has not been tried against a real TikTok app.

Official pages: https://developers.tiktok.com/doc/login-kit-desktop,
https://developers.tiktok.com/doc/oauth-user-access-token-management,
https://developers.tiktok.com/doc/content-posting-api-reference-upload-video and
https://developers.tiktok.com/doc/content-posting-api-reference-direct-post
