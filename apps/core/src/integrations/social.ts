// The owner's own developer apps for X, LinkedIn and Meta (Facebook Pages and Instagram). Colonia ships no app of its
// own for these networks: the owner makes one in each network's console (the colonia-social guide walks them through
// it) and its credentials stay in the secret store. X and LinkedIn sign in with an OAuth code flow that returns to the
// panel (/oauth/social), like Google; Meta takes a token from its Graph API Explorer, because Facebook Login refuses a
// plain-http loopback return address once an app is live.
import crypto, { randomUUID } from "node:crypto";
import type { Store } from "../domain/store.ts";
import type { Secrets } from "../secrets.ts";
import { pkce, stateSigner } from "./google-oauth.ts";

/** The panel route X and LinkedIn redirect to: the address the owner registers in their app. */
export const SOCIAL_OAUTH_PATH = "/oauth/social";
const FLOW_TTL_MS = 10 * 60_000;

export const SOCIAL = [
  { id: "x", label: "X", description: "Your X account: your posts and their numbers, replies, and posting." },
  {
    id: "meta",
    label: "Facebook and Instagram",
    description: "Your Facebook Pages and Instagram professional accounts: posts, numbers, comments and publishing.",
  },
  { id: "linkedin", label: "LinkedIn", description: "Publish posts on your LinkedIn profile." },
  {
    id: "tiktok",
    label: "TikTok",
    description: "Send videos to your TikTok account: as drafts, or as private posts until TikTok reviews your app.",
  },
] as const;

export type SocialId = (typeof SOCIAL)[number]["id"];
export type SignInId = "x" | "linkedin" | "tiktok";
export const isSocialId = (id: string): id is SocialId => SOCIAL.some((s) => s.id === id);
export const signsIn = (id: string): id is SignInId => id === "x" || id === "linkedin" || id === "tiktok";
/** The networks whose access lasts hours and is renewed with a refresh token that is spent on use. */
type Rotating = "x" | "tiktok";
const labelOf = (id: SocialId) => SOCIAL.find((s) => s.id === id)?.label ?? id;

export const X_API = "https://api.x.com/2";
export const LINKEDIN_API = "https://api.linkedin.com/v2";
export const GRAPH = "https://graph.facebook.com/v27.0";
export const TIKTOK_API = "https://open.tiktokapis.com/v2";

/**
 * X wants PKCE and the client in a Basic header; LinkedIn has no PKCE and takes the secret in the form. TikTok (its
 * Login Kit for desktop, the kind that accepts a loopback return address) wants PKCE with the challenge in hex, calls
 * the client id `client_key`, separates scopes with commas and takes the secret in the form.
 */
const PROVIDERS: Record<SignInId, { auth: string; token: string; scopes: string[]; pkce: boolean }> = {
  x: {
    auth: "https://x.com/i/oauth2/authorize",
    token: `${X_API}/oauth2/token`,
    scopes: ["tweet.read", "tweet.write", "users.read", "offline.access"],
    pkce: true,
  },
  linkedin: {
    auth: "https://www.linkedin.com/oauth/v2/authorization",
    token: "https://www.linkedin.com/oauth/v2/accessToken",
    scopes: ["openid", "profile", "w_member_social"],
    pkce: false,
  },
  tiktok: {
    auth: "https://www.tiktok.com/v2/auth/authorize/",
    token: `${TIKTOK_API}/oauth/token/`,
    scopes: ["user.info.basic", "video.upload", "video.publish"],
    pkce: true,
  },
};

/** A post as the tools show it; the network's own numbers ride along under their names. */
export type SocialPost = { id: string; [field: string]: string | number | undefined };
export type SocialComment = {
  id: string;
  author?: string | undefined;
  text?: string | undefined;
  at?: string | undefined;
  likes?: number | undefined;
  replies?: number | undefined;
};
export type MetaPage = { id: string; name: string; instagram?: { id: string; username: string } | undefined };
type Profile = { id: string; name?: string | undefined; username?: string | undefined };
type Answer = { status: number; data: unknown; headers: Headers };
type CallOptions = {
  method?: string;
  query?: Record<string, string | number | undefined>;
  /** A JSON body. */
  body?: unknown;
  /** A form body (the Graph API's own shape). */
  form?: Record<string, string | undefined>;
  headers?: Record<string, string>;
  /** The call posts as the owner: a lost answer may still have gone through. */
  write?: boolean;
  /** Hand back a refusal (other than a lost sign-in) for the caller to read, instead of throwing it. */
  keep?: boolean;
};

