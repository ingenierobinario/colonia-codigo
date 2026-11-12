// The owner's TikTok account over the Content Posting API: who is signed in and what TikTok lets them post, a video
// sent to their TikTok inbox as a draft (they finish and post it in the app) or posted straight away, and where a sent
// video is. Until TikTok audits the owner's app, everything it posts is private (SELF_ONLY) and the account itself
// must be private: TikTok says so in its own refusal, and the tools say it in plain words.
import { reason, type Social, TIKTOK_API } from "./social.ts";

/** Colonia fetches the video and sends its bytes: no domain to verify with TikTok. Bigger files are refused. */
export const TIKTOK_MAX_BYTES = 512 * 1024 * 1024;
/** One piece up to 64 MB; above, pieces of 10 MB with the remainder in the last one (TikTok takes 5 to 64 MB). */
const SINGLE_MAX = 64 * 1024 * 1024;
const CHUNK = 10 * 1024 * 1024;
const TYPES = ["video/mp4", "video/quicktime", "video/webm"];

export type TikTokMode = "draft" | "private";
export type TikTokCreator = {
  username?: string | undefined;
  nickname?: string | undefined;
  privacy: string[];
  max_seconds?: number | undefined;
};
export type TikTokStatus = {
  publish_id: string;
  status: string;
  fail_reason?: string | undefined;
  post_ids: string[];
};

const PUBLISH_ID = /^[\w.~-]{1,64}$/;

/** The refusals worth saying in plain words; the rest go out in TikTok's own. */
const PLAIN: Record<string, string> = {
  unaudited_client_can_only_post_to_private_accounts:
    "TikTok only lets an app it has not reviewed post on a private account. Make the account private in the TikTok app (Settings › Privacy), or send the video as a draft",
  privacy_level_option_mismatch: "TikTok does not offer private posting on this account right now; send it as a draft",
  spam_risk_too_many_posts: "TikTok says this account has posted too much today; try again tomorrow",
  scope_not_authorized: "the TikTok sign-in lacks a permission; sign in again in Resources › Integrations (TikTok)",
  url_ownership_unverified: "TikTok only pulls videos from a site verified in the app's settings",
};

/** Data, or TikTok's refusal: it answers 200 with `error.code` "ok" when all went well. */
function body<T>(data: unknown, status: number): T {
  const err = (data as { error?: { code?: string } }).error;
  if (err?.code && err.code !== "ok") throw new Error(`TikTok: ${PLAIN[err.code] ?? reason(data, status)}`);
  if (status < 200 || status >= 300) throw new Error(`TikTok: ${reason(data, status)}`);
  return ((data as { data?: T }).data ?? {}) as T;
}

/** How TikTok wants the bytes cut: the count, and each piece's first and last byte. */
export function chunks(size: number): {
  chunk_size: number;
  total_chunk_count: number;
  ranges: Array<[number, number]>;
} {
  if (size <= SINGLE_MAX) return { chunk_size: size, total_chunk_count: 1, ranges: [[0, size - 1]] };
  const count = Math.floor(size / CHUNK);
  const ranges: Array<[number, number]> = [];
  for (let i = 0; i < count; i++) ranges.push([i * CHUNK, i === count - 1 ? size - 1 : (i + 1) * CHUNK - 1]);
  return { chunk_size: CHUNK, total_chunk_count: count, ranges };
}

