// The owner's X account over the X API v2: their recent posts with the numbers, the replies to one, a new post and a
// reply. Every read and every post is billed by X to the owner's own developer account.
import { type Social, type SocialComment, type SocialPost, X_API } from "./social.ts";

const ID = /^[0-9]{1,19}$/;
const id = (v: string, what: string) => {
  if (!ID.test(v)) throw new Error(`X: ${what} must be the numeric id of a post`);
  return v;
};

type Metrics = { like_count?: number; reply_count?: number; retweet_count?: number; impression_count?: number };
type Post = { id?: string; text?: string; created_at?: string; author_id?: string; public_metrics?: Metrics };
type List = { data?: Post[]; includes?: { users?: Array<{ id?: string; username?: string }> } };

export function xApi(social: Social) {
  const me = () => {
    const p = social.profile("x");
    if (!p) throw new Error("X is not connected; connect it in Resources › Integrations");
    return p;
  };
  const link = (post: string) => `https://x.com/${me().username ?? "i"}/status/${post}`;

  return {
    async posts(limit: number): Promise<SocialPost[]> {
      const a = await social.call("x", `${X_API}/users/${me().id}/tweets`, {
        query: {
          // X accepts 5 to 100 a page.
          max_results: Math.min(100, Math.max(5, limit)),
          exclude: "replies,retweets",
          "tweet.fields": "created_at,public_metrics",
        },
      });
      return ((a.data as List).data ?? []).slice(0, limit).map((p) => ({
        id: p.id ?? "",
        text: p.text,
        at: p.created_at,
        url: link(p.id ?? ""),
        views: p.public_metrics?.impression_count,
        likes: p.public_metrics?.like_count,
        replies: p.public_metrics?.reply_count,
        reposts: p.public_metrics?.retweet_count,
      }));
    },

    /** The replies of the last seven days: X's recent search reaches no further back. */
    async comments(post: string, limit: number): Promise<SocialComment[]> {
      const a = await social.call("x", `${X_API}/tweets/search/recent`, {
        query: {
          query: `conversation_id:${id(post, "post")}`,
          max_results: Math.min(100, Math.max(10, limit)),
          "tweet.fields": "created_at,public_metrics,author_id",
          expansions: "author_id",
          "user.fields": "username",
        },
      });
      const list = a.data as List;
      const names = new Map((list.includes?.users ?? []).map((u) => [u.id, u.username]));
      return (list.data ?? []).slice(0, limit).map((p) => ({
        id: p.id ?? "",
        author: names.get(p.author_id),
        text: p.text,
        at: p.created_at,
        likes: p.public_metrics?.like_count,
        replies: p.public_metrics?.reply_count,
      }));
    },

    async publish(text: string, replyTo?: string): Promise<{ id: string; url: string }> {
      const a = await social.call("x", `${X_API}/tweets`, {
        method: "POST",
        body: { text, ...(replyTo ? { reply: { in_reply_to_tweet_id: id(replyTo, "to") } } : {}) },
        write: true,
      });
      const made = (a.data as { data?: { id?: string } }).data?.id;
      if (!made) throw new Error("X answered without the new post; check the account before trying again");
      return { id: made, url: link(made) };
    },
  };
}
