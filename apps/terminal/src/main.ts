#!/usr/bin/env node
import { parseArgs } from "node:util";
import { ColoniaClient, ColoniaError } from "@colonia/protocol/client";
// The terminal owns no domain logic: every command is a protocol call to the core.
import { admin, status, version, wizard } from "./commands/admin.ts";
import { agentLimits } from "./commands/agent-fields.ts";
import { artifacts } from "./commands/artifacts.ts";
import { browser } from "./commands/browser.ts";
import { channels, contacts, pairing } from "./commands/channels.ts";
import { chat } from "./commands/chat.ts";
import { clients } from "./commands/clients.ts";
import { desktop, openPanel } from "./commands/desktop.ts";
import { doctor, updateOffline } from "./commands/doctor.ts";
import { equipo } from "./commands/equipo.ts";
import { expose } from "./commands/expose.ts";
import { extensions } from "./commands/extensions.ts";
import { flows } from "./commands/flows.ts";
import { init } from "./commands/init.ts";
import { localConnection } from "./commands/local.ts";
import { logsCommand } from "./commands/logs.ts";
import { mcpCommand } from "./commands/mcp.ts";
import { image, say, transcribe } from "./commands/media.ts";
import { memory } from "./commands/memory.ts";
import { agentEdit, agentModel, models } from "./commands/models.ts";
import { news } from "./commands/news.ts";
import { notifications } from "./commands/notifications.ts";
import { org, owner, profiles } from "./commands/owner.ts";
import { pair } from "./commands/pair.ts";
import { routines } from "./commands/routines.ts";
import { service } from "./commands/service.ts";
import { adoptBundleApp } from "./commands/service-files.ts";
import { sessions } from "./commands/sessions.ts";
import { importV1, setupHeadless } from "./commands/setup.ts";
import { skillsImport } from "./commands/skills-import.ts";
import { tasks } from "./commands/tasks.ts";
import { agents, jobs, projects, runs, runtimeSkills, secrets, skills, threads, usage } from "./commands/threads.ts";
import { v1 } from "./commands/v1.ts";
import { themedCard as card, coreRefused, failure, unreachableCore } from "./presentation.ts";

