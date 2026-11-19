/** The same browser sign-in command is used for catalog and custom connectors. */
export function browserLoginMcp(url: string) {
  return { command: "npx", args: ["-y", "mcp-remote", url], env: {} };
}

/** Only collapse the simple form. Commands with extra flags or variables keep their full editor. */
export function browserLoginUrl(def?: {
  command?: string | undefined;
  args: string[];
  env: Record<string, string>;
  headers: Record<string, string>;
}) {
  if (
    def?.command !== "npx" ||
    def.args.length !== 3 ||
    def.args[0] !== "-y" ||
    def.args[1] !== "mcp-remote" ||
    Object.keys(def.env).length ||
    Object.keys(def.headers).length
  )
    return;
  const url = URL.parse(def.args[2] ?? "");
  if (url?.protocol === "https:" && !url.username && !url.password) return def.args[2];
}
