// MULTI-CUENTA-1: a channel kind holds as many accounts as the owner connects (two Telegram bots, three Slack
// workspaces). A screen works on one of them, chosen by its id; the kind only says which accounts it lists.

type Account = { id: string; type: string; label: string; account?: string | undefined };

/** The accounts of a kind, in the order the core lists them. */
export const accountsOf = <T extends Account>(channels: readonly T[], kind: string): T[] =>
  channels.filter((c) => c.type === kind);

/** The account a screen shows: the one chosen by id, the first one while none is (or once the chosen one is gone). */
export const pickAccount = <T extends Account>(accounts: readonly T[], selected: string): T | undefined =>
  accounts.find((c) => c.id === selected) ?? accounts[0];

/** The id of a new account: the kind itself for the first one (as always), the kind and a random tail after it. */
export function newAccountId(
  kind: string,
  taken: readonly string[],
  random: () => string = () => crypto.randomUUID(),
): string {
  if (!taken.includes(kind)) return kind;
  for (;;) {
    const id = `${kind}-${random().replaceAll("-", "").slice(0, 16)}`;
    if (!taken.includes(id)) return id;
  }
}

/** How an account reads in a list: its name, and what it is connected as when that says more. */
export const accountLabel = (c: Account): string =>
  c.account && c.account !== c.label ? `${c.label} · ${c.account}` : c.label;