const HELP = `colonia — the Colonia terminal

Usage:
  colonia                     Interactive crew console (TTY only)
  colonia --version [-v]      Local CLI version (works without the core)
  colonia status (or --status) [--json] [--plain]   Core, crew, projects, MCP, devices and access
  colonia wizard              Guided terminal setup and maintenance
  colonia open                The panel in your browser
  colonia desktop             The desktop app (downloads and opens its installer when it is not here)
  colonia upgrade [--check] [--json]   Check or apply the core's updater (a server install updates itself even when its core is down)
  colonia doctor [--json]     Why the core does not answer on this machine, and what to run next
  colonia devices [list|pair|revoke <id>] [--json]
  colonia tailscale [status|connect|off]   Expose Colonia through Tailscale (must already be logged in)
  colonia mcp tools <server> [<tool>] [--project <id>] [--scope global|project] [--json]
  colonia mcp run <server> <tool> ['{"key":"value"}'|-] [--project <id>]
  colonia mcp check <server> [--project <id>]   Connection test
  colonia mcp signin <server> [--project <id>]  Sign in to a server that asked for it
  colonia ping [text]         Round-trip over the live socket

  colonia browser tabs
  colonia browser open <url> [--profile shared|incognito|agent:<id>] [--by <agent>]
  colonia browser nav <tab> <url>
  colonia browser snapshot <tab>
  colonia browser click <tab> <ref>
  colonia browser type <tab> <ref> <text> [--submit]
  colonia browser shot <tab> <file.jpg>
  colonia browser close <tab>
  colonia browser control <tab> user|idle|done
  colonia browser cookies                          List browsers whose sessions can be imported
  colonia browser cookies <source> [filter]        Domains with cookies (counts only)
  colonia browser import <source> <domain,…> [--profile shared|agent:<id>]

  colonia chat "<text>" [--agent <id> | --thread <id>] [--new] [--detach] [--interrupt | --steer]
  colonia chat "<text>" --code [--cwd <folder>] [--write ask|auto|read-only] [--agent <id>]   Code thread
  colonia jobs [list] | get <job> | cancel <job>   Background work: agents' runs and terminal commands
  colonia skills [list] [project]   Skills agents can load ("off" marks one turned off there)
  colonia skills on|off <skill> [--project p]   Turn a skill on or off everywhere, or only in one project
  colonia skills save <skill> [--project p]     Create or replace a skill: its SKILL.md on stdin
  colonia skills import <folder|file.zip|git url> [--project p] [--only a,b] [--replace] [--yes]
                           List the skills in it (nothing runs); with --yes copy them into Colonia (or the project)
  colonia skills install-runtimes [--dry-run]
                           Refresh now the skills that teach Claude Code, Codex, Cursor and ~/.agents how to use Colonia
                           (the core does it at every start); removes ones Colonia no longer ships, never anyone else's
  colonia tasks [add|show|edit|settle|move|done|say]  The office board (colonia tasks help)
  colonia routines [add|show|edit|run|on|off|rm|log]  Scheduled work (colonia routines help)
  colonia flows [list|set|rows|events|write|retry|retire]  Webhook-only work and persistent tables (colonia flows help)
  colonia notifications [read]       What is waiting for you
  colonia news [tell [<id>…]] [--json]   Release news; tell runs the super-agent's message now
  colonia equipo [emparejar <url> <huella>|desbloquear|desconectar]  Este portátil como equipo de otro Colonia
  colonia clients [add <name>|rm <id>]  Outside apps with their own token (Claude Code, Codex…)
  colonia extensions [inspect|install|on|off|secret|rm]  Skills, MCP servers and routines in one folder
  colonia memory [words]      Notes agents keep between threads (newest first, or the best matches for the words)
  colonia memory add [global|project|agent] <text> [--project p] [--agent a]
  colonia memory edit <id> <text…>   Rewrite a note in place
  colonia memory rm <id…>     Remove notes
  colonia artifacts [list] [--project <id>] [--json]   Widgets and apps agents made
  colonia artifacts push <name> <file.html> [--title t] [--app] [--connect <origin,…>] [--project <id>]   Show a built page
  colonia artifacts dir <name> [--project <id>]   Where a built artifact keeps its source (created if missing)
  colonia artifacts export <name> [--memory] [--out <file>] [--project <id>]   Save one as an .coloniaart file
  colonia artifacts import <file.coloniaart> [--project <id>]   Load an .coloniaart file into this Colonia
  colonia sessions projects codex|claude   Claude Code or Codex projects and chats on this computer
  colonia sessions import codex|claude <project> [--only <id,…>] [--name "…"]   Bring them in as an Colonia project
  colonia sessions digest|adopt|page …     What an imported chat is about, who takes it over, its pages as widgets
  colonia channels [add|rm|outbox]   Channels (Telegram bots); colonia channels add telegram <id> --agent <a>
  colonia channels send <channel> <contact> <text…>   Write to a contact yourself, in their chat on that channel
  colonia channels recover <thread>   Ask the channel again for files that never arrived in a chat
  colonia contacts [add|block|rm]    People Colonia talks to on channels
  colonia pairing [me|ok|no <code>]  Approve who wrote to a channel
  colonia compact <thread>    Summarize a thread's older turns now (Colonia's own loop; Claude Code and Codex compact their own)
  colonia owner [set key=value…]     Who you are, for your agents: name, about, language, timezone
  colonia org [set] [--project p]    A project's areas and roles (set: JSON on stdin)
  colonia profiles [list] | use <id> [key=value…] | off | restore <routine>
                           What the super-agent is for (a profile), its settings and the routines it keeps
  colonia image "<prompt>" [--out file] [--size WxH]   Draw an image and save it
  colonia say "<text>" [--out file]    Speak text and save the audio
  colonia transcribe <audio file>      Speech to text
  colonia usage [days]        Turns and tokens by model, and whether they were included or paid per token
  colonia mcps [list [project]] | tools|run|check <server> | trust|untrust <project> <server> | add <name> <command…|url> | rm <name>
  colonia mcps on|off <server> --project p   Turn one of your servers on or off inside a project
  colonia mcps logs <server> [--project p] [-n 100]   What a server printed on stderr since the core started
                           The one way to talk to an agent. Default: Home (the secretary)
  colonia threads [list] | get <thread> [--json] | cancel <thread>
  colonia threads search <words…>   Messages with every word, best first
  colonia runs get <run> | wait <run> [--timeout 60]
  colonia runs pending [thread]   What agents are waiting on from you
  colonia runs respond <input> approve|deny ["note"] [--scope once|session|always] | "<answer>"
  colonia projects [list] | register <folder> | sync [project]
                           Projects are folders with AGENTS.md / .apc/; their agents come from those files
  colonia projects create "<Name>" [--path <folder>] [--kind personal|app|company|software|other] [--desc "…"]
                           A new project: in that folder (made if missing), else in a folder of its own in Colonia's home
  colonia projects set <project> [--name "…"] [--kind …] [--desc "…"] [--autonomy manual|auto|accept_edits|plan|total]
                           Rename it, change its kind or description, or how far its agents go without asking
  colonia projects folders list|add|rm <project> [folder]
                           Folders its agents may read and never change (another checkout, docs)
  colonia projects rm <project>   Forget a project in Colonia; its folder and files are never deleted
  colonia init [folder]       Make a folder (default: this one) an APC project and register it; writes only what is
                           missing (AGENTS.md, .apc/), never over an existing file
  colonia agents              Agents and the model each one runs on
  colonia agents show <agent>            Its fields and full prompt
  colonia agents new <slug> "<Name>" [--project <id>] [--role "<role>"]
  colonia agents set <agent> <field>=<value>…   Any field the agent editor has (an unknown one lists them all)
                           Lists as a,b (tools= is all of them); orchestrator=true|false; rules='{"write":"ask"}';
                           autonomy= or rules= go back to the default
  colonia agents set <agent> --prompt-file <file | ->   Its prompt from a file, or stdin with -
  colonia agents limits [<agent> runs=… tokens=… | <agent> clear | default runs=… tokens=…]
                           How far agents go without you in one chat: the default, and an agent's own (0 = no limit)
  colonia agents clone <agent…> [--project <id>] [--rename] [--under <slug>]
                           Copy agents (whole definition) into a project; --rename gives each a new free name
  colonia agents archive <agent>         Project agents: changes are written to .apc/agents/<slug>.md
  colonia agents archived | restore <agent>   Archived agents, and bringing one back (deleting for good is in the app)
  colonia agents model <agent> <engine/model | engine | router | default> [--router]
                           An agent's model; --router keeps the router as its fallback

  colonia models [--refresh]  Every engine and the models it offers (asked to the engine)
  colonia models config       The install default and the router
  colonia models default <engine/model | engine | router> [--router]
  colonia models chain <ref> [<ref>…]      The router's fallback chain, in order
  colonia models rules < rules.json        The router's rules (JSON on stdin)

  colonia secrets [list] | set <name> (value on stdin) | rm <name>
  colonia v1 [off]            Is Colonia v1 still here and running? off stops its daemon for good and makes colonia this one
  colonia import-v1 [--keys] [--skills] [--services]
                           Import what a local Colonia v1 holds, from its files (read-only, v1 may be stopped):
                           projects, agents, memory, chats, channels, tasks, routines (off)… --keys also copies
                           its model API keys into v2's secret store, --skills its skills, --services its
                           image engines and voices, once

  colonia service install|uninstall|status|restart
                           Run the core in the background (systemd, launchd or a Windows login entry), started at
                           login and again if it dies
  colonia service logs [-n 100] [-f]   The core's log file (<home>/logs/core.log), read on this machine only
  colonia logs [-n 100] [--level info|warn|error] [--grep text] [--scope core|output] [--json]
                           The core's log through the core (also a remote one); the file when no core answers
  colonia expose tailscale|lan|off|status
                           Who may reach the core: your tailnet (https://<machine>.ts.net), the network, or only
                           this computer. Writes <home>/core.env; restart the core afterwards
  colonia pair                A one-time code and link to connect a phone or another computer
  colonia setup --headless [--import [--keys] [--skills] [--services]] [--expose tailscale|lan]
                           A server with no desktop: service, optional import, optional exposure, then a pair code

  colonia mcp [--by <agent>]  Stdio MCP server exposing browser_* tools (for Claude Code, Codex…); with
                           COLONIA_CLIENT_TOKEN also colonia_agents / colonia_ask / colonia_read (colonia clients add <name>)
  colonia mcp --run           The tools of one agent run (COLONIA_RUN_TOKEN), for an external harness

Env: COLONIA_URL (default http://127.0.0.1:<COLONIA_PORT or 7440>), COLONIA_TOKEN (default: the one in <home>/core.env),
     COLONIA_HOME (default ~/.colonia/v2)`;

