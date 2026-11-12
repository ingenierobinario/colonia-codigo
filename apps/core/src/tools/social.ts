// The owner's own social accounts as Colonia tools: YouTube (through the Google sign-in), X, Facebook Pages and
// Instagram (one Meta connection) and LinkedIn. Each tool is offered only while a network it can serve is connected and
// on in the thread's project. Posts and comments are other people's words: they come back as outside data. Publishing
// and replying always wait for the owner.
import { z } from "zod";
import type { Google } from "../integrations/google.ts";
import type { Social } from "../integrations/social.ts";
import { linkedinApi } from "../integrations/social-linkedin.ts";
import { metaApi } from "../integrations/social-meta.ts";
import { tiktokApi } from "../integrations/social-tiktok.ts";
import { xApi } from "../integrations/social-x.ts";
import { youtubeApi } from "../integrations/youtube.ts";
import { untrusted } from "./result.ts";
import { defineTool, type Tool } from "./types.ts";

const lines = (rows: unknown[]) => rows.map((r) => JSON.stringify(r)).join("\n");
const Account = z.string().max(120).optional().describe("which Page or Instagram account, when several");
const Limit = z.number().int().min(1).max(50).default(10);
const HttpsUrl = z.url({ protocol: /^https$/ }).max(2000);
type Thread = { project_id?: string | undefined };

