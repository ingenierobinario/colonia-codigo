// colonia clients: outside apps (Claude Code, Codex…) that talk to Colonia with their own token.
import type { ClientScope } from "@colonia/protocol";
import type { ColoniaClient } from "@colonia/protocol/client";

const USAGE = `colonia clients                              Connected apps
colonia clients add <name> [--scopes chat,browser]   A token for one (shown once)
colonia clients rm <id>`;

export async function clients(client: ColoniaClient, [sub, arg]: string[], opts: { scopes?: string | undefined }) {
  if (sub === "add" && arg) {
    const scopes = (opts.scopes ?? "chat").split(",").map((s) => s.trim()) as ClientScope[];
    const r = await client.call("clients.create", { name: arg, scopes });
    console.log(`${r.client.id}  ${r.client.name}  · ${r.client.scopes.join(", ")}`);
    console.log("\nToken (shown only now; it lets this app act as a model within its scopes, never as you):");
    console.log(r.token);
    console.log("\nFor Claude Code:");
    console.log(`  claude mcp add colonia -e COLONIA_CLIENT_TOKEN=<token> -- colonia mcp`);
    return;
  }
  if (sub === "rm" && arg) {
    console.log((await client.call("clients.revoke", { id: arg })).revoked ? "revoked" : "no such client");
    return;
  }
  if (sub) throw new Error(USAGE);
  const { clients: list } = await client.call("clients.list", {});
  for (const c of list)
    console.log(
      `${c.id}  ${c.name}  · ${c.scopes.join(", ")}  · ${c.last_used_at ? `used ${new Date(c.last_used_at).toLocaleString()}` : "never used"}`,
    );
  if (!list.length) console.log(`(no connected apps)\n\n${USAGE}`);
}
