# Harold 2.0 — starter workspace

Harold is an AI chief of staff that works with any AI tool and any model: it is platform-, model- and harness-agnostic, and runs in any harness that can read `AGENTS.md` and run a shell command, from any computer or from the cloud. Ready-made wiring ships for Claude Code, the Claude desktop app, Codex and Cursor. Nothing in it depends on one particular machine being on. This repository is the empty skeleton: the folder structure, the rules, the procedures and the small programs that make them stick. You fill in your own work, people and projects.

**Full documentation: [harold.works/docs](https://harold.works/docs).** If you are an AI agent setting this up for someone, read the docs first, then this README, then `AGENTS.md`.

## What makes 2.0 different

Harold's instructions live in plain markdown. 2.0 adds a floor under them: `bin/harold`, a zero-dependency Node program that runs at the start and end of every session.

- **`bin/harold boot`** gets the real date, verifies that the constitution, every core file and every playbook can be read, loads the lessons, the project map, alerts, blockers and the scheduled work that is due, and registers the session. If anything cannot be read, it **refuses** rather than letting the session start blind.
- **`bin/harold close`** runs at the end of every turn. It checks that changed knowledge was written to today's daily note, that every contact touched was filed, and that due scheduled work was recorded. If something is missing it blocks the turn with the exact list. When everything passes, it scans for secrets and commits and pushes the workspace.

## Quick start

1. **Make it your own private repository.** On GitHub use "Use this template" (or clone and push to a new repo), and make it **private**: it will hold your working life.
   ```bash
   git clone https://github.com/dswinder-repo/harold-template my-harold
   cd my-harold
   ```
   Requirements: git, Node 18+, Python 3 (stdlib only, for search). Keep the workspace out of iCloud/Dropbox-style synced folders if you can; boot catches evicted files, but it is better not to have them.

2. **Check it works as-is.**
   ```bash
   bin/harold check     # → RESULT: PASS  (warnings about the example content are expected)
   ```

3. **Fill in the placeholders.** Search for `[YOUR` and replace: `AGENTS.md` (name, role, time zone, git identity), `memory/CLAUDE.md`, the `dashboard/` modules, `dashboard/people.md` (your contact types), and the config table at the top of `playbook/core/morning-brief.md`. Set your time zone in `~/.harold/env`:
   ```bash
   mkdir -p ~/.harold && chmod 700 ~/.harold
   echo 'export HAROLD_TZ="America/Chicago"' >> ~/.harold/env && chmod 600 ~/.harold/env
   ```
   Without it, Harold uses the time zone of whatever machine it runs on (which, in the cloud, is usually UTC).
   Then replace the example content (Jane Doe, Acme Corp, "Example Project", blocker B001, the example lesson L001, the example event) with your own, or delete it.

4. **Set up the CRM (Supabase).** Create a free Supabase project in *your own* account. In its SQL editor, run `tools/harold-mcp/schema.sql`. Then:
   ```bash
   bin/harold-setup-crm                       # stores SUPABASE_URL + service_role key in ~/.harold/env, tests the connection
   (cd tools/harold-mcp && npm install)
   cp .mcp.example.json .mcp.json             # Claude Code: then put the absolute path to bin/harold-mcp in it
   ```
   Codex and Cursor have their own examples, and any other harness adds `bin/harold-mcp` the same way (see [Any AI tool, any model](#any-ai-tool-any-model)). Keys never go in the repo: they stay in `~/.harold/env`, and `.mcp.json`, `.cursor/mcp.json` and `.codex/config.toml` are gitignored.

5. **Optional: tasks in Linear.** Add `LINEAR_API_KEY` and `LINEAR_TEAM_KEY` (your issue prefix, e.g. `ENG`) to `~/.harold/env`. `bin/harold-linear tasks` then feeds boot. Without it, boot says the task layer is unavailable and carries on.

6. **Start a session and say good morning**, in whichever harness you use. Claude Code, Codex and Cursor run boot and close from the hook files already in this repository (Codex asks you to trust them once); in the Claude desktop app, install `tools/harold-plugin`. In any other harness, wire the same commands into its hooks or let the first instruction in `AGENTS.md` have the agent run them. Details below.

## Any AI tool, any model

Harold is platform-, model- and harness-agnostic. A harness is the app or command-line tool that runs an AI model and lets it read your files and run commands. Harold is plain files in a git repository plus a small command-line program, so it works with any harness that can do three things:

1. **Read an instruction file at the start.** `AGENTS.md` is the shared file name many AI agent tools read on their own ([agents.md](https://agents.md)). For one that doesn't, point it at `AGENTS.md`.
2. **Run a shell command:** `bin/harold boot` at the start of a session, `bin/harold close` at the end of every turn.
3. **Ideally, connect to MCP servers** ([an open standard](https://modelcontextprotocol.io/introduction)) for the CRM and knowledge tools. Without MCP the agent still works from the files; CRM changes it cannot make wait in `harold/crm-queue.jsonl`, which boot and close apply once the CRM's credentials are present.

Any model the harness offers works; Harold doesn't depend on a particular one, because the checks are a program, not the model. Automatic hooks are a convenience: where a harness supports them, the checks run on their own; where it doesn't, the first instruction in `AGENTS.md` has the agent run them. Switching harness or model doesn't mean rebuilding anything: the knowledge, rules and tools stay the same. The author runs Harold on Claude; that is his setup, not a requirement.

### Any other harness: a checklist

1. **Instructions.** If it reads `AGENTS.md`, nothing to do. Otherwise add one line to its own rules file: read and follow `AGENTS.md` at the start of every session.
2. **With hooks.** From the workspace root, run `bin/harold boot` at session start, `bin/harold close` at the end of every turn and `bin/harold close --final` at session end, with no `--via` flag (that flag is only for the three harnesses below). If the hook passes input on stdin, add `< /dev/null` so Harold answers in plain text. Boot prints the context to hand the agent and exits 0, or prints `⛔ HAROLD BOOT REFUSED` and exits 2. Close exits 0 when everything is filed and pushed, 2 with the list of what is missing on stderr (send it back to the agent, which fixes it and closes again), or 1 when only the push failed.
3. **Without hooks.** Nothing to wire: `AGENTS.md` tells the agent to run boot first and close at the end of every turn. Every command also works by hand in a terminal.
4. **MCP.** Add `bin/harold-mcp` as a local (command) MCP server, with its absolute path. It reads the CRM's address and key from `~/.harold/env`, so nothing secret goes in the harness's settings.
5. **Scheduled brief.** Any harness with a headless mode can write it: run it on a schedule with `harold/brief-prompt.md` as the prompt (the prompt runs `bin/harold brief start` and `brief finish` itself). In `.github/workflows/morning-brief.yml`, add a step for it next to the three already there; the gate before it and the finish step after it stay the same.

### Ready-made wiring

This repository ships hook files and MCP examples for Claude Code (and the Claude desktop app, through a plugin), Codex and Cursor, as worked examples of the checklist. For any other harness, wire the same three commands.

| Harness | Boot and close | Harold's MCP tools (CRM) | Scheduled brief (`HAROLD_AGENT`) |
|---|---|---|---|
| Claude Code | `.claude/settings.json` hooks, automatic | `.mcp.json` from `.mcp.example.json` | `claude` (default) |
| Claude desktop app (Cowork) | the plugin in `tools/harold-plugin/` | add `bin/harold-mcp` as a local MCP server | n/a |
| Codex | `.codex/hooks.json` hooks, after you trust them | `.codex/config.toml` from `.codex/config.example.toml`, or `codex mcp add` | `codex` |
| Cursor | `.cursor/hooks.json` hooks, automatic | `.cursor/mcp.json` from `.cursor/mcp.example.json` | `cursor` |

**Claude Code.** Open the workspace folder and start a session. `SessionStart` runs boot, `Stop` runs close at the end of every turn, `SessionEnd` runs `close --final`.

**Claude desktop app (Cowork).** Install the plugin in `tools/harold-plugin/` and connect the workspace folder. Its `boot-harold` skill and hooks run the same commands.

**Codex.** Codex reads `AGENTS.md` directly. The hooks are in `.codex/hooks.json`, but Codex runs a project's hooks only when you trust the project and the hooks themselves: start Codex in the workspace, type `/hooks`, review the three Harold hooks and trust them. Codex records trust against the exact hook definition, so do it again after any edit to that file. Codex's `SessionEnd` hook may run for three seconds at most, so `close --final` there hands its work to a background process (`--detach`) and returns at once; its output goes to `harold/active-sessions/.state/<session>.detached.log`. For the CRM tools: `cp .codex/config.example.toml .codex/config.toml` and put in the absolute path, or run `codex mcp add harold-mcp -- /absolute/path/to/bin/harold-mcp`.

**Cursor.** Cursor reads `AGENTS.md` and runs `.cursor/hooks.json` in a trusted workspace: `sessionStart` runs boot (its output becomes context), `stop` runs close (if filing is missing, Cursor gets a follow-up message and keeps going; after four attempts Harold stops asking and reports what is unfiled), `sessionEnd` runs `close --final`. Cursor also loads Claude Code's `.claude/settings.json` hooks by default (Settings → Agents → Third-Party Imports), so each event would fire twice. It doesn't: when the Claude Code hook fires inside Cursor and `.cursor/hooks.json` exists, it answers `{}` and does nothing, and Cursor's own hook does the work. If you delete `.cursor/hooks.json`, the imported Claude Code hooks take over and answer in Cursor's format. For the CRM tools: `cp .cursor/mcp.example.json .cursor/mcp.json` (no path to edit). Cursor's cloud agents do not run `sessionStart` or `sessionEnd`; there the agent runs boot itself, as `AGENTS.md` says.

Each hook command passes `--via=claude|codex|cursor`, so `bin/harold` answers in that tool's format: plain text or `{"additional_context"}` at start, `{"decision":"block"}` or `{"followup_message"}` when filing is missing. `tests/hooks.test.js` feeds each tool's documented hook input to boot and close and checks the answers. That proves Harold's side against the published hook formats of Codex and Cursor; if either tool behaves differently from its documentation, the fallback is the instruction in `AGENTS.md`, and please report it.

## What's included

```
AGENTS.md                  the constitution: boot/close contract, startup sequence, scheduled triggers,
                           CRM filing protocol (with the internal-team gate), error capture, git rules
CLAUDE.md                  one line: @AGENTS.md
.claude/settings.json      Claude Code hooks: SessionStart → boot, Stop → close, SessionEnd → close --final
.codex/hooks.json          Codex hooks: the same three (trust them once with /hooks)
.codex/config.example.toml Codex MCP config for bin/harold-mcp (copy to .codex/config.toml, gitignored)
.cursor/hooks.json         Cursor hooks: sessionStart → boot, stop → close, sessionEnd → close --final
.cursor/mcp.example.json   Cursor MCP config for bin/harold-mcp (copy to .cursor/mcp.json, gitignored)
.mcp.example.json          Claude Code MCP config for bin/harold-mcp (copy to .mcp.json, gitignored)
bin/
  harold                   boot | check | close | file (learning|trigger|daily|crm) | replay | brief | where | search | index | root
  harold-index             SQLite FTS5 search index over every markdown file (Python stdlib)
  harold-mcp               launches the MCP server with credentials from ~/.harold/env
  harold-linear            optional Linear task layer
  harold-setup-crm         stores your Supabase URL + key outside the repo and tests them
harold/                    operational state
  alerts.md  blockers.md  events.md  facts.md  projects.md  sync-map.md
  learnings.jsonl  trigger-log.jsonl  crm-queue.jsonl  active-sessions/  briefs/  brief-prompt.md
memory/                    CLAUDE.md (working memory), glossary.md
dashboard/                 index.md, status.md, processes.md (Context Engine), people.md, strategy.md
vault/                     people/ companies/ projects/ intel/ decisions/ meetings/ daily/ templates/
raw/                       inbox for unprocessed sources
projects/example/          an example project folder (mapped in harold/projects.md)
playbook/
  README.md                the index boot checks
  core/                    16 portable playbooks (morning brief, debrief, intake, analyst, QC, ...)
  engagements/example/     how to add employer- or client-specific playbooks
tools/
  harold-mcp/              MCP server (14 tools: CRM, pipeline, alerts engine, markdown writers) + schema.sql
  harold-plugin/           Cowork plugin: the same hooks + a "boot Harold" skill
  visualizer/              Expedition HQ, a local live dashboard of sessions (node tools/visualizer/serve.js)
.github/workflows/
  morning-brief.yml        OPTIONAL scheduled morning brief, in your time zone at your time, written by
                           any agent with a headless mode; a switch for Claude Code, Codex or Cursor (see below)
tests/
  brief-gate.test.js       tests for the brief schedule gate: node --test tests/brief-gate.test.js
  hooks.test.js            boot and close as Claude Code, Codex and Cursor hooks: node --test tests/hooks.test.js
```

### The CRM model

Every contact has exactly **one type**, from a short list you choose (for example investor, partner, founder, team, other; `team` is reserved for your own colleagues, whose conversations are never logged), **any number of labels**, and a **warmth**: Hot, Warm, Lukewarm, Cold, or unrated. There is **one pipeline**; every entry in it has a required **purpose** ("Raising the seed round") and one of seven stages: Identified, Reached Out, In Conversation, Advancing, Committed, Active, Dormant. `tools/harold-mcp/schema.sql` creates exactly the tables the MCP server uses: `contacts`, `contact_categories` (labels), `contact_pipelines`, `pipeline_stages`, `stage_changes`, `interactions`, `tasks`.

### Morning brief: your time zone, your time

Say "good morning" and Harold runs the morning brief (`playbook/core/morning-brief.md`). Optionally, Steps 1 and 2 can be written for you before you sit down, so the morning starts with them on screen. By default that happens at **6:30am on weekdays, in your time zone**.

`.github/workflows/morning-brief.yml` does it on GitHub's machines, so no computer of yours needs to be on. GitHub schedules only in UTC, so the workflow wakes every hour (at :35, so a 6:30 brief starts about 6:35) and asks `bin/harold brief start` whether the brief is due: a weekday in your zone, at or after your time, and no brief yet today. Every other hour it stops in seconds, and daylight saving takes care of itself. The draft lands in `harold/briefs/YYYY-MM-DD.md`; the next time you boot, Harold sees it and shows it instead of re-running those steps.

Any agent with a headless (non-interactive) mode can write it; the workflow has a switch for three. To turn it on, add one repository secret for the agent that writes it and set two repository **variables** (Settings → Secrets and variables → Actions → Variables). Claude Code is the default and needs `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`) or `ANTHROPIC_API_KEY`. To use Codex instead, set the variable `HAROLD_AGENT` to `codex` and add the secret `OPENAI_API_KEY` (the workflow uses the official `openai/codex-action`); for Cursor, set `HAROLD_AGENT` to `cursor` and add `CURSOR_API_KEY` (the workflow uses Cursor's headless CLI, `agent -p`). An optional `HAROLD_AGENT_MODEL` variable picks the model for Codex or Cursor.

| Variable | Example | Default |
|---|---|---|
| `HAROLD_TZ` | `America/Chicago`, `Europe/London`, `Asia/Singapore` | UTC on GitHub's machines (each run warns until you set it) |
| `HAROLD_BRIEF_TIME` | `07:15` (24-hour, your local time) | `06:30` |

To change the time or zone later, change the variables; nothing else. Check the gate any time with `bin/harold brief status`. The workflow file explains the rest (dry runs, the optional ntfy phone push, and how to spend fewer Actions minutes).

**Prefer a Claude Code routine?** Delete the workflow and create a routine whose prompt is `harold/brief-prompt.md`, on its own schedule (for example weekdays at your brief time). The routine's schedule is the clock; the same gate still skips weekends and days that already have a brief. Set `HAROLD_TZ` in the routine's environment so dates are yours, not the server's.

## Keeping it private

- The workspace repo must be private. Everything in it is your context.
- Credentials live in `~/.harold/env`, never in the repo. `bin/harold close` refuses to commit anything that looks like a key.
- The visualizer listens on localhost only. Do not expose its port.

## License and credit

Harold was built and documented at [harold.works](https://harold.works). Adapt this starter freely for your own use.
