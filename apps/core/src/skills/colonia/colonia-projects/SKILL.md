---
name: colonia-projects
description: Create a project in Colonia, rename one or change its kind or description, list them, or add an existing folder as one, with the `colonia projects` command. Use it whenever the owner asks for a new project, workspace or client, or to rename or reorganize their projects.
---

# Projects in Colonia

A project is a folder with an `AGENTS.md` and a `.apc/` folder: its agents, skills, memory, tasks and routines live
there. Colonia knows a project only once it is registered, which the `colonia projects` command does (run it with `shell`;
the owner approves each call). **Never make one by writing files yourself**: a folder you make by hand is not in Colonia
until it is registered, and `.apc/project.json` is Colonia's to write.

## Commands

```bash
colonia projects                                   # id, name and kind of each project ("!" = its folder is missing)
colonia projects create "Northwind"                # a new folder of its own in Colonia's home
colonia projects create "Northwind" --kind company --desc "Wholesale client: orders and invoices"
colonia projects create "Acme site" --path ~/work/acme-site --kind software   # in that folder (made if missing)
colonia projects register ~/work/existing-repo     # a folder that already has AGENTS.md or .apc/
colonia projects set <project-id> --name "Northwind Ltd" --desc "…"           # only what you give changes
colonia projects set <project-id> --desc ""        # an empty value removes the description
colonia projects set <project-id> --autonomy manual # how far its agents go without asking (only when the owner asks)
colonia projects folders add <project-id> ~/work/other-repo   # a folder its agents may read, never change (owner's OK)
# (an agent reading outside its project raises the owner's card for that by itself: no need to run this then)
```

- The mode is one of `manual` (asks before every change), `auto` (the default: reads anywhere but Colonia's home, works
  in the project without asking, asks only for messages, payments, deleting and writing outside), `accept_edits` (as
  auto, but commands that change something ask), `plan` (reads and proposes, changes nothing) and `total`. Agents
  with none of their own take the project's.

- Kind is one of `personal`, `app`, `company`, `software`, `other`. A company gets areas and roles for its agents;
  software is a code repository.
- `--path` is for a folder the owner names (an existing repo, a client's folder). Without it the project gets a
  folder of its own; do not invent a path.
- `register` takes a folder that already is a project (it has `AGENTS.md` or `.apc/`). For a plain folder use
  `create --path`, which writes a short `AGENTS.md` and an empty `.apc/` there and touches nothing else. Run
  `colonia projects` first and never create again a project already in the list.
- The default project (no folder) cannot be renamed here; the owner does it in the app.

## After creating one

Tell the owner its name and id, and link it: `[Northwind](colonia:project/<project-id>)`. A new project has no agents.
To make new ones there, call `agent_set` with `project: "<project-id>"`: without it an agent goes to this chat's
project, or is global when the chat has none. Its answer says where it landed; tell the owner exactly that.
To bring the team of another project, clone it (never recreate agents one by one with `agent_set`):

```bash
colonia agents                                             # ids, to pick the agents to copy
colonia agents clone <agent-id>… --project <new-project-id> --rename [--under <slug of its boss there>]
```

An agent belongs to one project, so a copy is a new agent with the whole definition (role, prompt, tools, skills,
model). `--rename` gives each copy a new free name, so the two teams read apart; ask the owner if they want that.
Reports stay under their cloned boss; routines and memory are not copied. The owner can do the same from the
project's Agents › Import › Another project.

## Removing

`colonia projects rm <project-id>` only makes Colonia forget the project; its folder and files stay. Do it only when the owner
asks for that exact project, and say the folder was not touched. Deleting the folder is never yours to do.
