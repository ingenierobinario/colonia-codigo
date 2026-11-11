// The owner's LinkedIn profile: publishing a post, with or without a link. Reading posts, numbers and comments needs
// permissions LinkedIn grants only to approved partners, so this integration does not read.
import { LINKEDIN_API, type Social } from "./social.ts";

export function linkedinApi(social: Social) {
  return {
    async publish(text: string, link?: string): Promise<{ id: string; url: string | undefined }> {
      const me = social.profile("linkedin");
      if (!me) throw new Error("LinkedIn is not connected; connect it in Resources › Integrations");
      const a = await social.call("linkedin", `${LINKEDIN_API}/ugcPosts`, {
        method: "POST",
        headers: { "x-restli-protocol-version": "2.0.0" },
        body: {
          author: `urn:li:person:${me.id}`,
          lifecycleState: "PUBLISHED",
          specificContent: {
            "com.linkedin.ugc.ShareContent": {
              shareCommentary: { text },
              shareMediaCategory: link ? "ARTICLE" : "NONE",
              ...(link ? { media: [{ status: "READY", originalUrl: link }] } : {}),
            },
          },
          visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
        },
        write: true,
      });
      const made = a.headers.get("x-restli-id") ?? (a.data as { id?: string }).id;
      if (!made) throw new Error("LinkedIn answered without the new post; check the profile before trying again");
      return { id: made, url: `https://www.linkedin.com/feed/update/${made}/` };
    },
  };
}
