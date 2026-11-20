// A stdio server that is only a bridge to a remote one (`npx -y mcp-remote https://… [--header "K: v"]`): Colonia
// keeps running it as written, since mcp-remote is what signs the owner in through their browser, but knows which
// remote it reaches and whose it is, to say so in the panel.

export type Bridge = { url: string; headers: Record<string, string>; provider: string };

/** Runners that fetch a package and run it. */
const RUNNER = /^(?:.*[\\/])?(?:npx|bunx|pnpx)(?:\.cmd|\.exe)?$/i;
/** mcp-remote, pinned or under a scope (`mcp-remote@0.1.29`, `@someone/mcp-remote`). */
const PACKAGE = /^(?:@[\w.-]+\/)?mcp-remote(?:@[\w.^~<>=-]+)?$/i;

/** The remote a definition bridges to, when it is one; never a command that does something else. */
export function remoteBridge(command: string | undefined, args: readonly string[]): Bridge | undefined {
  if (!command) return undefined;
  let rest = [...args];
  if (/^(?:.*[\\/])?pnpm(?:\.cmd|\.exe)?$/i.test(command) && rest[0] === "dlx") rest = rest.slice(1);
  else if (!RUNNER.test(command)) return undefined;
  while (rest[0] && /^-(?:y|-yes|q|-quiet)$/.test(rest[0])) rest = rest.slice(1);
  if (!rest[0] || !PACKAGE.test(rest[0])) return undefined;
  const url = rest[1];
  if (!url || !/^https?:\/\/[^\s]+$/i.test(url)) return undefined;
  const headers: Record<string, string> = {};
  for (let i = 2; i < rest.length; i++) {
    if (rest[i] !== "--header") continue;
    const m = /^([^:\s]+):\s*(.*)$/.exec(rest[i + 1] ?? "");
    if (m?.[1]) headers[m[1]] = m[2] ?? "";
    i++;
  }
  return { url, headers, provider: providerOf(url) };
}

const KNOWN: Array<[RegExp, string]> = [
  [/(?:^|\.)(?:facebook|instagram|meta|whatsapp)\.com$/, "Meta"],
  [/(?:^|\.)(?:google|googleapis)\.com$/, "Google"],
  [/(?:^|\.)(?:microsoft|office|live|azure)\.com$/, "Microsoft"],
  [/(?:^|\.)linkedin\.com$/, "LinkedIn"],
  [/(?:^|\.)github\.com$/, "GitHub"],
  [/(?:^|\.)atlassian\.(?:com|net)$/, "Atlassian"],
  [/(?:^|\.)notion\.(?:com|so)$/, "Notion"],
];

/** Whose a remote is, in the owner's words: the company for well-known ones, else its domain. */
export function providerOf(url: string): string {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return url;
  }
  for (const [re, name] of KNOWN) if (re.test(host)) return name;
  const parts = host.split(".");
  const name = parts.length > 1 ? (parts.at(-2) ?? host) : host;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** Whether a start may first download its program (npx and the like), which takes far longer than an answer. */
export const downloads = (command: string | undefined) =>
  Boolean(command && (RUNNER.test(command) || /^(?:.*[\\/])?(?:pnpm|uvx|uv)(?:\.cmd|\.exe)?$/i.test(command)));