// Installed from a bundle: the service it writes and the core it starts run through that install's `current`.
adoptBundleApp(process.env, import.meta.dirname);

function argumentsOf() {
  return parseArgs({
    allowPositionals: true,
    options: {
      json: { type: "boolean" },
      status: { type: "boolean" },
      version: { type: "boolean", short: "v" },
      check: { type: "boolean" },
      plain: { type: "boolean" },
      help: { type: "boolean", short: "h" },
      profile: { type: "string" },
      by: { type: "string" },
      submit: { type: "boolean" },
      thread: { type: "string" },
      agent: { type: "string" },
      new: { type: "boolean" },
      detach: { type: "boolean" },
      interrupt: { type: "boolean" },
      steer: { type: "boolean" },
      code: { type: "boolean" },
      cwd: { type: "string" },
      write: { type: "string" },
      keys: { type: "boolean" },
      skills: { type: "boolean" },
      services: { type: "boolean" },
      refresh: { type: "boolean" },
      project: { type: "string" },
      env: { type: "string", multiple: true },
      header: { type: "string", multiple: true },
      cron: { type: "string" },
      clear: { type: "boolean" },
      scopes: { type: "string" },
      scope: { type: "string" },
      person: { type: "string" },
      owed: { type: "string" },
      due: { type: "string" },
      start: { type: "string" },
      reviewer: { type: "string" },
      every: { type: "string" },
      at: { type: "string" },
      pre: { type: "string" },
      post: { type: "string" },
      call: { type: "string" },
      name: { type: "string" },
      "prompt-file": { type: "string" },
      "max-steps": { type: "string" },
      title: { type: "string" },
      desc: { type: "string" },
      "desc-file": { type: "string" },
      tags: { type: "string" },
      role: { type: "string" },
      kind: { type: "string" },
      autonomy: { type: "string" },
      path: { type: "string" },
      rename: { type: "boolean" },
      replace: { type: "boolean" },
      yes: { type: "boolean", short: "y" },
      under: { type: "string" },
      router: { type: "boolean" },
      timeout: { type: "string" },
      run: { type: "boolean" },
      headless: { type: "boolean" },
      import: { type: "boolean" },
      expose: { type: "string" },
      home: { type: "string" },
      "dry-run": { type: "boolean" },
      out: { type: "string" },
      size: { type: "string" },
      lines: { type: "string", short: "n" },
      follow: { type: "boolean", short: "f" },
      level: { type: "string" },
      grep: { type: "string" },
      only: { type: "string" },
      app: { type: "boolean" },
      connect: { type: "string" },
      memory: { type: "boolean" },
    },
  });
}
let parsed: ReturnType<typeof argumentsOf>;
try {
  parsed = argumentsOf();
} catch (err) {
  console.error(
    failure("Invalid arguments", [err instanceof Error ? err.message : String(err), "Try: colonia --help"]),
  );
  // portable: nothing has opened a handle yet, and nothing after this may run.
  process.exit(2);
}
const { values, positionals } = parsed;
const fail = (title: string, lines: string[]) => failure(title, lines, Boolean(values.plain || values.json));
const [command, ...rest] = positionals;
const connection = localConnection();
const terminalClient = () =>
  new ColoniaClient({ ...localConnection(), client: { name: "colonia-terminal", version: "0.0.0" } });
