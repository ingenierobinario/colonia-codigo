---
name: colonia-variables
description: Colonia's variables, its store for API keys, tokens and other secrets, used as secret://NAME by MCP servers, engines and channels. Use it when the owner asks to create, rename, check or remove a variable, an env var or an API key, or gives you a key to keep.
---

# Variables in Colonia

A variable is a named secret in Colonia's own store (the macOS Keychain, or a private file on other systems). Things that
need a key name it as `secret://NAME`, and Colonia puts the value in only when it starts them: MCP servers (`--env`,
`--header`), engines and channels. You never see a value, and none ever goes in a prompt, a log, a file or a chat.

The owner sees and edits them in [Resources › Variables](colonia:resources/variables). You use the `colonia secrets` command
through `shell`. Never keep a key anywhere else: not in a file, `.env`, `~/.colonia/vars.json` (the old Colonia v1, which this
Colonia does not read), a note, a memory, a task or your answer.

## Names

Letters, digits, `_`, `.` and `-`, starting with a letter or digit, at most 64. UPPER_SNAKE reads best
(`GITHUB_TOKEN`, `MAGIC_API_KEY`). If the owner gave a name, use exactly that one.

## Commands

```bash
colonia secrets list                 # names and when each changed (never values)
colonia secrets rm NAME              # removes it: whatever names it stops working
```

Storing a value, only when the owner gave it to you and asked you to keep it:

```bash
printf %s "$VALUE" | colonia secrets set NAME
```

The value goes on stdin, never as an argument. Prefer that the owner types it themselves in
[Resources › Variables](colonia:resources/variables): a value you pass stays in this chat's history.

## A variable the owner will fill in

A variable cannot be empty. When the owner says they will set the value later, do not store a placeholder: use
`secret://NAME` where it is needed (for example in `colonia mcps add`), then send them
[Resources › Variables](colonia:resources/variables) with the exact name to create. Until then whatever uses it fails to
authenticate.

## Per project

A project can have its own value for a variable: it wins over the global one for the owner's MCP servers inside that
project (another account per client, for example). The owner sets it in the project's Resources › Variables.

## Renaming

There is no rename: the owner creates the new one, you point everything at it (`colonia mcps set <server> --env
KEY=secret://NEW` or `--header …`), check it works, then remove the old one with the owner's OK.

## Tell the owner

Which name you used and where it is used. Never repeat a value, not even partly.
