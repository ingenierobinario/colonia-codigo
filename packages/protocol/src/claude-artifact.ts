/** Only artifact viewer addresses can become Claude applications. Chats and sign-in redirects are separate pages. */
export function claudeArtifactUrl(raw: string): string | undefined {
  const url = URL.parse(raw);
  if (!url || url.origin !== "https://claude.ai" || url.username || url.password) return;
  if (!/^\/(?:code\/artifacts?|(?:public\/)?artifacts)\/[a-zA-Z0-9_-]{8,128}\/?$/.test(url.pathname)) return;
  return url.origin + url.pathname.replace(/\/$/, "");
}

const prefix = '<meta name="colonia-claude-artifact" content="';

export function claudeArtifactPage(url: string): string {
  const link = claudeArtifactUrl(url);
  if (!link) throw new Error("Se necesita el enlace del artefacto de Claude.");
  return prefix + link + '"><a href="' + link + '" target="_blank" rel="noopener noreferrer">Claude</a>';
}

export function linkedClaudeArtifact(html: string): string | undefined {
  if (!html.startsWith(prefix)) return;
  const end = html.indexOf('"', prefix.length);
  return end < 0 ? undefined : claudeArtifactUrl(html.slice(prefix.length, end));
}