/** The network's own words for a refusal: one line, capped. */
export function reason(data: unknown, status: number): string {
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const nested = d.error && typeof d.error === "object" ? (d.error as Record<string, unknown>).message : undefined;
  const first = Array.isArray(d.errors) ? (d.errors[0] as Record<string, unknown> | undefined)?.message : undefined;
  const text = [nested, d.error_description, d.detail, d.message, first, d.title, d.error].find(
    (v) => typeof v === "string" && v,
  );
  return typeof text === "string" ? text.replace(/\s+/g, " ").slice(0, 300) : `HTTP ${status}`;
}

export type Social = ReturnType<typeof createSocial>;

export function createSocial(deps: {
  store: Store;
  secrets: Secrets;
  /** This core's own loopback address (the port it listens on). */
  origin: () => string;
  /** Whether the owner turned an integration off in a project. */
  offIn: (project: string, id: SocialId) => boolean;
  fetch?: typeof fetch | undefined;
  now?: () => number;
  /** The pause between two looks at a video Instagram is still processing. */
  wait?: (ms: number) => Promise<void>;
}) {
  const { store, secrets } = deps;
  const now = deps.now ?? Date.now;
  const fetchImpl = deps.fetch ?? fetch;
  const signer = stateSigner(FLOW_TTL_MS, now);
  const flows = new Map<string, { id: SignInId; verifier: string; redirect: string; exp: number }>();
  const access = new Map<Rotating, { token: string; exp: number }>();
  const refreshing = new Map<Rotating, Promise<string>>();

  const clientIdKey = (id: SocialId) => `social_client_id:${id}`;
  const secretName = (id: SocialId) => `${id}-client_secret`;
  const accountKey = (id: SocialId) => `social_account:${id}`;
  const refreshName = (id: Rotating) => `${id}-refresh_token`;
  const LINKEDIN_TOKEN = "linkedin-access_token";
  const LINKEDIN_EXP = "social_expires:linkedin";
  const pageSecret = (page: string) => `meta-page_${page}`;
  const redirectUri = () => `${deps.origin().replace(/\/$/, "")}${SOCIAL_OAUTH_PATH}`;
  const again = (id: SocialId) => `sign in again in Resources › Integrations (${labelOf(id)})`;

  const stored = <T>(id: SocialId): T | undefined => {
    try {
      const raw = store.settings.get(accountKey(id));
      return raw ? (JSON.parse(raw) as T) : undefined;
    } catch {
      return undefined;
    }
  };
  const creds = (id: SignInId) => {
    const clientId = store.settings.get(clientIdKey(id));
    const clientSecret = secrets.resolve(`secret://${secretName(id)}`);
    return clientId && clientSecret ? { clientId, clientSecret } : undefined;
  };

  async function send(label: string, url: URL | string, o: CallOptions, bearer?: string): Promise<Answer> {
    const u = new URL(url);
    for (const [k, v] of Object.entries(o.query ?? {}))
      if (v !== undefined && v !== "") u.searchParams.set(k, String(v));
    const form = o.form
      ? new URLSearchParams(Object.entries(o.form).filter((e): e is [string, string] => e[1] !== undefined)).toString()
      : undefined;
    const body = form ?? (o.body !== undefined ? JSON.stringify(o.body) : undefined);
    let res: Response;
    try {
      res = await fetchImpl(u, {
        method: o.method ?? "GET",
        headers: {
          ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
          ...(body ? { "content-type": form ? "application/x-www-form-urlencoded" : "application/json" } : {}),
          ...o.headers,
        },
        ...(body ? { body } : {}),
        signal: AbortSignal.timeout(30_000),
        redirect: "error",
      });
    } catch {
      throw new Error(
        o.write
          ? `${label}: no answer. It may have gone through anyway: check before trying again`
          : `${label}: no answer`,
      );
    }
    const text = await res.text();
    let data: unknown = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      // Not JSON: the status says enough.
    }
    return { status: res.status, data, headers: res.headers };
  }
  const ok = (a: Answer) => a.status >= 200 && a.status < 300;

  /** A token request of the code flow; a 400 or 401 is the network refusing the code, the client or the refresh token. */
  async function tokenRequest(
    id: SignInId,
    c: { clientId: string; clientSecret: string },
    params: Record<string, string>,
  ) {
    const basic = Buffer.from(`${encodeURIComponent(c.clientId)}:${encodeURIComponent(c.clientSecret)}`).toString(
      "base64",
    );
    const form =
      id === "x"
        ? params
        : id === "tiktok"
          ? { ...params, client_key: c.clientId, client_secret: c.clientSecret }
          : { ...params, client_id: c.clientId, client_secret: c.clientSecret };
    const a = await send(labelOf(id), PROVIDERS[id].token, {
      method: "POST",
      form,
      ...(id === "x" ? { headers: { authorization: `Basic ${basic}` } } : {}),
    });
    if (!ok(a)) throw new Error(`${labelOf(id)} refused the sign-in: ${reason(a.data, a.status)}`);
    return a.data as { access_token?: string; refresh_token?: string; expires_in?: number; open_id?: string };
  }

  async function rotatingToken(id: Rotating): Promise<string> {
    const held = access.get(id);
    if (held && held.exp - 60_000 > now()) return held.token;
    // X and TikTok spend a refresh token on use: two refreshes at once would void the sign-in.
    const pending = refreshing.get(id);
    if (pending) return pending;
    const label = labelOf(id);
    const p = (async () => {
      const c = creds(id);
      const rt = secrets.resolve(`secret://${refreshName(id)}`);
      if (!c || !rt) throw new Error(`${label} is not connected; connect it in Resources › Integrations`);
      let got: Awaited<ReturnType<typeof tokenRequest>>;
      try {
        got = await tokenRequest(id, c, { grant_type: "refresh_token", refresh_token: rt });
      } catch (e) {
        if (e instanceof Error && e.message.includes("refused"))
          throw new Error(`${label} no longer accepts the sign-in; ${again(id)}`);
        throw e;
      }
      if (!got.access_token) throw new Error(`${label} sent no access; ${again(id)}`);
      if (got.refresh_token) secrets.set(refreshName(id), got.refresh_token);
      access.set(id, { token: got.access_token, exp: now() + (Number(got.expires_in) || 7200) * 1000 });
      return got.access_token;
    })().finally(() => refreshing.delete(id));
    refreshing.set(id, p);
    return p;
  }

  const s = {
    redirectUri,
    wait: deps.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))),
    connected(id: SocialId): boolean {
      if (id === "x" || id === "tiktok") return secrets.has(`secret://${refreshName(id)}`);
      if (id === "linkedin") return secrets.has(`secret://${LINKEDIN_TOKEN}`);
      return s.pages().length > 0;
    },
    /** Its tools are offered in a thread: connected, and not turned off in the thread's project. */
    usable: (id: SocialId, project: string | undefined) => s.connected(id) && !(project && deps.offIn(project, id)),
    /** The app's id as the panel may see it, and only whether its secret is stored. */
    client: (id: SocialId) => ({
      client_id: store.settings.get(clientIdKey(id)) || undefined,
      secret: secrets.has(`secret://${secretName(id)}`),
    }),
    /** Who is signed in on X, LinkedIn or TikTok. */
    profile: (id: SignInId) => (s.connected(id) ? stored<Profile>(id) : undefined),
    /** The Facebook Pages reached, each with the Instagram account linked to it. */
    pages: (): MetaPage[] =>
      (stored<{ pages?: MetaPage[] }>("meta")?.pages ?? []).filter((p) => secrets.has(`secret://${pageSecret(p.id)}`)),
    /** What the panel shows next to "Connected". */
    account(id: SocialId): string | undefined {
      if (id === "meta")
        return (
          s
            .pages()
            .map((p) => p.name)
            .join(", ") || undefined
        );
      const p = s.profile(id);
      return p?.username ? `@${p.username}` : p?.name;
    },

    /** The consent URL. What is typed is saved; empty keeps what is stored. */
    start(id: SignInId, values: { client_id?: string | undefined; client_secret?: string | undefined }): string {
      const typedId = values.client_id?.trim();
      const typedSecret = values.client_secret?.trim();
      if (typedId) store.settings.set(clientIdKey(id), typedId);
      if (typedSecret) secrets.set(secretName(id), typedSecret);
      const c = creds(id);
      if (!c) throw new Error(`${labelOf(id)} needs the client id and the client secret of your own app`);
      for (const [k, f] of flows) if (f.exp < now()) flows.delete(k);
      const nonce = randomUUID();
      const { verifier, challenge } = pkce();
      const redirect = redirectUri();
      flows.set(nonce, { id, verifier, redirect, exp: now() + FLOW_TTL_MS });
      const p = PROVIDERS[id];
      const u = new URL(p.auth);
      u.searchParams.set("response_type", "code");
      u.searchParams.set(id === "tiktok" ? "client_key" : "client_id", c.clientId);
      u.searchParams.set("redirect_uri", redirect);
      u.searchParams.set("scope", p.scopes.join(id === "tiktok" ? "," : " "));
      u.searchParams.set("state", signer.sign({ id, nonce }));
      if (p.pkce) {
        // TikTok's desktop kit hashes the verifier to hex, not to base64url.
        const hex = crypto.createHash("sha256").update(verifier).digest("hex");
        u.searchParams.set("code_challenge", id === "tiktok" ? hex : challenge);
        u.searchParams.set("code_challenge_method", "S256");
      }
      return u.toString();
    },

    /** Whether a returning `state` is one this module signed (Google signs its own). */
    owns: (state: string) => signer.verify(state) !== undefined,

    /** The code the network sent back: a state this core signed in the last minutes, used once. */
    async finish(code: string, state: string): Promise<{ id: SignInId; account: string | undefined }> {
      const data = signer.verify(state);
      const flow = data?.nonce ? flows.get(data.nonce) : undefined;
      if (!data || !flow || flow.id !== data.id || flow.exp < now())
        throw new Error("this sign-in link is not valid or expired; start it again from Colonia");
      flows.delete(data.nonce ?? "");
      const id = flow.id;
      const c = creds(id);
      if (!c) throw new Error(`the ${labelOf(id)} app is gone; enter it again`);
      const got = await tokenRequest(id, c, {
        grant_type: "authorization_code",
        code,
        redirect_uri: flow.redirect,
        ...(PROVIDERS[id].pkce ? { code_verifier: flow.verifier } : {}),
      });
      if (!got.access_token) throw new Error(`${labelOf(id)} sent no access`);
      if (id === "x") {
        if (!got.refresh_token)
          throw new Error(
            "X sent nothing to stay signed in with; the app must be a web app or bot (confidential client)",
          );
        const me = await send("X", `${X_API}/users/me`, {}, got.access_token);
        const user = (me.data as { data?: Profile }).data;
        if (!ok(me) || !user?.id) throw new Error(`X: ${reason(me.data, me.status)}`);
        secrets.set(refreshName("x"), got.refresh_token);
        store.settings.set(accountKey("x"), JSON.stringify({ id: user.id, name: user.name, username: user.username }));
        access.set("x", { token: got.access_token, exp: now() + (Number(got.expires_in) || 7200) * 1000 });
      } else if (id === "tiktok") {
        if (!got.refresh_token) throw new Error("TikTok sent nothing to stay signed in with; sign in again");
        const me = await send(
          "TikTok",
          `${TIKTOK_API}/user/info/`,
          { query: { fields: "open_id,display_name" } },
          got.access_token,
        );
        if (!ok(me)) throw new Error(`TikTok: ${reason(me.data, me.status)}`);
        const user = (me.data as { data?: { user?: { open_id?: string; display_name?: string } } }).data?.user;
        secrets.set(refreshName("tiktok"), got.refresh_token);
        store.settings.set(
          accountKey("tiktok"),
          JSON.stringify({ id: user?.open_id ?? got.open_id ?? "", name: user?.display_name }),
        );
        access.set("tiktok", { token: got.access_token, exp: now() + (Number(got.expires_in) || 7200) * 1000 });
      } else {
        const me = await send("LinkedIn", `${LINKEDIN_API}/userinfo`, {}, got.access_token);
        const user = me.data as { sub?: string; name?: string };
        if (!ok(me) || !user.sub) throw new Error(`LinkedIn: ${reason(me.data, me.status)}`);
        secrets.set(LINKEDIN_TOKEN, got.access_token);
        store.settings.set(LINKEDIN_EXP, String(now() + (Number(got.expires_in) || 5_184_000) * 1000));
        store.settings.set(accountKey("linkedin"), JSON.stringify({ id: user.sub, name: user.name }));
      }
      return { id, account: s.account(id) };
    },

    /**
     * Meta: the app's id and secret trade the short-lived token of the Graph API Explorer for the lasting token of
     * each Page. Only those Page tokens are kept; the app secret and the owner's own token are used once.
     */
    async connectMeta(values: Record<string, string>): Promise<void> {
      const appId = values.app_id?.trim();
      const appSecret = values.app_secret?.trim();
      const userToken = values.user_token?.trim();
      if (!appId || !appSecret || !userToken)
        throw new Error("Meta needs the app id, the app secret and the access token");
      const long = await send("Meta", `${GRAPH}/oauth/access_token`, {
        query: {
          grant_type: "fb_exchange_token",
          client_id: appId,
          client_secret: appSecret,
          fb_exchange_token: userToken,
        },
      });
      const lasting = (long.data as { access_token?: string }).access_token;
      if (!ok(long) || !lasting) throw new Error(`Meta: ${reason(long.data, long.status)}`);
      const got = await send(
        "Meta",
        `${GRAPH}/me/accounts`,
        { query: { fields: "id,name,access_token,instagram_business_account{id,username}", limit: 100 } },
        lasting,
      );
      if (!ok(got)) throw new Error(`Meta: ${reason(got.data, got.status)}`);
      type Row = {
        id?: string;
        name?: string;
        access_token?: string;
        instagram_business_account?: { id?: string; username?: string };
      };
      const rows = ((got.data as { data?: Row[] }).data ?? []).filter(
        (r) => r.id && /^\d+$/.test(r.id) && r.access_token,
      );
      if (!rows.length)
        throw new Error(
          "Meta: this token reaches no Facebook Page; generate it again and pick your Pages when Facebook asks",
        );
      s.disconnect("meta");
      const pages: MetaPage[] = rows.map((r) => {
        secrets.set(pageSecret(r.id ?? ""), r.access_token ?? "");
        const ig = r.instagram_business_account;
        return {
          id: r.id ?? "",
          name: r.name ?? r.id ?? "",
          ...(ig?.id ? { instagram: { id: ig.id, username: ig.username ?? ig.id } } : {}),
        };
      });
      store.settings.set(clientIdKey("meta"), appId);
      store.settings.set(accountKey("meta"), JSON.stringify({ pages }));
    },

    disconnect(id: SocialId): void {
      if (id === "meta")
        for (const p of stored<{ pages?: MetaPage[] }>("meta")?.pages ?? []) secrets.set(pageSecret(p.id), null);
      if (id === "x" || id === "tiktok") {
        secrets.set(refreshName(id), null);
        access.delete(id);
      }
      if (id === "linkedin") {
        secrets.set(LINKEDIN_TOKEN, null);
        store.settings.set(LINKEDIN_EXP, "");
      }
      secrets.set(secretName(id), null);
      store.settings.set(clientIdKey(id), "");
      store.settings.set(accountKey(id), "");
    },

    /** A call to X, LinkedIn or TikTok as the owner. X's and TikTok's access lasts hours: a refused one is minted again once. */
    async call(id: SignInId, url: string, o: CallOptions = {}): Promise<Answer> {
      const label = labelOf(id);
      const token = async () => {
        if (id === "x" || id === "tiktok") return rotatingToken(id);
        const t = secrets.resolve(`secret://${LINKEDIN_TOKEN}`);
        if (!t) throw new Error("LinkedIn is not connected; connect it in Resources › Integrations");
        if (Number(store.settings.get(LINKEDIN_EXP)) < now())
          throw new Error(`LinkedIn's sign-in lasts 60 days and has ended; ${again("linkedin")}`);
        return t;
      };
      let a = await send(label, url, o, await token());
      if (a.status === 401 && (id === "x" || id === "tiktok")) {
        access.delete(id);
        a = await send(label, url, o, await token());
      }
      if (a.status === 401) throw new Error(`${label} no longer accepts the sign-in; ${again(id)}`);
      if (!ok(a) && !o.keep) throw new Error(`${label}: ${reason(a.data, a.status)}`);
      return a;
    },

    /**
     * A plain request with no sign-in (fetching a video, sending its bytes to an upload address the network gave),
     * through the same fetch as every call. A lost answer of a write may still have gone through.
     */
    async transfer(label: string, url: string, init: RequestInit & { write?: boolean } = {}): Promise<Response> {
      const { write, ...rest } = init;
      try {
        return await fetchImpl(url, { signal: AbortSignal.timeout(5 * 60_000), redirect: "follow", ...rest });
      } catch {
        throw new Error(
          write
            ? `${label}: no answer. It may have gone through anyway: check before trying again`
            : `${label}: no answer`,
        );
      }
    },

    /** A Graph API call with the token of one Page. */
    async graph(page: string, path: string, o: CallOptions = {}): Promise<Answer> {
      const token = secrets.resolve(`secret://${pageSecret(page)}`);
      if (!token) throw new Error("Facebook and Instagram are not connected; connect them in Resources › Integrations");
      const a = await send("Meta", `${GRAPH}/${path}`, o, token);
      if (!ok(a)) throw new Error(`Meta: ${reason(a.data, a.status)}`);
      return a;
    },
  };
  return s;
}
