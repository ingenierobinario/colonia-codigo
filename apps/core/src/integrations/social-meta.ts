// The owner's Facebook Pages and the Instagram professional accounts linked to them, over the Graph API with each
// Page's own token: recent posts with the numbers, comments, publishing and replying.
import type { MetaPage, Social, SocialComment, SocialPost } from "./social.ts";

export type MetaNetwork = "facebook" | "instagram";
const ID = /^[0-9_]{1,80}$/;
const id = (v: string, what: string) => {
  if (!ID.test(v)) throw new Error(`Meta: ${what} must be an id as the lists give it`);
  return v;
};
const count = (v: unknown) => (v as { summary?: { total_count?: number } } | undefined)?.summary?.total_count;
const rows = <T>(data: unknown) => (data as { data?: T[] }).data ?? [];
/** Instagram takes a minute or more to process a video: how often and how long to look. */
const POLL_MS = 10_000;
const POLLS = 30;

export function metaApi(social: Social) {
  /** The Page (or the Page whose Instagram account) the agent named; the only one when it named none. */
  function pick(network: MetaNetwork, account: string | undefined): MetaPage & { target: string } {
    const all = social.pages().filter((p) => network === "facebook" || p.instagram);
    if (!all.length)
      throw new Error(
        network === "instagram"
          ? "no Instagram professional account is linked to the connected Facebook Pages"
          : "Facebook and Instagram are not connected; connect them in Resources › Integrations",
      );
    const name = (p: MetaPage) => (network === "instagram" ? (p.instagram?.username ?? "") : p.name);
    const want = account?.trim().replace(/^@/, "").toLowerCase();
    const found = want
      ? all.filter((p) => [p.id, p.instagram?.id, p.name, p.instagram?.username].some((v) => v?.toLowerCase() === want))
      : all;
    const page = found.length === 1 ? found[0] : undefined;
    if (!page) throw new Error(`say which account: ${all.map(name).join(", ")}`);
    return { ...page, target: network === "instagram" ? (page.instagram?.id ?? "") : page.id };
  }

  return {
    async posts(network: MetaNetwork, account: string | undefined, limit: number): Promise<SocialPost[]> {
      const p = pick(network, account);
      if (network === "instagram") {
        const a = await social.graph(p.id, `${p.target}/media`, {
          query: { fields: "id,caption,media_type,permalink,timestamp,like_count,comments_count", limit },
        });
        type Media = {
          id?: string;
          caption?: string;
          media_type?: string;
          permalink?: string;
          timestamp?: string;
          like_count?: number;
          comments_count?: number;
        };
        return rows<Media>(a.data).map((m) => ({
          id: m.id ?? "",
          text: m.caption,
          at: m.timestamp,
          url: m.permalink,
          kind: m.media_type,
          likes: m.like_count,
          comments: m.comments_count,
        }));
      }
      const a = await social.graph(p.id, `${p.target}/feed`, {
        query: {
          fields:
            "id,message,created_time,permalink_url,shares,likes.summary(true).limit(0),comments.summary(true).limit(0)",
          limit,
        },
      });
      type Post = {
        id?: string;
        message?: string;
        created_time?: string;
        permalink_url?: string;
        shares?: { count?: number };
        likes?: unknown;
        comments?: unknown;
      };
      return rows<Post>(a.data).map((m) => ({
        id: m.id ?? "",
        text: m.message,
        at: m.created_time,
        url: m.permalink_url,
        likes: count(m.likes),
        comments: count(m.comments),
        shares: m.shares?.count,
      }));
    },

    async comments(
      network: MetaNetwork,
      account: string | undefined,
      post: string,
      limit: number,
    ): Promise<SocialComment[]> {
      const p = pick(network, account);
      const fields =
        network === "instagram"
          ? "id,text,timestamp,username,like_count"
          : "id,message,created_time,from{name},like_count,comment_count";
      const a = await social.graph(p.id, `${id(post, "post")}/comments`, { query: { fields, limit } });
      type Row = {
        id?: string;
        text?: string;
        message?: string;
        timestamp?: string;
        created_time?: string;
        username?: string;
        from?: { name?: string };
        like_count?: number;
        comment_count?: number;
      };
      return rows<Row>(a.data).map((c) => ({
        id: c.id ?? "",
        author: c.username ?? c.from?.name,
        text: c.text ?? c.message,
        at: c.timestamp ?? c.created_time,
        likes: c.like_count,
        replies: c.comment_count,
      }));
    },

    async publish(
      network: MetaNetwork,
      account: string | undefined,
      post: { text: string; link?: string | undefined; image_url?: string | undefined; video_url?: string | undefined },
    ): Promise<{ id: string; url?: string | undefined }> {
      const p = pick(network, account);
      if (network === "facebook") {
        if (post.video_url)
          throw new Error("a video on a Facebook Page is not supported; post text, a link or an image");
        const a = post.image_url
          ? await social.graph(p.id, `${p.target}/photos`, {
              method: "POST",
              form: { url: post.image_url, caption: post.text },
              write: true,
            })
          : await social.graph(p.id, `${p.target}/feed`, {
              method: "POST",
              form: { message: post.text, link: post.link },
              write: true,
            });
        const made = a.data as { id?: string; post_id?: string };
        const postId = made.post_id ?? made.id;
        if (!postId) throw new Error("Meta answered without the new post; check the Page before trying again");
        return { id: postId, url: `https://www.facebook.com/${postId}` };
      }
      if (!post.image_url && !post.video_url)
        throw new Error("Instagram needs image_url or video_url: it has no text-only posts");
      // Not yet public: a refusal here posted nothing.
      const made = await social.graph(p.id, `${p.target}/media`, {
        method: "POST",
        form: post.video_url
          ? { media_type: "REELS", video_url: post.video_url, caption: post.text }
          : { image_url: post.image_url, caption: post.text },
      });
      const container = (made.data as { id?: string }).id;
      if (!container) throw new Error("Instagram did not take the media");
      for (let i = 0; ; i++) {
        const st = (await social.graph(p.id, container, { query: { fields: "status_code,status" } })).data as {
          status_code?: string;
          status?: string;
        };
        if (st.status_code === "FINISHED") break;
        if (st.status_code === "ERROR" || st.status_code === "EXPIRED")
          throw new Error(`Instagram could not process the media: ${(st.status ?? st.status_code).slice(0, 200)}`);
        if (i >= POLLS) throw new Error("Instagram is still processing the media; nothing was published");
        await social.wait(POLL_MS);
      }
      const done = await social.graph(p.id, `${p.target}/media_publish`, {
        method: "POST",
        form: { creation_id: container },
        write: true,
      });
      const mediaId = (done.data as { id?: string }).id;
      if (!mediaId) throw new Error("Instagram answered without the new post; check the account before trying again");
      let url: string | undefined;
      try {
        url = ((await social.graph(p.id, mediaId, { query: { fields: "permalink" } })).data as { permalink?: string })
          .permalink;
      } catch {
        // Published all the same: the link is a courtesy.
      }
      return { id: mediaId, url };
    },

    async reply(network: MetaNetwork, account: string | undefined, to: string, text: string): Promise<{ id: string }> {
      const p = pick(network, account);
      const a = await social.graph(p.id, `${id(to, "to")}/${network === "instagram" ? "replies" : "comments"}`, {
        method: "POST",
        form: { message: text },
        write: true,
      });
      const made = (a.data as { id?: string }).id;
      if (!made) throw new Error("Meta answered without the reply; check before trying again");
      return { id: made };
    },
  };
}