export function socialTools(social: Social, g: Google | undefined): Tool[] {
  const x = xApi(social);
  const meta = metaApi(social);
  const linkedin = linkedinApi(social);
  const tiktok = tiktokApi(social);
  const youtube = g ? youtubeApi(g) : undefined;
  const on = {
    youtube: (t: Thread) => Boolean(g?.usable("youtube", t.project_id)),
    x: (t: Thread) => social.usable("x", t.project_id),
    meta: (t: Thread) => social.usable("meta", t.project_id),
    linkedin: (t: Thread) => social.usable("linkedin", t.project_id),
    tiktok: (t: Thread) => social.usable("tiktok", t.project_id),
  };
  const reads = (t: Thread) => on.youtube(t) || on.x(t) || on.meta(t);
  const any = (t: Thread) => reads(t) || on.linkedin(t) || on.tiktok(t);
  const publishes = (t: Thread) => on.x(t) || on.meta(t) || on.linkedin(t);
  /** A network the owner has not connected, or turned off here, is refused by name. */
  const need = (network: string, t: Thread) => {
    const key = network === "facebook" || network === "instagram" ? "meta" : (network as keyof typeof on);
    if (!on[key](t)) throw new Error(`${network} is not connected for this project (Resources › Integrations)`);
  };
  const tube = () => {
    if (!youtube) throw new Error("YouTube is not connected");
    return youtube;
  };

  return [
    defineTool({
      name: "social_accounts",
      description: "List the owner's connected social accounts and what each one can do.",
      args: z.object({}),
      effect: "none",
      deadlineMs: 30_000,
      when: any,
      title: () => "Checked the social accounts",
      async run(_a, ctx) {
        const t = ctx.thread;
        const out: unknown[] = [];
        if (on.youtube(t)) {
          const c = await tube().channel();
          out.push({ network: "youtube", account: c.handle ?? c.name, can: "posts, comments, reply" });
        }
        if (on.x(t)) out.push({ network: "x", account: social.account("x"), can: "posts, comments, publish, reply" });
        if (on.meta(t))
          for (const p of social.pages()) {
            out.push({ network: "facebook", account: p.name, can: "posts, comments, publish, reply" });
            if (p.instagram)
              out.push({ network: "instagram", account: p.instagram.username, can: "posts, comments, publish, reply" });
          }
        if (on.linkedin(t)) out.push({ network: "linkedin", account: social.account("linkedin"), can: "publish" });
        if (on.tiktok(t))
          out.push({
            network: "tiktok",
            account: social.account("tiktok"),
            can: "send a video as a draft, or post it private (public needs TikTok's review of the app)",
          });
        return untrusted("social accounts", {}, lines(out));
      },
    }),
    defineTool({
      name: "social_posts",
      description:
        "List the owner's recent posts (videos on YouTube) on one network, newest first, with their numbers.",
      args: z.object({ network: z.enum(["youtube", "x", "facebook", "instagram"]), account: Account, limit: Limit }),
      effect: "none",
      deadlineMs: 60_000,
      when: reads,
      title: () => "Read the posts",
      async run(a, ctx) {
        need(a.network, ctx.thread);
        const rows =
          a.network === "youtube"
            ? await tube().posts(a.limit)
            : a.network === "x"
              ? await x.posts(a.limit)
              : await meta.posts(a.network, a.account, a.limit);
        if (!rows.length) return "no posts";
        return untrusted("social posts", { network: a.network }, lines(rows));
      },
    }),
    defineTool({
      name: "social_comments",
      description:
        "Read the comments on one of the owner's posts (id from social_posts), newest first. On X: replies of the last 7 days.",
      args: z.object({
        network: z.enum(["youtube", "x", "facebook", "instagram"]),
        post: z.string().min(1).max(120),
        account: Account,
        limit: Limit,
      }),
      effect: "none",
      deadlineMs: 60_000,
      when: reads,
      title: () => "Read the comments",
      async run(a, ctx) {
        need(a.network, ctx.thread);
        const rows =
          a.network === "youtube"
            ? await tube().comments(a.post, a.limit)
            : a.network === "x"
              ? await x.comments(a.post, a.limit)
              : await meta.comments(a.network, a.account, a.post, a.limit);
        if (!rows.length) return "no comments";
        return untrusted("social comments", { network: a.network, post: a.post }, lines(rows));
      },
    }),
    defineTool({
      name: "social_publish",
      description:
        "Publish a post as the owner. The owner confirms it first. Instagram needs image_url (JPEG) or video_url, public https; Facebook takes text, link or image_url; X and LinkedIn text (LinkedIn also link). Never retry an unknown outcome: check social_posts.",
      args: z.object({
        network: z.enum(["x", "facebook", "instagram", "linkedin"]),
        text: z.string().min(1).max(5000),
        account: Account,
        link: HttpsUrl.optional(),
        image_url: HttpsUrl.optional(),
        video_url: HttpsUrl.optional(),
      }),
      effect: "external",
      // It speaks as the owner to other people: it always waits for their OK.
      confirm: "always",
      // Instagram processes a video before it lets it out.
      deadlineMs: 6 * 60_000,
      when: publishes,
      title: () => "Published a post",
      async run(a, ctx) {
        need(a.network, ctx.thread);
        if (a.network === "x" || a.network === "linkedin") {
          if (a.image_url || a.video_url)
            throw new Error(`${a.network}: images and video are not supported here; post text`);
          if (a.network === "x") {
            const r = await x.publish(a.link ? `${a.text}\n${a.link}` : a.text);
            return `published on X: ${r.url}`;
          }
          const r = await linkedin.publish(a.text, a.link);
          return `published on LinkedIn: ${r.url ?? r.id}`;
        }
        const r = await meta.publish(a.network, a.account, a);
        return `published on ${a.network}: ${r.url ?? r.id}`;
      },
    }),
    defineTool({
      name: "social_reply",
      description:
        "Reply as the owner to a comment (id from social_comments); on X, to a post or reply. The owner confirms it first.",
      args: z.object({
        network: z.enum(["youtube", "x", "facebook", "instagram"]),
        to: z.string().min(1).max(120),
        text: z.string().min(1).max(5000),
        account: Account,
      }),
      effect: "external",
      // It speaks as the owner to other people: it always waits for their OK.
      confirm: "always",
      deadlineMs: 60_000,
      when: reads,
      title: () => "Replied to a comment",
      async run(a, ctx) {
        need(a.network, ctx.thread);
        const r =
          a.network === "youtube"
            ? await tube().reply(a.to, a.text)
            : a.network === "x"
              ? await x.publish(a.text, a.to)
              : await meta.reply(a.network, a.account, a.to, a.text);
        return `replied (${r.id})`;
      },
    }),
    defineTool({
      name: "tiktok_send",
      description:
        "Send a video (public https address of an MP4, MOV or WebM, up to 512 MB) to the owner's TikTok. mode 'draft' puts it in their TikTok inbox to finish and post in the app; 'private' posts it now, visible only to them: until TikTok reviews the owner's app nothing can be public. The owner confirms it first. Then check it with tiktok_status; never retry an unknown outcome.",
      args: z.object({
        video_url: HttpsUrl,
        mode: z.enum(["draft", "private"]).default("draft"),
        title: z.string().min(1).max(2200).optional().describe("caption, only for mode 'private'"),
        pull: z
          .boolean()
          .optional()
          .describe("let TikTok fetch the address itself (only for a site verified in the app)"),
      }),
      effect: "external",
      // It posts as the owner: it always waits for their OK.
      confirm: "always",
      deadlineMs: 15 * 60_000,
      when: (t) => on.tiktok(t),
      title: () => "Sent a video to TikTok",
      async run(a, ctx) {
        need("tiktok", ctx.thread);
        const r = await tiktok.send(a);
        return a.mode === "draft"
          ? `sent to the TikTok inbox (publish_id ${r.publish_id}): the owner gets a notice in the TikTok app to finish and post it`
          : `posted on TikTok as private, only the owner sees it (publish_id ${r.publish_id}); it may take a minute to process`;
      },
    }),
    defineTool({
      name: "tiktok_status",
      description: "Where a video sent with tiktok_send is: processing, in the inbox, posted, or failed and why.",
      args: z.object({ publish_id: z.string().min(1).max(64) }),
      effect: "none",
      deadlineMs: 30_000,
      when: (t) => on.tiktok(t),
      title: () => "Checked a TikTok video",
      async run(a, ctx) {
        need("tiktok", ctx.thread);
        return JSON.stringify(await tiktok.status(a.publish_id));
      },
    }),
  ];
}
