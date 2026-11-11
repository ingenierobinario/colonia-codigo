// The owner's YouTube channel over the Data API v3, with the Google sign-in of the "youtube" integration: their recent
// videos with the numbers, the comments of one, and a reply to a comment. No upload: a video is a local file, which
// these calls (JSON in, JSON out) do not carry.
import type { Google } from "./google.ts";
import type { SocialComment, SocialPost } from "./social.ts";

const num = (v: unknown) => (v === undefined || v === null || v === "" ? undefined : Number(v));
/** A video or comment id: the letters YouTube mints, nothing that could bend a query. */
const ID = /^[\w.-]{1,120}$/;

type Channels = {
  items?: Array<{
    id?: string;
    snippet?: { title?: string; customUrl?: string };
    contentDetails?: { relatedPlaylists?: { uploads?: string } };
  }>;
};
type PlaylistItems = { items?: Array<{ contentDetails?: { videoId?: string } }> };
type Videos = {
  items?: Array<{
    id?: string;
    snippet?: { title?: string; publishedAt?: string };
    statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
  }>;
};
type Threads = {
  items?: Array<{
    snippet?: {
      totalReplyCount?: number;
      topLevelComment?: {
        id?: string;
        snippet?: {
          authorDisplayName?: string;
          textDisplay?: string;
          textOriginal?: string;
          publishedAt?: string;
          likeCount?: number;
        };
      };
    };
  }>;
};

export function youtubeApi(g: Google) {
  const call = <T>(path: string, o: Parameters<Google["call"]>[2] = {}) =>
    g.call<T>("youtube", `${g.endpoints.youtube}/${path}`, o);
  const y = {
    /** The channel of the signed-in account, and the playlist that holds what it uploaded. */
    async channel(): Promise<{ id: string; name: string; handle: string | undefined; uploads: string }> {
      const r = await call<Channels>("channels", { query: { part: "snippet,contentDetails", mine: true } });
      const c = r.items?.[0];
      const uploads = c?.contentDetails?.relatedPlaylists?.uploads;
      if (!c?.id || !uploads) throw new Error("YouTube: this Google account has no channel");
      return { id: c.id, name: c.snippet?.title ?? c.id, handle: c.snippet?.customUrl, uploads };
    },

    /** The latest uploads, newest first, each with its views, likes and comments. */
    async posts(limit: number): Promise<SocialPost[]> {
      const { uploads } = await y.channel();
      const list = await call<PlaylistItems>("playlistItems", {
        query: { part: "contentDetails", playlistId: uploads, maxResults: limit },
      });
      const ids = (list.items ?? []).flatMap((i) => (i.contentDetails?.videoId ? [i.contentDetails.videoId] : []));
      if (!ids.length) return [];
      const videos = await call<Videos>("videos", { query: { part: "snippet,statistics", id: ids.join(",") } });
      const byId = new Map((videos.items ?? []).map((v) => [v.id, v]));
      // videos.list answers in its own order: keep the playlist's, newest first.
      return ids.flatMap((id) => {
        const v = byId.get(id);
        if (!v) return [];
        return [
          {
            id,
            text: v.snippet?.title,
            at: v.snippet?.publishedAt,
            url: `https://www.youtube.com/watch?v=${id}`,
            views: num(v.statistics?.viewCount),
            likes: num(v.statistics?.likeCount),
            comments: num(v.statistics?.commentCount),
          },
        ];
      });
    },

    /** The newest comments of a video; each id is what a reply answers. */
    async comments(video: string, limit: number): Promise<SocialComment[]> {
      if (!ID.test(video)) throw new Error("YouTube: that is not a video id");
      const r = await call<Threads>("commentThreads", {
        query: { part: "snippet", videoId: video, maxResults: limit, order: "time", textFormat: "plainText" },
      });
      return (r.items ?? []).flatMap((t) => {
        const top = t.snippet?.topLevelComment;
        if (!top?.id) return [];
        return [
          {
            id: top.id,
            author: top.snippet?.authorDisplayName,
            text: top.snippet?.textOriginal ?? top.snippet?.textDisplay,
            at: top.snippet?.publishedAt,
            likes: top.snippet?.likeCount,
            replies: t.snippet?.totalReplyCount,
          },
        ];
      });
    },

    /** Answers a comment as the channel. */
    async reply(comment: string, text: string): Promise<{ id: string }> {
      if (!ID.test(comment)) throw new Error("YouTube: that is not a comment id");
      const r = await call<{ id?: string }>("comments", {
        method: "POST",
        query: { part: "snippet" },
        body: { snippet: { parentId: comment, textOriginal: text } },
      });
      return { id: r.id ?? "" };
    },
  };
  return y;
}