export function tiktokApi(social: Social) {
  const signedIn = () => {
    if (!social.profile("tiktok")) throw new Error("TikTok is not connected; connect it in Resources › Integrations");
  };
  const post = async <T>(path: string, json: unknown, write = false) => {
    const a = await social.call("tiktok", `${TIKTOK_API}${path}`, {
      method: "POST",
      body: json,
      headers: { "content-type": "application/json; charset=UTF-8" },
      write,
      keep: true,
    });
    return body<T>(a.data, a.status);
  };

  async function creator(): Promise<TikTokCreator> {
    signedIn();
    const d = await post<{
      creator_username?: string;
      creator_nickname?: string;
      privacy_level_options?: string[];
      max_video_post_duration_sec?: number;
    }>("/post/publish/creator_info/query/", {});
    return {
      username: d.creator_username,
      nickname: d.creator_nickname,
      privacy: d.privacy_level_options ?? [],
      max_seconds: d.max_video_post_duration_sec,
    };
  }

  async function download(url: string): Promise<{ bytes: Buffer; type: string }> {
    const res = await social.transfer("TikTok: the video", url);
    if (!res.ok) throw new Error(`TikTok: the video could not be fetched (HTTP ${res.status})`);
    const declared = Number(res.headers.get("content-length"));
    if (declared > TIKTOK_MAX_BYTES) throw new Error("TikTok: the video is over 512 MB; send a smaller file");
    // Read in pieces and stop at the limit: a server that does not say the size cannot fill the core's memory.
    const parts: Buffer[] = [];
    let total = 0;
    if (res.body) {
      for await (const piece of res.body as AsyncIterable<Uint8Array>) {
        total += piece.length;
        if (total > TIKTOK_MAX_BYTES) throw new Error("TikTok: the video is over 512 MB; send a smaller file");
        parts.push(Buffer.from(piece));
      }
    }
    const bytes = Buffer.concat(parts);
    if (!bytes.length) throw new Error("TikTok: the video address gave an empty file");
    if (bytes.length > TIKTOK_MAX_BYTES) throw new Error("TikTok: the video is over 512 MB; send a smaller file");
    const given = (res.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
    const byName = /\.mov(\?|$)/i.test(url)
      ? "video/quicktime"
      : /\.webm(\?|$)/i.test(url)
        ? "video/webm"
        : "video/mp4";
    return { bytes, type: TYPES.includes(given) ? given : byName };
  }

  return {
    creator,

    /**
     * Sends a video. "draft" lands in the owner's TikTok inbox to finish and post there; "private" posts it now, seen
     * only by the owner (all an app TikTok has not audited may do). `pull` lets TikTok fetch the address itself, for
     * a site verified in the app; otherwise Colonia fetches the file and uploads it.
     */
    async send(o: { video_url: string; mode: TikTokMode; title?: string | undefined; pull?: boolean | undefined }) {
      signedIn();
      if (o.mode === "draft" && o.title)
        throw new Error("TikTok: a draft takes no caption; the owner writes it in the TikTok app, or post it private");
      if (o.mode === "private") {
        const c = await creator();
        if (!c.privacy.includes("SELF_ONLY")) throw new Error(`TikTok: ${PLAIN.privacy_level_option_mismatch}`);
      }
      const file = o.pull ? undefined : await download(o.video_url);
      const cut = file ? chunks(file.bytes.length) : undefined;
      const source_info = file
        ? {
            source: "FILE_UPLOAD",
            video_size: file.bytes.length,
            chunk_size: cut?.chunk_size,
            total_chunk_count: cut?.total_chunk_count,
          }
        : { source: "PULL_FROM_URL", video_url: o.video_url };
      const init = await post<{ publish_id?: string; upload_url?: string }>(
        o.mode === "draft" ? "/post/publish/inbox/video/init/" : "/post/publish/video/init/",
        o.mode === "draft"
          ? { source_info }
          : {
              post_info: { privacy_level: "SELF_ONLY", ...(o.title ? { title: o.title } : {}) },
              source_info,
            },
        true,
      );
      if (!init.publish_id) throw new Error("TikTok answered without an id; check the TikTok app before trying again");
      if (file && cut) {
        if (!init.upload_url) throw new Error("TikTok gave no upload address; try again");
        const total = file.bytes.length;
        for (const [first, lastByte] of cut.ranges) {
          const piece = file.bytes.subarray(first, lastByte + 1);
          const res = await social.transfer("TikTok: the upload", init.upload_url, {
            method: "PUT",
            headers: {
              "content-type": file.type,
              "content-length": String(piece.length),
              "content-range": `bytes ${first}-${lastByte}/${total}`,
            },
            body: piece,
            write: true,
          });
          if (!res.ok) throw new Error(`TikTok refused the upload (HTTP ${res.status}); start again`);
        }
      }
      return { publish_id: init.publish_id };
    },

    /** Where a sent video is: processing, in the inbox, posted, or failed (and why). */
    async status(publishId: string): Promise<TikTokStatus> {
      signedIn();
      if (!PUBLISH_ID.test(publishId)) throw new Error("TikTok: publish_id must be the id a send gave");
      const d = await post<{
        status?: string;
        fail_reason?: string;
        publicaly_available_post_id?: Array<string | number>;
      }>("/post/publish/status/fetch/", { publish_id: publishId });
      return {
        publish_id: publishId,
        status: d.status ?? "UNKNOWN",
        ...(d.fail_reason ? { fail_reason: d.fail_reason } : {}),
        post_ids: (d.publicaly_available_post_id ?? []).map(String),
      };
    },
  };
}
