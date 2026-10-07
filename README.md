# Harold 2.0 — starter workspace

Harold is an AI chief of staff that works with any AI tool and any model: it is platform-, model- and harness-agnostic, and runs in any harness that can read `AGENTS.md` and run a shell command, from any computer or from the cloud. Every harness with lifecycle hooks is wired: boot and close run on their own in Claude Code, the Claude desktop app, Codex, Cursor, Gemini CLI, Qwen Code, Copilot CLI, Grok Build, Kimi Code, goose, Hermes Agent, Cline, opencode, Amp and OpenClaw. Nothing in it depends on one particular machine being on. This repository is the empty skeleton: the folder structure, the rules, the procedures and the small programs that make them stick. You fill in your own work, people and projects.

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

4. **Set up the CRM (Supabase).**

   **a. The database: Harold's tools work from here.** Create a free Supabase project in *your own* account. In its SQL editor, run `tools/harold-mcp/schema.sql`. Then:
   ```bash
   bin/harold-setup-crm                       # stores SUPABASE_URL + service_role key in ~/.harold/env, tests the connection
   (cd tools/harold-mcp && npm install)
   cp .mcp.example.json .mcp.json             # Claude Code: then put the absolute path to bin/harold-mcp in it
   ```
   Codex and Cursor have their own examples, and any other harness adds `bin/harold-mcp` the same way (see [Any AI tool, any model](#any-ai-tool-any-model)). Keys never go in the repo: they stay in `~/.harold/env`, and `.mcp.json`, `.cursor/mcp.json` and `.codex/config.toml` are gitignored.

   **b. Optional: the web app.** `tools/harold-crm` is a CRM you open in a browser (contacts, pipeline, tasks, notifications, audit trail), on the same database. [`tools/harold-crm/README.md`](tools/harold-crm/README.md) has the steps; in short:
   - In the SQL editor, run `tools/harold-crm/supabase/migrations/002` to `007` in order (`001` is the schema you already ran).
   - Deploy it on Vercel or any Next.js host: import this repository with **Root Directory** `tools/harold-crm`, and set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (the publishable key, never the service role key).
   - In Supabase, create your user, add yourself as a member (`crm_members`), and turn off sign-ups.
   - Optional AI (contact research, enrichment, meeting prep) runs on Google Gemini, whose free tier covers it: get a free API key at [Google AI Studio](https://aistudio.google.com/apikey) and set it as `GEMINI_API_KEY` in the host's environment variables (and in `tools/harold-crm/.env.local` for local development). Without it, the AI buttons say AI is off.

5. **Optional: tasks in Linear.** Add `LINEAR_API_KEY` and `LINEAR_TEAM_KEY` (your issue prefix, e.g. `ENG`) to `~/.harold/env`. `bin/harold-linear tasks` then feeds boot. Without it, boot says the task layer is unavailable and carries on.

6. **Optional: the scheduled jobs and the connector.** The morning brief and the weekly, monthly and month-end housekeeping can run on GitHub's machines ([below](#scheduled-jobs-in-the-cloud)); the hosted connector lets a chat app on your phone or in a browser read and write Harold ([below](#from-any-chat-app-the-hosted-connector)). Both are off until you set them up.

7. **Start a session and say good morning**, in whichever harness you use. Most harnesses run boot and close from the hook files and plugins already in this repository (some ask you to trust them once); Kimi Code and Hermes Agent need a snippet copied into your user config, and OpenClaw a plugin install. Where a harness has no hooks, the first instruction in `AGENTS.md` has the agent run them. Details below.

## Any AI tool, any model

Harold is platform-, model- and harness-agnostic. A harness is the app or command-line tool that runs an AI model and lets it read your files and run commands. Harold is plain files in a git repository plus a small command-line program, so it works with any harness that can do three things:

1. **Read an instruction file at the start.** `AGENTS.md` is the shared file name many AI agent tools read on their own ([agents.md](https://agents.md)). For one that doesn't, point it at `AGENTS.md`.
2. **Run a shell command:** `bin/harold boot` at the start of a session, `bin/harold close` at the end of every turn.
3. **Ideally, connect to MCP servers** ([an open standard](https://modelcontextprotocol.io/introduction)) for the CRM and knowledge tools. Without MCP the agent still works from the files; CRM changes it cannot make wait in `harold/crm-queue.jsonl`, which boot and close apply once the CRM's credentials are present.

Any model the harness offers works; Harold doesn't depend on a particular one, because the checks are a program, not the model. Automatic hooks are a convenience: where a harness supports them, the checks run on their own; where it doesn't, the first instruction in `AGENTS.md` has the agent run them. Switching harness or model doesn't mean rebuilding anything: the knowledge, rules and tools stay the same. The author runs Harold on Claude; that is his setup, not a requirement.

### Any other harness: a checklist

1. **Instructions.** If it reads `AGENTS.md`, nothing to do. Otherwise add one line to its own rules file: read and follow `AGENTS.md` at the start of every session.
2. **With hooks.** From the workspace root, run `bin/harold boot` at session start, `bin/harold close` at the end of every turn and `bin/harold close --final` at session end, with no `--via` flag (that flag is only for the harnesses below). If the hook passes input on stdin, add `< /dev/null` so Harold answers in plain text. Boot prints the context to hand the agent and exits 0, or prints `⛔ HAROLD BOOT REFUSED` and exits 2. Close exits 0 when everything is filed and pushed, 2 with the list of what is missing on stderr (send it back to the agent, which fixes it and closes again), or 1 when only the push failed.
3. **Without hooks.** Nothing to wire: `AGENTS.md` tells the agent to run boot first and close at the end of every turn. Every command also works by hand in a terminal.
4. **MCP.** Add `bin/harold-mcp` as a local (command) MCP server, with its absolute path. It reads the CRM's address and key from `~/.harold/env`, so nothing secret goes in the harness's settings.
5. **Scheduled jobs.** Any harness with a headless mode can run them: on a schedule, with `harold/brief-prompt.md` (the morning brief) or `harold/housekeeping-prompt.md` (weekly scan, full audit, month-end review) as the prompt. Each prompt runs its own `start` gate and `finish` step. In the starter's workflows, set `HAROLD_AGENT` to one of the presets, or to `custom` with your CLI's command ([Scheduled jobs in the cloud](#scheduled-jobs-in-the-cloud)); the gate before it and the finish step after it stay the same.

### Every harness with lifecycle hooks is wired

If a harness has a hook or plugin mechanism for the start of a session, the end of a turn or the end of a session, this repository wires boot and close into it. Each wiring passes `--via=<harness>`, so `bin/harold` answers in that harness's own format; `tests/hooks.test.js` and `tests/harnesses.test.js` feed each harness's documented hook input to boot and close and check the answers. Where a harness has no hooks, the first instruction in `AGENTS.md` is the fallback: the agent runs boot and close itself.

| Harness | Hooks? | Wiring in this repository | Start → boot | End of every turn → close | Session end → close --final | Source checked |
|---|---|---|---|---|---|---|
| Claude Code | yes | `.claude/settings.json` | `SessionStart` | `Stop` | `SessionEnd` | Claude Code hooks docs |
| Claude desktop app (Cowork) | yes | plugin `tools/harold-plugin/` | `SessionStart` + `boot-harold` skill | `Stop` | `SessionEnd` | Claude Code plugin hooks |
| Codex | yes | `.codex/hooks.json` (trust once with `/hooks`) | `SessionStart` | `Stop` | `SessionEnd` (3 s limit: detached) | Codex hooks docs |
| Cursor | yes | `.cursor/hooks.json` | `sessionStart` | `stop` (follow-up message) | `sessionEnd` | Cursor hooks docs |
| Gemini CLI | yes | `.gemini/settings.json` | `SessionStart` (`additionalContext`) | `AfterAgent` (`decision: block` retries) | `SessionEnd` (not awaited: detached) | google-gemini/gemini-cli `docs/hooks/`, `packages/core/src/hooks/` |
| Qwen Code | yes | `.qwen/settings.json` | `SessionStart` (plain stdout) | `Stop` | `SessionEnd` | QwenLM/qwen-code `docs/users/features/hooks.md` |
| GitHub Copilot CLI | yes | `.github/copilot/settings.json` | `sessionStart` (`additionalContext`) | `agentStop` (`decision: block`) | `sessionEnd` (detached) | github/docs `content/copilot/reference/hooks-reference.md` |
| Grok Build | yes | `.grok/hooks/harold.json` | `SessionStart` registers only ¹ | `Stop` | `SessionEnd` (1.5 s budget: detached) | xai-org/grok-build `docs/user-guide/10-hooks.md`, `xai-grok-hooks` |
| Kimi Code CLI | yes, user-level only | `tools/harness-hooks/kimi-config.toml` → copy into `~/.kimi/config.toml` | `SessionStart` registers only ¹ | `Stop` (exit 2) | `SessionEnd` (5 s: detached) | MoonshotAI/kimi-cli `docs/en/customization/hooks.md`, `src/kimi_cli/hooks/` |
| goose | yes | plugin `.agents/plugins/harold/` | `SessionStart` registers only ¹ | `Stop` (`decision: block`) | `SessionEnd` | block/goose `documentation/docs/guides/context-engineering/hooks.md` |
| Hermes Agent | yes, user-level only | `tools/harness-hooks/hermes-config.yaml` → merge into `~/.hermes/config.yaml` | first `pre_llm_call` (`context`) | `pre_verify` (blocks, after file edits) + `on_session_end` | `on_session_finalize` (detached) | NousResearch/hermes-agent `website/docs/user-guide/features/hooks.md`, `agent/shell_hooks.py` |
| Cline | yes | `.clinerules/hooks/` | `TaskStart` (`contextModification`) | `TaskComplete` (cannot block ²) | `SessionShutdown` (CLI only) | cline/cline `apps/vscode/src/sdk/hooks-adapter.ts`, `sdk/packages/core/src/hooks/` |
| opencode | yes (plugins) | plugin `.opencode/plugins/harold.js` | system prompt of each session | `session.idle` (reason sent back as a message) | session deleted, shutdown | sst/opencode `packages/plugin/src/index.ts`, plugins docs |
| Amp | yes (plugins) | plugin `.amp/plugins/harold.ts` | first `agent.start` of a thread | `agent.end` (`action: continue`) | plugin dispose (detached) | `@ampcode/plugin` `index.d.ts` |
| OpenClaw | yes (plugins) | plugin `tools/openclaw-plugin/` (install + allow conversation access) | first `before_prompt_build` (`prependContext`) | `before_agent_finalize` (`revise`) + `agent_end` | `session_end` (detached) | openclaw/openclaw `docs/plugins/hooks*`, `src/plugins/hook-types.ts` |
| Continue CLI | no (not yet) | none: `AGENTS.md` | | | | continuedev/continue `extensions/cli/src/hooks/`: Claude-compatible hook code reads `.claude/settings.json`, but nothing fires `SessionStart`, `Stop` or `SessionEnd` (July 2026) |
| Zed agent | no | none: `AGENTS.md` | | | | zed-industries/zed `docs/src/ai/`, `docs/src/tasks.md` (only a `create_worktree` task hook) |
| Antigravity CLI | unverified | none: `AGENTS.md` | | | | google-antigravity/antigravity-cli `CHANGELOG.md` names `.agents/hooks.json` with `Stop` and `PostInvocation`, but its input and output formats and any session-start event are not published anywhere reachable |
| Windsurf (Cascade) | unverified | none: `AGENTS.md` | | | | no public source; its documentation site could not be reached from here |
| Kiro | unverified | none: `AGENTS.md` | | | | closed source (kirodotdev/Kiro holds issues only); kiro.dev could not be reached. Its predecessor, Amazon Q Developer CLI (aws/amazon-q-developer-cli `docs/hooks.md`), had `agentSpawn` and `stop` hooks |

¹ These three never show session-start hook output to the model. The hook registers the session; the agent then runs `bin/harold boot` itself, as `AGENTS.md` says, and that run prints the context for the same session (one session file, not two). Until it has, close blocks the turn with "run bin/harold boot".
² Cline's `TaskComplete` cannot keep the agent going, so close runs there in the background (no 30-second limit) and the next `TaskStart` hands the model whatever it found unfiled. Hermes's `on_session_end` works the same way for turns in which `pre_verify` did not fire.

**Borrowed hook files.** Cursor and Grok Build load `.claude/settings.json`, Grok Build also `.cursor/hooks.json`, and Copilot CLI also `.claude/settings.json`. When a borrowed hook fires and the harness's own Harold wiring is present, it answers "nothing to do" and the harness's own hook does the work, once; delete that file and the borrowed hook does the work in the harness's format. Two closes of one session never run at once (the second steps aside), and a second boot within two minutes prints one line.

**Copilot's cloud agent** reads only `.github/hooks/*.json`, not `.github/copilot/settings.json`, so these hooks run in Copilot CLI and not in cloud agent jobs, where the agent's commits go to a pull request rather than straight to your knowledge base.

**Per harness:**
- **Claude Code.** Open the workspace folder and start a session.
- **Claude desktop app (Cowork).** Install the plugin in `tools/harold-plugin/` and connect the workspace folder.
- **Codex.** Codex runs a project's hooks only after you trust them: start Codex in the workspace, type `/hooks`, review the three Harold hooks and trust them (again after any edit to the file). Its `SessionEnd` hook may run for three seconds, so `close --final` hands its work to a background process (`--detach`); output goes to `harold/active-sessions/.state/<session>.detached.log`.
- **Cursor.** Runs `.cursor/hooks.json` in a trusted workspace. If filing is missing, Cursor gets a follow-up message and keeps going. Cursor's cloud agents do not run `sessionStart` or `sessionEnd`; there the agent runs boot itself.
- **Gemini CLI, Qwen Code, Grok Build.** Project hooks run once you trust the folder (Gemini also warns once per new hook; Grok: `/hooks-trust` or `--trust`).
- **Copilot CLI.** Reads `.github/copilot/settings.json` in a trusted folder; in prompt mode (`-p`) it fires `sessionEnd` after each prompt.
- **Kimi Code CLI and Hermes Agent.** Both read hooks only from your user config, so copy the snippet from `tools/harness-hooks/` once. Each command does nothing unless the tool runs inside a Harold workspace (or `HAROLD_ROOT` names one). Hermes asks you to approve each hook once (or start it with `--accept-hooks`).
- **goose.** Loads `.agents/plugins/harold/` when it works in the workspace.
- **Cline.** Turn on hooks in Cline's settings; the scripts in `.clinerules/hooks/` must stay executable.
- **opencode.** Loads `.opencode/plugins/harold.js` at startup. It uses `experimental.chat.system.transform` for the context; if a later opencode drops that, the agent boots itself from `AGENTS.md`.
- **Amp.** Loads `.amp/plugins/harold.ts`; after editing it, run `plugins: reload`.
- **OpenClaw.** `openclaw plugins install --link tools/openclaw-plugin`, `openclaw plugins enable harold`, then in `openclaw.json` set `plugins.entries.harold.hooks.allowConversationAccess: true` (and `config.root` if the agent's workspace is not the Harold workspace). See `tools/openclaw-plugin/README.md`.

### MCP tools and scheduled jobs

| Harness | Harold's MCP tools (CRM) | Scheduled jobs (`HAROLD_AGENT`) |
|---|---|---|
| Claude Code | `.mcp.json` from `.mcp.example.json` | `claude` (default) |
| Claude desktop app (Cowork) | add `bin/harold-mcp` as a local MCP server | n/a |
| Codex | `.codex/config.toml` from `.codex/config.example.toml`, or `codex mcp add harold-mcp -- /absolute/path/to/bin/harold-mcp` | `codex` |
| Cursor | `.cursor/mcp.json` from `.cursor/mcp.example.json` (no path to edit) | `cursor` |
| Gemini CLI, Copilot CLI, Grok Build, Kimi Code, Qwen Code | add `bin/harold-mcp` as a local MCP server | `gemini`, `copilot`, `grok`, `kimi`, `qwen` |
| any other | add `bin/harold-mcp` as a local MCP server | `custom` |

Gemini CLI reads `AGENTS.md` because `.gemini/settings.json` names it as a context file; the other harnesses above read `AGENTS.md` on their own (Hermes, Kimi, Qwen, Cline, goose, opencode, Amp, OpenClaw and Copilot CLI included).

## What's included

```
AGENTS.md                  the constitution: boot/close contract, startup sequence, scheduled triggers,
                           CRM filing protocol, error capture, git rules
CLAUDE.md                  one line: @AGENTS.md
.claude/settings.json      Claude Code hooks: SessionStart → boot, Stop → close, SessionEnd → close --final
.codex/hooks.json          Codex hooks: the same three (trust them once with /hooks)
.codex/config.example.toml Codex MCP config for bin/harold-mcp (copy to .codex/config.toml, gitignored)
.cursor/hooks.json         Cursor hooks: sessionStart → boot, stop → close, sessionEnd → close --final
.cursor/mcp.example.json   Cursor MCP config for bin/harold-mcp (copy to .cursor/mcp.json, gitignored)
.gemini/settings.json      Gemini CLI: read AGENTS.md as its context file; hooks SessionStart, AfterAgent, SessionEnd
.qwen/settings.json        Qwen Code hooks: SessionStart, Stop, SessionEnd
.github/copilot/settings.json  Copilot CLI hooks: sessionStart, agentStop, sessionEnd
.grok/hooks/harold.json    Grok Build hooks: SessionStart, Stop, SessionEnd
.agents/plugins/harold/    goose plugin (Open Plugins layout): SessionStart, Stop, SessionEnd
.clinerules/hooks/         Cline hooks: TaskStart, TaskComplete, TaskCancel, SessionShutdown
.opencode/plugins/harold.js  opencode plugin: boot into the system prompt, close on session.idle
.amp/plugins/harold.ts     Amp plugin: boot on agent.start, close on agent.end
.mcp.example.json          Claude Code MCP config for bin/harold-mcp (copy to .mcp.json, gitignored)
bin/
  harold                   boot | check | close | file (learning|trigger|daily|crm) | replay | brief | housekeeping |
                           where | search | index | root
  harold-index             SQLite FTS5 search index over every markdown file (Python stdlib)
  harold-mcp               launches the MCP server with credentials from ~/.harold/env
  harold-linear            optional Linear task layer
  harold-setup-crm         stores your Supabase URL + key outside the repo and tests them
  harold-agent-auth        scheduled jobs: keeps a subscription sign-in file fresh between runs (encrypted
                           in the Actions cache), and passes a custom agent only the secrets it names
harold/                    operational state
  alerts.md  blockers.md  events.md  facts.md  projects.md  sync-map.md
  learnings.jsonl  trigger-log.jsonl  crm-queue.jsonl  active-sessions/  briefs/  brief-prompt.md
  housekeeping.json        the switch for cloud housekeeping ("cloud": false until you turn it on)
  housekeeping-prompt.md   the prompt the scheduled housekeeping job runs
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
  harold-crm/              optional CRM web app (Next.js + Supabase) on the same database; deploy with root directory
                           tools/harold-crm. Its migration 001 is a copy of schema.sql; 002-007 add the app's tables
  harold-connector/        hosted MCP server (Vercel or any Node host): reach the knowledge base and the CRM
                           from any MCP client (chat apps, coding agents, scheduled jobs), on any device
  harold-plugin/           Cowork plugin: the same hooks + a "boot Harold" skill
  openclaw-plugin/         OpenClaw plugin: boot on the first turn, close at the end of every turn and of the session
  harness-hooks/           user-level hook snippets for Kimi Code (kimi-config.toml) and Hermes Agent (hermes-config.yaml)
  visualizer/              Expedition HQ, a local live dashboard of sessions (node tools/visualizer/serve.js)
.github/workflows/
  morning-brief.yml        OPTIONAL scheduled morning brief, in your time zone at your time, written by
                           any agent with a headless mode; HAROLD_AGENT picks it, subscription first (see below)
  housekeeping.yml         OPTIONAL weekly scan, monthly full audit and month-end review, silently, same switch
.github/actions/harold-agent/
  action.yml               runs the chosen agent for both jobs: Claude Code, Codex, Cursor, Gemini CLI, Copilot CLI,
                           Grok Build, Kimi Code, Qwen Code, or any other CLI through a custom command
tests/
  brief-gate.test.js       tests for the brief schedule gate: node --test tests/brief-gate.test.js
  hooks.test.js            boot and close as Claude Code, Codex and Cursor hooks: node --test tests/hooks.test.js
  harnesses.test.js        the same for every other wired harness and the three plugins: node --test tests/harnesses.test.js
  crm.test.js              one CRM schema (001 = schema.sql) and the optional HAROLD_NO_LOG_TYPES: node --test tests/crm.test.js
  housekeeping.test.js     the housekeeping gate across time zones, the job, and close inside it: node --test tests/housekeeping.test.js
  agent-action.test.js     each agent's credential choice (subscription first) and what it is given, with stub CLIs
  agent-auth.test.js       sign-in files kept fresh across runs, and a custom agent's secrets
```

### The CRM model

Every contact has exactly **one type**, from a short list you choose (for example investor, partner, founder, team, other), **any number of labels**, and a **warmth**: Hot, Warm, Lukewarm, Cold, or unrated. There is **one pipeline**; every entry in it has a required **purpose** ("Raising the seed round") and one of seven stages: Identified, Reached Out, In Conversation, Advancing, Committed, Active, Dormant. `tools/harold-mcp/schema.sql` creates exactly the tables the MCP server uses: `contacts`, `contact_categories` (labels), `contact_pipelines`, `pipeline_stages`, `stage_changes`, `interactions`, `tasks`; the web app adds its own tables around them.

Every conversation with a contact is logged unless you choose otherwise: the optional setting `HAROLD_NO_LOG_TYPES` in `~/.harold/env` (empty by default) lists contact types whose conversations are never logged, for example your own team. "CRM Filing Protocol" in `AGENTS.md` describes exactly what it changes.

## Scheduled jobs in the cloud

Two kinds of work run on a schedule, on GitHub's machines, so no computer of yours needs to be on: the morning brief and housekeeping. Both are GitHub Actions workflows in `.github/workflows/`, both are off until you set them up, and both use the same agent switch and secrets. The repository variable `HAROLD_AGENT` picks the agent (unset means Claude Code), and `.github/actions/harold-agent` runs it the same way for both jobs: the same prompt, at the repository root, allowed to run `bin/harold` and a few read-only commands. Variables and secrets live under Settings → Secrets and variables → Actions.

**Subscription first.** Wherever an agent's maker sells a subscription, the scheduled jobs can run on it, and that is what they use when its secret is present. An API key is only for people without a subscription; if both secrets are set, the subscription wins.

### Which agent, and how it signs in

| `HAROLD_AGENT` | With a subscription (repository secret) | Without a subscription | Status |
|---|---|---|---|
| `claude` (default) | `CLAUDE_CODE_OAUTH_TOKEN`: Claude Pro or Max | `ANTHROPIC_API_KEY` | documented by Anthropic |
| `codex` | `CODEX_AUTH_JSON`: ChatGPT Plus, Pro, Business… | `OPENAI_API_KEY` | subscription path not yet tested |
| `cursor` | `CURSOR_API_KEY`, a User API key from your Cursor account | the same key (Cursor has no other headless sign-in) | whether its use counts against your plan is not confirmed |
| `gemini` | `GEMINI_OAUTH_CREDS`: Google AI Pro or Ultra | `GEMINI_API_KEY` | not yet tested; see the note below |
| `copilot` | `COPILOT_GITHUB_TOKEN`: any Copilot plan | none: Copilot CLI needs a Copilot plan (Copilot Free is one) | not yet tested |
| `grok` | `GROK_AUTH_JSON`: SuperGrok | `XAI_API_KEY` | not yet tested |
| `kimi` | `KIMI_API_KEY`: a Kimi Code key | the same secret with a Moonshot platform key, plus `HAROLD_AGENT_BASE_URL` | not yet tested |
| `qwen` | `QWEN_CODING_PLAN_KEY`: Alibaba Cloud Coding Plan | use `custom` with your provider's key | not yet tested |
| `custom` | whatever your CLI needs (below) | | yours to test |

"Not yet tested" means the setup follows the tool's own documentation or source code, and `tests/agent-action.test.js` checks what each agent is given, but no scheduled run has used it yet. Optional variables: `HAROLD_AGENT_MODEL` (a model name, for any agent) and `HAROLD_AGENT_BASE_URL` (the endpoint, for `kimi` and `qwen`).

What to run once, on your own computer, for each:

- **Claude Code.** `claude setup-token`, approve in the browser, and store the token it prints: `gh secret set CLAUDE_CODE_OAUTH_TOKEN` (paste it) or add it in the Settings page. The token lasts a year.
- **Codex.** Sign in once into a separate folder, just for the scheduled jobs, and store the file it writes:
  ```bash
  export CODEX_HOME="$HOME/.codex-harold"
  codex -c 'cli_auth_credentials_store="file"' login     # add --device-auth if no browser opens
  gh secret set CODEX_AUTH_JSON < "$CODEX_HOME/auth.json"
  rm -rf "$CODEX_HOME"; unset CODEX_HOME                 # not `codex logout`: that revokes the sign-in
  ```
  Why a separate sign-in: `codex login` revokes the sign-in already in its folder, and a ChatGPT sign-in renews itself with a new refresh token each time (the old one stops working). If your own Codex and the jobs shared one, whichever renewed first would sign the other out. Because of that renewal, the secret is only the starting point: each run that renews the sign-in keeps the new copy in the Actions cache, encrypted with a key derived from the secret itself (`bin/harold-agent-auth`), and the next run uses it. Codex runs of the brief and of housekeeping never overlap, so two runs cannot renew at once. If the jobs stop for more than a week, GitHub drops the cached copy; if a renewal happened before that, sign in again the same way and replace the secret.
- **Cursor.** Create a User API key in the Cursor dashboard (Integrations) and store it as `CURSOR_API_KEY`. Cursor's own SDK guide describes a User API key as running "as a specific user"; nothing published that could be checked here says whether headless use draws on your plan's included usage.
- **Gemini CLI.** Sign in with Google once in a throwaway home folder, just for the scheduled jobs, and store the file it writes (run this inside your repository, so `gh` knows which one):
  ```bash
  export SIGNIN_HOME="$(mktemp -d)"
  HOME="$SIGNIN_HOME" gemini        # choose "Sign in with Google", then /quit
  gh secret set GEMINI_OAUTH_CREDS < "$SIGNIN_HOME/.gemini/oauth_creds.json"
  rm -rf "$SIGNIN_HOME"
  ```
  The job sets `GOOGLE_GENAI_USE_GCA=true` so Gemini CLI uses it. Note: some reports say Google stopped serving Pro and Ultra personal sign-in in Gemini CLI on 2026-06-18 in favour of Antigravity CLI; Gemini CLI's own documentation (October 2026) still recommends that sign-in for subscribers, and nothing in its repository confirms the cut-off. If it no longer works for you, use `GEMINI_API_KEY`.
- **Copilot CLI.** Create a fine-grained personal access token at github.com/settings/personal-access-tokens/new with the "Copilot Requests" permission, and store it as `COPILOT_GITHUB_TOKEN`. Each prompt uses your plan's premium requests.
- **Grok Build.** `GROK_HOME="$HOME/.grok-harold" grok login` (or `--device-auth`), then `gh secret set GROK_AUTH_JSON < "$HOME/.grok-harold/auth.json"` and delete that folder. The renewal and cache handling is the same as for Codex.
- **Kimi Code CLI.** Store your Kimi Code API key (the one its `/login` asks for) as `KIMI_API_KEY`. The job writes the provider settings its documentation gives (`https://api.kimi.com/coding/v1`, model `kimi-for-coding`).
- **Qwen Code.** Store your Coding Plan key (`sk-sp-…`) as `QWEN_CODING_PLAN_KEY`. The job uses the international endpoint; for an account in the Beijing region set `HAROLD_AGENT_BASE_URL` to `https://coding.dashscope.aliyuncs.com/v1`.

How tightly each agent is limited differs because the CLIs differ: Claude Code, Gemini CLI, Copilot CLI, Grok Build and Qwen Code get an explicit list of allowed commands; Codex runs in its workspace-write sandbox; Cursor (`--force`) and Kimi (`--print`) approve every tool call, because their headless modes have no per-command list. In every case the job's last step, outside the agent, checks the result, refuses to commit anything that looks like a credential, and pushes.

### Claude Code with another model provider

Several providers sell coding plans for their own models behind an Anthropic-compatible endpoint, so Claude Code can run on them. Add the repository secrets `ANTHROPIC_BASE_URL` (the provider's endpoint) and `ANTHROPIC_AUTH_TOKEN` (your plan's or account's key), and optionally `ANTHROPIC_MODEL` (a secret or a variable); leave `HAROLD_AGENT` as `claude`. When `ANTHROPIC_BASE_URL` is set, the job uses that provider and not your Claude credentials.

| Provider | `ANTHROPIC_BASE_URL` | Example model |
|---|---|---|
| Moonshot (Kimi) | `https://api.moonshot.ai/anthropic` | `kimi-k2.5` |
| Zhipu Z.ai (GLM Coding Plan) | `https://api.z.ai/api/anthropic` | `glm-5.1` |
| DeepSeek | `https://api.deepseek.com/anthropic` | `deepseek-reasoner` |
| MiniMax (Token Plan) | `https://api.minimax.io/anthropic` | `minimax-m2.7` |
| Alibaba Cloud (DashScope) | `https://dashscope-intl.aliyuncs.com/apps/anthropic` | `qwen3.6-plus` |

These endpoints come from the community reference [Alorse/cc-compatible-models](https://github.com/Alorse/cc-compatible-models) (April 2026); the providers' own pages could not be checked from here, so treat them as not yet verified and confirm them in your provider's documentation. A coding plan can use a different endpoint or key from pay-as-you-go access.

### Any other agent CLI: the custom command

Set `HAROLD_AGENT` to `custom` and the variable `HAROLD_AGENT_CMD` to the command that runs your CLI headless. The contract:

- **The prompt** arrives on stdin; its path is also in `$HAROLD_PROMPT_FILE`, for CLIs that take the prompt as an argument (`mycli -p "$(cat "$HAROLD_PROMPT_FILE")"`). `$HAROLD_MODEL` holds `HAROLD_AGENT_MODEL`.
- **It runs at the repository root** and should write only inside it.
- **Its shell may run only `bin/harold`** and the read-only helpers listed in `$HAROLD_COMMANDS`: configure your CLI's permissions that way if it has them. The job's last step commits and pushes, outside the agent.
- **Install** (optional): the variable `HAROLD_AGENT_INSTALL`, for example `npm install -g some-cli`.
- **Secrets**: the variable `HAROLD_AGENT_SECRETS` lists repository secret names, comma-separated. `NAME` is exported as that environment variable; `NAME:~/path/file` is written to that file instead (for a CLI that keeps its sign-in in a file). Only the secrets named reach the agent.

For example, Antigravity CLI (`agy`) runs headless with `-p` and accepts `GEMINI_API_KEY`: `HAROLD_AGENT_CMD` = `agy -p "$(cat "$HAROLD_PROMPT_FILE")"`, `HAROLD_AGENT_INSTALL` = `curl -fsSL https://antigravity.google/cli/install.sh | bash`, `HAROLD_AGENT_SECRETS` = `GEMINI_API_KEY` (its changelog says that also needs `modelProvider: "gemini"` in its `settings.json`). Its Google subscription sign-in lives in the system keyring, and how to carry that to a server is not documented, so Antigravity works via the custom command, but its subscription path is not yet verified.

**Local open-weight models** (Ollama, LM Studio) work through any harness that supports them, via the custom command, with no API key or subscription; the model server must be reachable from where the job runs, which usually means your own runner rather than GitHub's.

GitHub Actions is the starter's way to schedule. Any other scheduler that can run a headless agent on your repository works the same way with the same prompt files, for example a Claude Code routine (see the end of each section).

### Morning brief: your time zone, your time

Say "good morning" and Harold runs the morning brief (`playbook/core/morning-brief.md`). Optionally, Steps 1 and 2 can be written for you before you sit down, so the morning starts with them on screen. By default that happens at **6:30am on weekdays, in your time zone**.

`.github/workflows/morning-brief.yml` does it on GitHub's machines, so no computer of yours needs to be on. GitHub schedules only in UTC, so the workflow wakes every hour (at :35, so a 6:30 brief starts about 6:35) and asks `bin/harold brief start` whether the brief is due: a weekday in your zone, at or after your time, and no brief yet today. Every other hour it stops in seconds, and daylight saving takes care of itself. The draft lands in `harold/briefs/YYYY-MM-DD.md`; the next time you boot, Harold sees it and shows it instead of re-running those steps.

To turn it on, add the secret for your agent (above) and set two repository **variables**:

| Variable | Example | Default |
|---|---|---|
| `HAROLD_TZ` | `America/Chicago`, `Europe/London`, `Asia/Singapore` | UTC on GitHub's machines (each run warns until you set it) |
| `HAROLD_BRIEF_TIME` | `07:15` (24-hour, your local time) | `06:30` |

To change the time or zone later, change the variables; nothing else. Check the gate any time with `bin/harold brief status`. The workflow file explains the rest (dry runs, the optional ntfy phone push, and how to spend fewer Actions minutes).

**Prefer a Claude Code routine?** Delete the workflow and create a routine whose prompt is `harold/brief-prompt.md`, on its own schedule (for example weekdays at your brief time). The routine's schedule is the clock; the same gate still skips weekends and days that already have a brief. Set `HAROLD_TZ` in the routine's environment so dates are yours, not the server's.

### Housekeeping: weekly, monthly, month-end

Three of the scheduled triggers are upkeep rather than conversation: the **weekly scan** (Fridays), the **monthly full audit** (the 1st, including the slim-down that moves stale sections of over-budget startup files into an archive file beside them) and the **month-end review** (the last business day, Monday to Friday). By default a session does them when boot lists them as due. Turned on, `.github/workflows/housekeeping.yml` does them instead, silently, and pushes the results; anything worth your attention lands as one line in `harold/briefs/housekeeping-notes.md`, and the next morning brief shows it once.

**One switch.** In `harold/housekeeping.json`, set `"cloud": true`, commit and push. That line does two things at once: the workflow starts doing the jobs, and sessions stop treating them as due work (boot shows a one-line note instead, and close never asks for them), so a job is never done twice or not at all. While it is `false`, the workflow stops at its gate within seconds and costs nothing else. The same secret as the brief, plus `HAROLD_TZ`, is all it needs.

GitHub schedules only in UTC, so the workflow wakes every three hours and asks `bin/harold housekeeping start` whether a job is due: that job's day in your zone, and not yet recorded as ran or skipped today. The first wake-up after your local midnight does it, usually before your brief. When two jobs share a day (a Friday that is the 1st, or the last business day), they run on two consecutive wake-ups. `bin/harold housekeeping status` shows the gate for each job today.

The job ends with `bin/harold housekeeping finish`, which checks that the job was recorded and its daily note written, commits everything it changed (after the same secret scan as close) and pushes. A job that cannot finish is saved anyway, recorded as skipped so it does not start again that day, and noted for your next brief: a cloud checkout is thrown away after the run, so unsaved work would be lost.

**The CRM.** The workflow gives the agent no MCP servers and no CRM credentials, so the full audit's CRM consistency step is skipped there (the audit says so, and leaves you a note when people cards changed). To run that step unattended too, schedule `harold/housekeeping-prompt.md` with a runner that has a CRM tool, for example a Claude Code routine with the hosted connector attached; the step's limits in `playbook/core/knowledge-base-health.md` (what it may correct, and the "Never" list) apply either way. No housekeeping job ever logs an interaction, moves a pipeline entry or creates a task.

**Prefer a Claude Code routine (or another scheduler)?** Delete the workflow and schedule a daily run whose prompt is `harold/housekeeping-prompt.md`, with `HAROLD_TZ` in its environment. The same gate picks the job, if any; `bin/harold close` inside the routine saves the work.

## From any chat app: the hosted connector

Sessions in a workspace harness are where Harold does its full work. To reach it from somewhere without the workspace folder, such as a chat app on your phone or in a browser, deploy the connector in `tools/harold-connector`: a small remote MCP server you host yourself (Vercel, or any Node 22+ host), which reads and writes the knowledge base in your private GitHub repository through the GitHub API and, if you give it the Supabase credentials, the CRM. It accepts exactly one GitHub account (yours), keeps no database (its tokens are encrypted with your own key), has no delete tools, and refuses to write anything that looks like a secret. Add `<your deployment>/mcp` as a remote MCP server in any tool that supports them (Claude, Claude Code, Codex, Cursor, VS Code, ChatGPT and others), or give a scheduled job a personal access token; [`tools/harold-connector/README.md`](tools/harold-connector/README.md) has the deploy steps (GitHub OAuth app, environment variables) and how to connect each tool. One difference to know: boot and close do not run in a connector chat, so filing is not enforced there. The tools file directly, and the next workspace session's boot and close see what landed.

## Keeping it private

- The workspace repo must be private. Everything in it is your context.
- Credentials live in `~/.harold/env`, never in the repo. `bin/harold close` refuses to commit anything that looks like a key.
- The visualizer listens on localhost only. Do not expose its port.

## License and credit

Harold was built and documented at [harold.works](https://harold.works). Adapt this starter freely for your own use.
