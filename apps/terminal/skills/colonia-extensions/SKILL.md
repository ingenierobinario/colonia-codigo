---
name: colonia-extensions
description: Builds an Colonia extension — one folder with an `colonia-extension.json` that brings skills, MCP servers, routine templates, secrets the owner types once and, optionally, a sandboxed plugin — then checks and installs it with `colonia extensions inspect|install|on`. Also says when an extension is the wrong tool (a project skill, an agent template, a plain MCP server). Triggers: 'Colonia extension', 'make an extension for Colonia', 'colonia-extension.json', 'Colonia plugin', 'package skills for Colonia', 'add an MCP to Colonia as an extension'.
homepage: https://github.com/ingenierobinario/colonia
---

# Building an Colonia extension

An extension is a folder Colonia can read **without running anything**: a manifest (`colonia-extension.json`) plus the files
it names. It installs **off**; turning it on approves exactly those files.

## Pick the smallest thing first

| The owner wants | Make |
|---|---|
| Know-how for this one project's agents | A skill in the project: `.apc/skills/<name>/SKILL.md` — no extension |
| One more MCP server for their own agents | `colonia mcps add <name> <command…|url>` — no extension |
| An agent (or a team) with its own routines | An agent template: `<slug>.md` + `<slug>.routines.json` |
| Skills, servers and routines that travel together, shared or reused | **An extension** |
| Code that watches events or adds context to the owner's turns | An extension with a `plugin` |

## The folder

```
northwind-crm/
  colonia-extension.json
  skills/
    crm-lookup/SKILL.md        # each skill: a folder with a SKILL.md (frontmatter name + description)
  server.mjs                   # only if an MCP server runs from the folder ("./server.mjs")
  plugin.mjs                   # only if there is a plugin
```

## `colonia-extension.json`

Unknown keys are refused (the schema is strict).

```json
{
  "id": "northwind_crm",
  "name": "Northwind CRM",
  "version": "1.0.0",
  "description": "Look up customers and open deals in Northwind's CRM.",
  "skills": "skills",
  "mcp": {
    "crm": {
      "command": "node",
      "args": ["./server.mjs"],
      "env": { "CRM_TOKEN": "secret://token" }
    },
    "docs": { "url": "https://mcp.example.com/docs", "headers": { "Authorization": "Bearer secret://token" } }
  },
  "routines": [
    {
      "name": "Monday pipeline",
      "schedule": { "kind": "cron", "cron": "0 9 * * 1" },
      "prompt": "Use the crm-lookup skill to list deals that did not move last week. Answer SKIP if none."
    }
  ],
  "secrets": [{ "name": "token", "label": "CRM API token", "url": "https://example.com/settings/tokens" }]
}
```

| Field | Rules |
|---|---|
| `id` | Lowercase letters, digits, `_` and `-`, starting with a letter or digit, at most 20. |
| `name`, `version`, `description` | Required name and version; description up to 500 characters. |
| `skills` | A folder of skill folders, relative to the extension. |
| `mcp` | Servers by name (letters, digits, `_`; **no `-`**, at most 20). Either `command` + `args` + `env`, or `url` + `headers`. A command starting with `./` runs from the extension's folder. |
| `secret://name` | The extension's own secret `name`, declared under `secrets`. `env:` references are not allowed. Never put a real value in the manifest. |
| `routines` | Templates the owner adds from Routines (they pick the agent). `schedule`: `{ "kind": "cron", "cron" }`, `{ "kind": "every", "minutes" }` (5 or more) or `{ "kind": "once", "at" }`. A routine that answers `SKIP` tells nobody. |
| `secrets` | Up to 10: `name` (same rule as servers), `label`, optional `url` where to get it. The owner types the value once. |
| `plugin` | See below. |

## A plugin (only when files are not enough)

```json
"plugin": { "entry": "plugin.mjs", "observe": ["task.updated"], "context": false, "network": false }
```

```js
// plugin.mjs — runs in its own process; reads only its folder, writes only api.dataDir.
export default function activate(api) {
  api.on("task.updated", (event) => api.log(`task ${event.task?.id} changed`));
  api.context(async ({ thread, agent, text }) => "");   // only with "context": true; return "" to add nothing
}
```

- `observe`: any of `thread.updated`, `message.created`, `run.updated`, `task.updated`, `notification.updated`.
- `api.secrets.<name>` holds its declared secrets; `api.fetch` reaches the internet only with `"network": true`, the
  local network and the tailnet only with `"local_network": true` as well, and never this machine (Colonia's own port
  included). It cannot start processes or call Colonia.
- What `context` returns reaches the agent as **outside data**, not instructions. One extension at a time may add
  context.

## Check, install, turn on

```bash
colonia extensions inspect ./northwind-crm        # what it would bring; nothing is installed
colonia extensions install ./northwind-crm        # copied in, off
colonia extensions secret northwind_crm token     # the value on stdin, never as an argument
colonia extensions on northwind_crm
colonia extensions                                # installed ones and whether they are on
```

Changing the folder after installing does nothing: install it again. Settings › Extensions in the app shows the same.

## Before you hand it over

- `inspect` passes and lists every skill, server, routine and secret you meant.
- No real token, email, phone or machine path in any file: secrets go through `secret://`, examples use
  `user@example.com` and `~/work/…`.
- Skills, prompts and descriptions are in English; Colonia translates its own UI.
- Each skill's `description` says when to use it, so agents load it only then.