const client = terminalClient();
/** MCP servers are driven by a model: the core never gives them the owner's controls. */
const agentClient = new ColoniaClient({
  ...connection,
  client: { name: "colonia-mcp", version: "0.0.0" },
  actor: "agent",
});

try {
  switch (values.version ? "version" : values.help ? "help" : values.status ? "status" : command) {
    case "version":
      console.log(version(values.json));
      break;
    case "status":
      await status(client, { json: values.json, plain: values.plain });
      break;
    case "upgrade":
    case "update":
      try {
        await admin(client, command ?? "", rest, values);
      } catch (err) {
        // A core that cannot start cannot update itself either.
        if (!coreRefused(err)) throw err;
        await updateOffline({ check: values.check || rest[0] === "check" });
      }
      break;
    case "doctor":
      await doctor({ json: values.json });
      break;
    case "devices":
    case "tailscale":
      await admin(client, command ?? "", rest, values);
      break;
    case "wizard":
      await wizard(client);
      break;
    case "open":
      await openPanel();
      break;
    case "desktop":
      await desktop();
      break;
    case "ping": {
      const socket = await client.connect();
      const r = await socket.call("system.ping", rest[0] ? { echo: rest[0] } : {});
      console.log(`${r.pong} (${r.at})`);
      socket.close();
      break;
    }
    case "browser":
      await browser(client, values, rest);
      break;
    case "chat":
      await chat(client, rest.join(" "), values);
      break;
    case "threads":
      await threads(client, rest, { json: values.json });
      break;
    case "runs":
      await runs(client, rest, Number(values.timeout ?? 60), values.scope);
      break;
    case "jobs":
      await jobs(client, rest);
      break;
    case "skills":
      if (rest[0] === "install-runtimes") await runtimeSkills(client, Boolean(values["dry-run"]));
      else if (rest[0] === "import")
        await skillsImport(client, rest[1], {
          project: values.project,
          only: values.only,
          replace: values.replace,
          yes: values.yes,
        });
      else await skills(client, rest, { project: values.project });
      break;
    case "channels":
      await channels(client, rest, { agent: values.agent });
      break;
    case "contacts":
      await contacts(client, rest);
      break;
    case "pairing":
      await pairing(client, rest);
      break;
    case "compact": {
      if (!rest[0]) throw new Error("usage: colonia compact <thread>");
      const r = await client.call("threads.compact", { thread: rest[0] });
      console.log(r.compacted ? "summarized" : `not summarized: ${r.reason ?? ""}`);
      break;
    }
    case "tasks":
      await tasks(client, rest, {
        project: values.project,
        agent: values.agent,
        person: values.person,
        owed: values.owed,
        due: values.due,
        start: values.start,
        reviewer: values.reviewer,
        title: values.title,
        desc: values.desc,
        descFile: values["desc-file"],
        tags: values.tags,
      });
      break;
    case "equipo":
      await equipo(client, rest);
      break;
    case "clients":
      await clients(client, rest, { scopes: values.scopes });
      break;
    case "extensions":
      await extensions(client, rest, { clear: values.clear });
      break;
    case "notifications":
      await notifications(client, rest);
      break;
    case "news":
      await news(client, rest, { json: values.json });
      break;
    case "v1":
      await v1(client, rest);
      break;
    case "flows":
      await flows(client, rest, values.project);
      break;
    case "routines":
      await routines(client, rest, {
        project: values.project,
        agent: values.agent,
        cron: values.cron,
        every: values.every,
        at: values.at,
        pre: values.pre,
        post: values.post,
        call: values.call,
        name: values.name,
        promptFile: values["prompt-file"],
        maxSteps: values["max-steps"],
      });
      break;
    case "memory":
      await memory(client, rest, { project: values.project, agent: values.agent, json: values.json });
      break;
    case "sessions":
      await sessions(client, rest, {
        only: values.only,
        name: values.name,
        title: values.title,
        refresh: values.refresh,
        json: values.json,
      });
      break;
    case "usage":
      await usage(client, rest);
      break;
    case "owner":
      await owner(client, rest);
      break;
    case "org":
      await org(client, rest, { project: values.project });
      break;
    case "profiles":
      await profiles(client, rest);
      break;
    case "artifacts":
      await artifacts(client, rest, {
        project: values.project,
        title: values.title,
        app: values.app,
        connect: values.connect,
        json: values.json,
        memory: values.memory,
        out: values.out,
      });
      break;
    case "image":
      await image(client, rest, { out: values.out, size: values.size });
      break;
    case "say":
      await say(client, rest, { out: values.out });
      break;
    case "transcribe":
      await transcribe(client, rest);
      break;
    case "mcps":
      await mcpCommand(client, rest, values);
      break;
    case "agents":
      if (rest[0] === "model") await agentModel(client, rest.slice(1), values);
      else if (rest[0] === "limits") await agentLimits(client, rest.slice(1));
      else if (rest[0] && rest[0] !== "list") await agentEdit(client, rest, values);
      else await agents(client);
      break;
    case "projects":
      await projects(client, rest, values);
      break;
    case "init":
      await init(client, rest, { json: values.json });
      break;
    case "models":
      await models(client, rest, values);
      break;
    case "secrets":
      await secrets(client, rest);
      break;
    case "import-v1":
      await importV1(client, {
        keys: values.keys ?? false,
        skills: values.skills ?? false,
        services: values.services ?? false,
      });
      break;
    case "logs":
      await logsCommand(client, connection.url, {
        lines: values.lines,
        level: values.level,
        grep: values.grep,
        scope: values.scope,
        json: values.json,
      });
      break;
    case "service":
      await service(rest[0], { home: values.home, lines: values.lines, follow: values.follow });
      break;
    case "expose":
      await expose(rest[0]);
      break;
    case "pair":
      await pair(client);
      break;
    case "setup":
      await setupHeadless(terminalClient, {
        headless: values.headless,
        expose: values.expose,
        import: values.import
          ? { keys: values.keys ?? false, skills: values.skills ?? false, services: values.services ?? false }
          : undefined,
      });
      break;
    case "mcp": {
      if (rest.length) {
        await mcpCommand(client, rest, values);
        break;
      }
      if (values.run) {
        // The run token comes in the environment, never on the command line.
        const token = process.env.COLONIA_RUN_TOKEN;
        if (!token) throw new Error("colonia mcp --run needs COLONIA_RUN_TOKEN");
        const { runRunMcp } = await import("./mcp-run.ts");
        await runRunMcp(agentClient, token);
        break;
      }
      const { runMcp } = await import("./mcp.ts");
      // An outside app's token (Settings › MCP › Outside apps) comes in the environment, never on the command line.
      const clientToken = process.env.COLONIA_CLIENT_TOKEN;
      const mcpClient = clientToken
        ? new ColoniaClient({ ...connection, client: { name: "colonia-mcp", version: "0.0.0" }, clientToken })
        : agentClient;
      await runMcp(mcpClient, values.by ?? "mcp-client", Boolean(clientToken));
      break;
    }
    case "help":
    case undefined:
      if (
        !values.help &&
        command === undefined &&
        process.stdin.isTTY &&
        process.stdout.isTTY &&
        !values.plain &&
        !values.json
      ) {
        await wizard(client);
        break;
      }
      if (!values.plain && !values.json)
        console.log(
          card("Help", [
            "Agents that remember.",
            "One core. Every device.",
            "",
            "Start: colonia wizard",
            "Crew: colonia status",
            "Core: colonia service status",
            "Tools: colonia mcp tools <server>",
          ]),
        );
      console.log(HELP);
      break;
    case "daemon":
      console.error(
        card("Daemon is now service", [
          "Colonia v2 calls the background core a service.",
          "",
          "Inspect: colonia service status",
          "Restart: colonia service restart",
          "At login: colonia service install",
          "Remove: colonia service uninstall",
        ]),
      );
      process.exitCode = 1;
      break;
    default:
      console.error(fail("404 · Command not found", [`Unknown command: ${command}`, "Try: colonia --help"]));
      process.exitCode = 1;
  }
} catch (err) {
  const unreachable = unreachableCore(err);
  if (err instanceof ColoniaError) console.error(fail(`Colonia · ${err.code}`, [err.message]));
  else if (unreachable) console.error(fail(unreachable.title, unreachable.lines));
  else console.error(fail("Colonia · Error", [err instanceof Error ? err.message : String(err)]));
  process.exitCode = 1;
}
