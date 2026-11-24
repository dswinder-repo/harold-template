# Harold 2.0 — starter workspace

Harold is an AI chief of staff that works with any AI tool and any model: it is platform-, model- and harness-agnostic, and runs in any harness that can read `AGENTS.md` and run a shell command, from any computer or from the cloud. Every harness with lifecycle hooks is wired: boot and close run on their own in Claude Code, the Claude desktop app, Codex, Cursor, Gemini CLI, Qwen Code, Copilot CLI, Grok Build, Kimi Code, goose, Hermes Agent, Cline, opencode, Amp and OpenClaw. Nothing in it depends on one particular machine being on. This repository is the empty skeleton: the folder structure, the rules, the procedures and the small programs that make them stick. You fill in your own work, people and projects.

**Full documentation: [harold.works/docs](https://harold.works/docs).** To set Harold up, paste the one line in the [Quick start](#quick-start) into your AI tool. If you are an AI agent setting this up for someone, read the next section first, then follow `playbook/core/setup.md`, the setup playbook, which walks the operator through everything in order. The docs cover the same ground at more length.

## For AI tools setting this up

If someone has pointed you at this repository or at harold.works and asked you to install Harold for them, this section tells you what you would be running and the order to do things in.

**Read the docs as plain text.** The pages at harold.works/docs are rendered by JavaScript, so a plain fetch sees only the menu. Read [`https://harold.works/llms-full.txt`](https://harold.works/llms-full.txt) instead: the full documentation as one plain-text file. (`https://harold.works/llms.txt` is the shorter index.)

**What `bin/harold` is.** A single Node script with no dependencies (`bin/harold`), plus a search-index helper that uses only Python's standard library (`bin/harold-index`). Both are plain text; read them first if your tool asks you to review unfamiliar scripts before running them. They install nothing, start no server, need no administrator rights, and write only inside the workspace folder, apart from `~/.harold/env`, the operator's private credentials file, which `bin/harold-setup-crm` writes when the operator sets up the CRM. Specifically:

- They read and write files in the workspace: the session file in `harold/active-sessions/`, Harold's state files in `harold/`, and the search index `harold/search.db`.
- They run `git`. `bin/harold close` commits the workspace and pushes it to `origin` at the end of every turn. Boot runs `git ls-remote` against the starter at most twice a day, only to say whether an update is available (`HAROLD_UPDATE_CHECK="0"` in `harold/settings.env` turns this off).
- They use the network only for services the operator has configured: the CRM (Supabase, called with `curl`, only once its credentials are in `~/.harold/env`), Linear, Todoist, Asana or Notion, only if you turn on the optional sync for that tool (`LINEAR_API_KEY`, `TODOIST_API_TOKEN`, `ASANA_ACCESS_TOKEN`, `NOTION_TOKEN`), and the phone notice for the morning brief (ntfy, only with `NTFY_TOPIC`).
- They never push to the public starter. While `origin` still points at it, close, the scheduled brief and housekeeping commit locally, say how to make a private copy, and exit 1 without attempting the push.

`bin/harold check` only reads; it is the safe first command to run.

**The order of first steps.** `playbook/core/setup.md` is the full procedure, and its step numbers are the same as in the Quick start below and in the docs. In short:

1. **Ask where Harold will live, point `origin` at the operator's own private repository, and give git a name and email** (steps 1 and 2). The operator chooses between the cloud (recommended: Harold lives only in their private GitHub repository and they work in cloud sessions from it) and a folder on their own computer; step 1 explains both in plain words and what changes for each. Do this before anything runs `bin/harold close`, because close commits and pushes on every turn. A clone of the public starter still has the starter as `origin`, and Harold refuses to push there.
2. **Run `bin/harold check`** (step 3). It should print `RESULT: PASS`.
3. **Ask the operator for their details and fill in the placeholders yourself** (steps 4 to 7): time zone, name, role, contact types, their first projects. Ask in conversation; never guess, and never ask them to edit files.
4. **Deploy the connector and create the CRM database** (step 8). The connector is a required part of Harold: it is how every AI tool, the operator's phone included, reaches the knowledge base, the CRM and the task list. Do everything you can yourself (the Vercel CLI once the operator has signed in, the database tables, the settings, the `curl` checks), and tell the operator exactly what to click for the parts only a person can do: creating free Vercel and Supabase accounts and filling in GitHub's OAuth app form.
5. **Check the CRM and the task list, and offer to import contacts** (step 9). The CRM is part of Harold, not an add-on: close checks that every contact touched was filed in it.
6. **Offer the optional parts one at a time** (step 10): the CRM web app, two-way sync between Harold's task list and Linear, Todoist, Asana or Notion, scheduled jobs and extra harnesses. Each can be skipped and added at any time.
7. **Run `bin/harold check`, then a first boot and close** (step 11), and follow `AGENTS.md` from there. Until setup is complete, boot opens with a short "not set up yet" notice that names what is left.

## What makes 2.0 different

Harold's instructions live in plain markdown. 2.0 adds a floor under them: `bin/harold`, a zero-dependency Node program that runs at the start and end of every session.

- **`bin/harold boot`** gets the real date, verifies that the constitution, every core file and every playbook can be read, loads the lessons, the project map, alerts, blockers, the projects that have gone quiet and the scheduled work that is due, and registers the session. If anything cannot be read, it **refuses** rather than letting the session start blind.
- **The context gate.** Harnesses pass only so much hook output to the model (Claude Code, for example, shows a 2 KB preview of anything over about 10 KB; other harnesses set their own limits). When boot's context is larger than `HAROLD_HOOK_BUDGET` (9000 characters by default), boot hands the model a short digest and writes the rest as parts; `bin/harold context` prints them one at a time. Until every part is read, the pre-tool hook `bin/harold gate` holds every other tool (Claude Code, the Claude desktop app, Codex, Gemini CLI, Qwen Code, Cursor, Copilot CLI, Grok Build, Kimi Code, Hermes Agent) and close blocks the turn (everywhere). The gate fails open. Lessons are listed one line each within a fixed budget, and `bin/harold learnings` prints them in full, so boot does not grow as lessons pile up.
- **`bin/harold close`** runs at the end of every turn. It checks that changed knowledge was written to today's daily note, that every contact touched was filed, that every action item in a meeting note written this session carries its task ID, that due scheduled work was recorded, that every boot context part was read, and that new work belongs to a project (a new intel or decision note names its project in `project:` frontmatter, and a new top-level folder has an entry in the project map). If something is missing it blocks the turn with the exact list. When everything passes, it scans for secrets and commits and pushes the workspace.

## Quick start

**Choose where Harold lives.** There are two ways, and setup asks you first:

- **In the cloud (recommended).** Harold lives only in your private GitHub repository. You work with it in cloud sessions started from that repository (for example Claude Code on the web or in the Claude app, Codex cloud tasks or Cursor background agents), which copy it at the start and save back at the end of every turn. Chat apps on your phone and the web reach it through the connector. Nothing stays on your computer. You need an AI tool that runs cloud sessions from a GitHub repository; if the tool limits which sites its sessions can reach, allow GitHub, Vercel and Supabase in its settings for setup.
- **On your own computer.** A working copy in a folder on your computer, opened in your AI tool there. It is still saved to your private GitHub repository every turn, and chats still go through the connector. Your computer needs git, Node and Python.

Either way, the connector is required.

**The easy way: let your AI tool set it up.** Paste this line into an AI tool that can run commands, either in a folder on your computer or in a cloud session:

```text
Set up Harold for me: follow the setup playbook at https://github.com/dswinder-repo/harold-template/blob/main/playbook/core/setup.md, and read https://harold.works/llms-full.txt for anything it doesn't cover.
```

It asks where you want Harold to live, makes your private copy of this starter and walks you through the whole setup in conversation, doing the work itself. If you choose the cloud but start from a tool on your computer, it can do the setup there and then tell you how to open Harold in your cloud tool. You answer its questions, create a few free accounts (GitHub, Vercel, Supabase), sign in when it opens a browser, and fill in one form on GitHub.

**Required:** your own private repository, your details, the connector and the CRM (a Supabase database the connector reaches). **Optional:** the CRM web app, two-way sync between Harold's task list and Linear, Todoist, Asana or Notion, scheduled jobs and extra harnesses. Harold has its own task list, so none of those tools is needed.

The steps below are the same steps, with the same numbers, as the setup playbook (`playbook/core/setup.md`) and [Initial Setup](https://harold.works/docs/#getting-started/initial-setup) in the docs, condensed for doing it by hand.

1. **Choose where Harold lives (above), and make it your own private repository.** Every close commits your work and pushes it to `origin`, so `origin` must be a **private** repository of your own: it will hold your working life. On this repository's GitHub page choose **Use this template → Create a new repository**, set it to **Private**, and clone your copy (`git clone https://github.com/<you>/<your-repo>.git my-harold`). Or by hand: create an empty **private** repository on GitHub (no README, no license), clone the starter, point `origin` at your repository and push:
   ```bash
   git clone https://github.com/dswinder-repo/harold-template.git my-harold
   cd my-harold
   git remote set-url origin https://github.com/<you>/<your-repo>.git
   git push -u origin main
   ```
   Do this before your first session. Until `origin` points at your own repository, boot says the workspace is not set up yet, and close commits locally but refuses to push.
   For the cloud, you only need the private repository: start a cloud session on it in your AI tool and do the remaining steps there. On your computer (or to do setup from it), the requirements are git, curl, Node 22+ and Python 3.8+ (standard library only, for search and the link graph). Nothing in this repository needs a newer Python; the Model Council add-on the docs describe lives in its own repository and needs Python 3.10+. The CRM web app also needs pnpm, only where you build it. Keep the workspace out of iCloud/Dropbox-style synced folders if you can; boot catches evicted files, but it is better not to have them.

2. **Tell git who you are**, unless this computer already has a git identity: `git config user.name "<your name>" && git config user.email "<your email>"`. Put the same name, email and GitHub account in the **Git & GitHub Workflow** section of `AGENTS.md`.

3. **Check it works as-is.**
   ```bash
   bin/harold check     # → RESULT: PASS, with warnings that HAROLD_TZ is not set and origin is still the starter (both clear during setup)
   ```

4. **Set your time zone** in `harold/settings.env` (uncomment the line and put your zone):
   ```bash
   HAROLD_TZ="America/Chicago"
   ```
   That file is committed and holds only non-secret `HAROLD_*` settings (`HAROLD_TZ`, `HAROLD_BRIEF_TIME`, `HAROLD_STALE_DAYS`, `HAROLD_PULSE_DAYS`, and `HAROLD_CHECKS`, your own check scripts that `bin/harold check` and boot run), so every computer, cloud session and scheduled job gets them with nothing to set up. A value in the environment or in `~/.harold/env` (the per-machine file where credentials live) overrides it. Without a zone, Harold uses the time zone of whatever machine it runs on (which, in the cloud, is usually UTC).

5. **Fill in your details.** Search for `[YOUR` and replace: `AGENTS.md` (name, role, time zone, git identity), `memory/working-memory.md`, the `dashboard/` modules, and the config table at the top of `playbook/core/morning-brief.md`. Then replace the example content (Jane Doe, Acme Corp, "Example Project", blocker B001, the example lesson L001, the example event) with your own, or delete it. Until you do, it is inert: the example blocker and event carry no dates, so they never fall due, and your first boot starts the clock for scheduled work (it writes a `harold-start` line into the empty `harold/trigger-log.jsonl`, so the weekly scan, full audit and month-end review count from the next day, and nothing the starter's own dates imply is ever "overdue"). Your first session closes cleanly with the examples still in place.

6. **Choose your contact types** in `dashboard/people.md`: a short list (for example investor, partner, founder, team, other), one per contact. Labels cover everything else.

7. **Add your first projects**: one to three, each with a folder, an entry in `harold/projects.md` with its next step, and a card in `vault/projects/` (`playbook/core/project-intake.md`).

8. **Deploy the connector (required).** The connector (`tools/harold-connector`) is how Harold is reached from your phone, the Claude website and any AI tool on any device, and it carries the CRM and the task list. It runs in your own free Vercel account; [`tools/harold-connector/README.md`](tools/harold-connector/README.md) has a **Deploy with Vercel** button and every detail. In order:
   - **Deploy it.** In Vercel, import your private repository with **Root Directory** `tools/harold-connector` (or use the button). On Vercel the connector works out its repository, the one GitHub account allowed in (yours), its encryption key and its public address by itself. Set the project's Ignored Build Step to `git diff HEAD^ HEAD --quiet -- .`, so the push at the end of every turn redeploys it only when the connector itself changed.
   - **The CRM database.** If Vercel offers its Supabase integration for the project, use it: it creates the Supabase project and fills in `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` for you. Otherwise create a free project at supabase.com and keep its address and service role key. Either way, run `tools/harold-mcp/schema.sql` in its SQL editor.
   - **The GitHub OAuth app.** Open the connector's address (`https://<project>.vercel.app`): its home page shows the homepage and callback addresses to use. Create the app at github.com → Settings → Developer settings → OAuth Apps → New OAuth App with those two addresses, then generate a client secret.
   - **Settings and redeploy.** In Vercel's Environment Variables, set `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`, plus `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` unless the integration filled them in (and `HAROLD_TZ` for your dates). Redeploy, and check it with the `curl` commands in the connector README.
   - **Add it to your tools.** Add `<address>/mcp` as a remote MCP server (a "custom connector" in chat apps) in every AI tool you use; the connector README lists each tool's way. Signing in goes through your GitHub account, and only yours is accepted.
   - **If a check gets a Vercel login page** instead of the connector, Vercel's deployment protection is blocking it: use the production address, and if needed turn off Vercel Authentication for production (Settings → Deployment Protection).

   **Fallback for a tool that cannot connect to a remote MCP server:** harold-mcp, a local tool server that reaches the same database from one computer. `bin/harold-setup-crm` stores the Supabase address and service role key in `~/.harold/env` and tests them; then `(cd tools/harold-mcp && npm install)` and add `bin/harold-mcp` to that tool as a local MCP server by its absolute path (`.mcp.example.json`, `.cursor/mcp.example.json` and `.codex/config.example.toml` show the shape; the copies are gitignored). Those two values in `~/.harold/env` are worth having on the computer where you work even with the connector: `bin/harold` then writes tasks and CRM records directly, and boot and close apply the offline CRM queue (`harold/crm-queue.jsonl`).

9. **The CRM and Harold's task list.** The CRM is part of Harold: every contact you touch is filed there as well as in the vault, and close checks it. Your AI tool can import your existing contacts from a CSV export. Harold's task list lives in the same database, so it needs no outside tool. Boot lists the tasks that are due; the connector's `task_list`, `task_create` and `task_update` manage them from any tool, and `bin/harold task list|create|start|done|cancel|reopen|update` does the same in a workspace session (without the database key, its writes are queued and the list is read from `harold/tasks-snapshot.md`). Action items become tasks automatically: paste call notes or a transcript, or forward an email, and every commitment in it (yours, or something someone owes you) becomes a task without you asking, with its ref (for example `H-12`) written into the meeting note's `## Action items`.

10. **The optional parts.** Each can be skipped and added at any time.
    - **The CRM web app.** `tools/harold-crm` is a CRM you open in a browser (contacts, pipeline, tasks, notifications, audit trail), on the same database. [`tools/harold-crm/README.md`](tools/harold-crm/README.md) has the steps; in short: run `tools/harold-crm/supabase/migrations/002` to `007` in the SQL editor in order (`001` is the schema you already ran); deploy it on Vercel or any Next.js host with **Root Directory** `tools/harold-crm` and `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (the publishable key, never the service role key); in Supabase, create your user, add yourself as a member (`crm_members`), and turn off sign-ups. Optional AI (contact research, enrichment, meeting prep) runs on Google Gemini, whose free tier covers it: get a free API key at [Google AI Studio](https://aistudio.google.com/apikey) and set it as `GEMINI_API_KEY` in the host's environment variables (and in `tools/harold-crm/.env.local` for local development). Without it, the AI buttons say AI is off.
    - **The task tool you already use.** If you use Linear, Todoist, Asana or Notion, keep using it: the connector syncs Harold's task list with it in both directions, and any mix of the four works at once. Changes to different fields on the two sides are both kept; when the same field changed on both sides, the later change wins and the conflict is logged (`bin/harold task conflicts`). The steps are in `playbook/core/setup.md` (the sections "Optional: two-way sync with ...") and `tools/harold-connector/README.md`.
    - **Scheduled jobs.** The morning brief and the weekly, monthly and month-end housekeeping can run on GitHub's machines ([below](#scheduled-jobs-in-the-cloud)). Each is off until you set it up.
    - **More harnesses.** Some need a one-time step (trusting the hooks, or a snippet in your user config); see [Any AI tool, any model](#any-ai-tool-any-model).

11. **Check, start a session and say good morning**, in whichever harness you use. Run `bin/harold check` (it should pass with no warnings about the time zone or `origin`). Most harnesses run boot and close from the hook files and plugins already in this repository (some ask you to trust them once); Kimi Code and Hermes Agent need a snippet copied into your user config, and OpenClaw a plugin install. Where a harness has no hooks, the first instruction in `AGENTS.md` has the agent run them. Details below.

## Any AI tool, any model

Harold is platform-, model- and harness-agnostic. A harness is the app or command-line tool that runs an AI model and lets it read your files and run commands. Harold is plain files in a git repository plus a small command-line program, so it works with any harness that can do three things:

1. **Read an instruction file at the start.** `AGENTS.md` is the shared file name many AI agent tools read on their own ([agents.md](https://agents.md)). For one that doesn't, point it at `AGENTS.md`.
2. **Run a shell command:** `bin/harold boot` at the start of a session, `bin/harold close` at the end of every turn.
3. **Ideally, connect to MCP servers** ([an open standard](https://modelcontextprotocol.io/introduction)) for the CRM and knowledge tools. Without MCP the agent still works from the files; CRM and task changes it cannot make wait in `harold/crm-queue.jsonl`, which boot and close apply once the CRM's credentials are present. A waiting write is never silent: `bin/harold queue` lists each one, and close asks for it to be applied or deferred for the day.

Any model the harness offers works; Harold doesn't depend on a particular one, because the checks are a program, not the model. Automatic hooks are a convenience: where a harness supports them, the checks run on their own; where it doesn't, the first instruction in `AGENTS.md` has the agent run them. Switching harness or model doesn't mean rebuilding anything: the knowledge, rules and tools stay the same.

### Any other harness: a checklist

1. **Instructions.** If it reads `AGENTS.md`, nothing to do. Otherwise add one line to its own rules file: read and follow `AGENTS.md` at the start of every session.
2. **With hooks.** From the workspace root, run `bin/harold boot` at session start, `bin/harold close` at the end of every turn and `bin/harold close --final` at session end, with no `--via` flag (that flag is only for the harnesses below). If the hook passes input on stdin, add `< /dev/null` so Harold answers in plain text. Boot prints the context to hand the agent and exits 0, or prints `⛔ HAROLD BOOT REFUSED` and exits 2. Close exits 0 when everything is filed and pushed, 2 with the list of what is missing on stderr (send it back to the agent, which fixes it and closes again), or 1 when only the push failed.
3. **Without hooks.** Nothing to wire: `AGENTS.md` tells the agent to run boot first and close at the end of every turn. Every command also works by hand in a terminal.
4. **MCP.** Add the connector, `<your connector address>/mcp`, as a remote MCP server: one deployment serves every tool. Only if the harness cannot connect to a remote MCP server, add the fallback, `bin/harold-mcp`, as a local (command) MCP server with its absolute path. It reads the CRM's address and key from `~/.harold/env`, so nothing secret goes in the harness's settings.
5. **Scheduled jobs.** Any harness with a headless mode can run them: on a schedule, with `harold/brief-prompt.md` (the morning brief) or `harold/housekeeping-prompt.md` (weekly scan, full audit, month-end review) as the prompt. Each prompt runs its own `start` gate and `finish` step. In the starter's workflows, set `HAROLD_AGENT` to one of the presets, or to `custom` with your CLI's command ([Scheduled jobs in the cloud](#scheduled-jobs-in-the-cloud)); the gate before it and the finish step after it stay the same.

### Every harness with lifecycle hooks is wired

If a harness has a hook or plugin mechanism for the start of a session, the end of a turn or the end of a session, this repository wires boot and close into it. Each wiring passes `--via=<harness>`, so `bin/harold` answers in that harness's own format; `tests/hooks.test.js` and `tests/harnesses.test.js` feed each harness's documented hook input to boot and close and check the answers. Where a harness has no hooks, the first instruction in `AGENTS.md` is the fallback: the agent runs boot and close itself.

| Harness | Hooks? | Wiring in this repository | Start → boot | End of every turn → close | Session end → close --final | Source checked |
|---|---|---|---|---|---|---|
| Claude Code | yes | `.claude/settings.json` | `SessionStart` | `Stop` | `SessionEnd` | Claude Code hooks docs |
| Claude desktop app (Cowork) | yes | plugin `tools/harold-plugin/` (installed from your repository as a marketplace) | `SessionStart` + `boot-harold` skill | `Stop` | `SessionEnd` | Claude Code plugin hooks |
| Codex | yes | `.codex/hooks.json` (trust once with `/hooks`) | `SessionStart` | `Stop` | `SessionEnd` (3 s limit: detached) | Codex hooks docs |
| Cursor | yes | `.cursor/hooks.json` | `sessionStart` | `stop` (follow-up message) | `sessionEnd` | Cursor hooks docs |
| Gemini CLI | yes | `.gemini/settings.json` | `SessionStart` (`additionalContext`) | `AfterAgent` (`decision: block` retries) | `SessionEnd` (not awaited: detached) | google-gemini/gemini-cli `docs/hooks/`, `packages/core/src/hooks/` |
| Qwen Code | yes | `.qwen/settings.json` | `SessionStart` (plain stdout) | `Stop` | `SessionEnd` | QwenLM/qwen-code `docs/users/features/hooks.md` |
| GitHub Copilot CLI | yes | `.github/copilot/settings.json` | `sessionStart` (`additionalContext`) | `agentStop` (`decision: block`) | `sessionEnd` (detached) | github/docs `content/copilot/reference/hooks-reference.md` |
| Grok Build | yes | `.grok/hooks/harold.json` | `SessionStart` registers only ¹ | `Stop` | `SessionEnd` (1.5 s budget: detached) | xai-org/grok-build `docs/user-guide/10-hooks.md`, `xai-grok-hooks` |
| Kimi Code CLI | yes, user-level only | `tools/harness-hooks/kimi-config.toml` → copy into `~/.kimi-code/config.toml` | `SessionStart` registers only ¹ | `Stop` (exit 2) | `SessionEnd` (5 s: detached) | MoonshotAI/kimi-cli `docs/en/customization/hooks.md`, `src/kimi_cli/hooks/` |
| goose | yes | plugin `.agents/plugins/harold/` | `SessionStart` registers only ¹ | `Stop` (`decision: block`) | `SessionEnd` | block/goose `documentation/docs/guides/context-engineering/hooks.md` |
| Hermes Agent | yes, user-level only | `tools/harness-hooks/hermes-config.yaml` → merge into `~/.hermes/config.yaml` | first `pre_llm_call` (`context`) | `pre_verify` (blocks, after file edits) + `on_session_end` | `on_session_finalize` (detached) | NousResearch/hermes-agent `website/docs/user-guide/features/hooks.md`, `agent/shell_hooks.py` |
| Cline | yes | `.clinerules/hooks/` | `TaskStart` (`contextModification`) | `TaskComplete` (cannot block ²) | `SessionShutdown` (CLI only) | cline/cline `apps/vscode/src/sdk/hooks-adapter.ts`, `sdk/packages/core/src/hooks/` |
| opencode | yes (plugins) | plugin `.opencode/plugins/harold.js` | system prompt of each session | `session.idle` (reason sent back as a message) | session deleted, shutdown | sst/opencode `packages/plugin/src/index.ts`, plugins docs |
| Amp | yes (plugins) | plugin `.amp/plugins/harold.ts` | first `agent.start` of a thread | `agent.end` (`action: continue`) | plugin dispose (detached) | `@ampcode/plugin` `index.d.ts` |
| OpenClaw | yes (plugins) | plugin `tools/openclaw-plugin/` (install + allow conversation access) | first `before_prompt_build` (`prependContext`) | `before_agent_finalize` (`revise`) + `agent_end` | `session_end` (detached) | openclaw/openclaw `docs/plugins/hooks*`, `src/plugins/hook-types.ts` |
| Continue CLI | no (not yet) | none: `AGENTS.md` | | | | continuedev/continue `extensions/cli/src/hooks/`: Claude-compatible hook code reads `.claude/settings.json`, but nothing fires `SessionStart`, `Stop` or `SessionEnd` (July 2026) |
| Zed agent | no | none: `AGENTS.md` | | | | zed-industries/zed `docs/src/ai/`, `docs/src/tasks.md` (only a `create_worktree` task hook) |
| Antigravity CLI | unverified | none: `AGENTS.md` | | | | google-antigravity/antigravity-cli `CHANGELOG.md` names `.agents/hooks.json` with `Stop` and `PostInvocation`, but its input and output formats and any session-start event are not published anywhere reachable |
| Windsurf (Cascade) | unverified | none: `AGENTS.md` | | | | no public source found; its documentation site could not be reached when this table was checked |
| Kiro | unverified | none: `AGENTS.md` | | | | closed source (kirodotdev/Kiro holds issues only), and kiro.dev could not be reached when this table was checked. Its predecessor, Amazon Q Developer CLI (aws/amazon-q-developer-cli `docs/hooks.md`), had `agentSpawn` and `stop` hooks |

¹ These three never show session-start hook output to the model. The hook registers the session; the agent then runs `bin/harold boot` itself, as `AGENTS.md` says, and that run prints the context for the same session (one session file, not two). Until it has, close blocks the turn with "run bin/harold boot".
² Cline's `TaskComplete` cannot keep the agent going, so close runs there in the background (no 30-second limit) and the next `TaskStart` hands the model whatever it found unfiled. Hermes's `on_session_end` works the same way for turns in which `pre_verify` did not fire.

**Borrowed hook files.** Cursor and Grok Build load `.claude/settings.json`, Grok Build also `.cursor/hooks.json`, and Copilot CLI also `.claude/settings.json`. When a borrowed hook fires and the harness's own Harold wiring is present, it answers "nothing to do" and the harness's own hook does the work, once; delete that file and the borrowed hook does the work in the harness's format. Two closes of one session never run at once (the second steps aside), and a second boot within two minutes prints one line.

**Copilot's cloud agent** reads only `.github/hooks/*.json`, not `.github/copilot/settings.json`, so these hooks run in Copilot CLI and not in cloud agent jobs, where the agent's commits go to a pull request rather than straight to your knowledge base.

**Per harness:**
- **Claude Code.** Open the workspace folder and start a session.
- **Claude desktop app (Cowork).** Add your private repository as a marketplace (Customize, then Plugins, then Add marketplace), install the `harold` plugin, and connect the workspace folder to a task. The desktop app must be open. Steps: `playbook/core/setup.md`, "Optional: Cowork".
- **Codex.** Codex runs a project's hooks only after you trust them: start Codex in the workspace, type `/hooks`, review the three Harold hooks and trust them (again after any edit to the file). Its `SessionEnd` hook may run for three seconds, so `close --final` hands its work to a background process (`--detach`); output goes to `harold/active-sessions/.state/<session>.detached.log`.
- **Cursor.** Runs `.cursor/hooks.json` in a trusted workspace. If filing is missing, Cursor gets a follow-up message and keeps going. Cursor's cloud agents do not run `sessionStart` or `sessionEnd`; there the agent runs boot itself.
- **Gemini CLI, Qwen Code, Grok Build.** Project hooks run once you trust the folder (Gemini also warns once per new hook; Grok: `/hooks-trust` or `--trust`).
- **Copilot CLI.** Reads `.github/copilot/settings.json` in a trusted folder; in prompt mode (`-p`) it fires `sessionEnd` after each prompt.
- **Kimi Code CLI and Hermes Agent.** Both read hooks only from your user config, so copy the snippet from `tools/harness-hooks/` once. Each command does nothing unless the tool runs inside a Harold workspace (or `HAROLD_ROOT` names one). Hermes asks you to approve each hook once (or start it with `--accept-hooks`).
- **goose.** Loads `.agents/plugins/harold/` when it works in the workspace.
- **Cline.** The Cline command-line tool runs hooks by default; in the VS Code extension, turn hooks on in Cline's settings. The scripts in `.clinerules/hooks/` must stay executable.
- **opencode.** Loads `.opencode/plugins/harold.js` at startup. It uses `experimental.chat.system.transform` for the context; if a later opencode drops that, the agent boots itself from `AGENTS.md`.
- **Amp.** Loads `.amp/plugins/harold.ts`; after editing it, run `plugins: reload`.
- **OpenClaw.** `openclaw plugins install --link tools/openclaw-plugin`, `openclaw plugins enable harold`, then in `openclaw.json` set `plugins.entries.harold.hooks.allowConversationAccess: true` (and `config.root` if the agent's workspace is not the Harold workspace). See `tools/openclaw-plugin/README.md`.

### MCP tools and scheduled jobs

Every harness below that supports remote MCP servers uses the connector: add `<your connector address>/mcp` once and the knowledge-base, CRM and task tools are there, with no per-computer setup ([`tools/harold-connector/README.md`](tools/harold-connector/README.md), "Connect your tool", has each one's command or menu). The middle column is only the fallback, harold-mcp, for a harness or computer that cannot reach a remote MCP server.

| Harness | Fallback: harold-mcp (local CRM tools) | Scheduled jobs (`HAROLD_AGENT`) |
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
.clinerules/hooks/         Cline hooks: TaskStart, TaskComplete, TaskCancel, TaskError, SessionShutdown
.opencode/plugins/harold.js  opencode plugin: boot into the system prompt, close on session.idle
.amp/plugins/harold.ts     Amp plugin: boot on agent.start, close on agent.end
.mcp.example.json          Claude Code MCP config for bin/harold-mcp (copy to .mcp.json, gitignored)
bin/
  harold                   boot | context | gate | check | close | file (learning|trigger|daily|crm|heartbeat) |
                           learnings | replay | task | brief | housekeeping | update | where | search | related |
                           backlinks | pulse | heartbeats | index | root
  harold-index             SQLite FTS5 search index and link graph over every markdown file, archives included
                           (Python stdlib)
  harold-mcp               launches the MCP server with credentials from ~/.harold/env
  harold-linear            optional direct Linear helper (the task list itself is `bin/harold task`)
  harold-setup-crm         stores your Supabase URL + key outside the repo and tests them
  harold-agent-auth        scheduled jobs: keeps a subscription sign-in file fresh between runs (encrypted
                           in the Actions cache), and passes a custom agent only the secrets it names
harold/                    operational state
  alerts.md  blockers.md  events.md  facts.md  projects.md  sync-map.md
  learnings.jsonl  trigger-log.jsonl  crm-queue.jsonl  active-sessions/  briefs/  brief-prompt.md
  graph.json               the link graph (paths, titles, types, dates, links; no note text), written by close
  search.db                the search index and link graph (gitignored, rebuilt whenever a file changed)
  housekeeping.json        the switch for cloud housekeeping ("cloud": false until you turn it on)
  housekeeping-prompt.md   the prompt the scheduled housekeeping job runs
  settings.env             your non-secret settings (HAROLD_TZ, HAROLD_BRIEF_TIME, ...), committed
  update-manifest.txt      which files are Harold's machinery (what bin/harold update may change)
  upstream.json            where updates come from, and the starter commit last applied
memory/                    working-memory.md (working memory), glossary.md
dashboard/                 index.md, status.md, processes.md (Context Engine), people.md, strategy.md
vault/                     people/ companies/ projects/ intel/ decisions/ meetings/ daily/ templates/
raw/                       inbox for unprocessed sources
projects/example/          an example project folder (mapped in harold/projects.md)
playbook/
  README.md                the index boot checks
  core/                    21 portable playbooks (setup, morning brief, debrief, intake, analyst, QC, ...)
  engagements/example/     how to add employer- or client-specific playbooks
tools/
  harold-mcp/              local fallback MCP server for tools without remote MCP (13 tools: CRM, pipeline, alerts engine, markdown writers) + schema.sql
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
  brief-notify.yml         OPTIONAL phone notice (ntfy) when anything pushes a new brief draft; off until NTFY_TOPIC is set
.github/actions/harold-agent/
  action.yml               runs the chosen agent for both jobs: Claude Code, Codex, Cursor, Gemini CLI, Copilot CLI,
                           Grok Build, Kimi Code, Qwen Code, or any other CLI through a custom command
tests/
  brief-gate.test.js       tests for the brief schedule gate: node --test tests/brief-gate.test.js
  hooks.test.js            boot and close as Claude Code, Codex and Cursor hooks: node --test tests/hooks.test.js
  harnesses.test.js        the same for every other wired harness and the three plugins: node --test tests/harnesses.test.js
  crm.test.js              one CRM schema (001 = schema.sql) and contact filing: node --test tests/crm.test.js
  housekeeping.test.js     the housekeeping gate across time zones, the job, and close inside it: node --test tests/housekeeping.test.js
  agent-action.test.js     each agent's credential choice (subscription first) and what it is given, with stub CLIs
  agent-auth.test.js       sign-in files kept fresh across runs, and a custom agent's secrets
  index.test.js            search, related, backlinks and graph.json end to end; runs test_harold_index.py
  test_harold_index.py     the link graph: resolution, backlinks, traversal, stale and broken flags, archives; project
                           pulse, against the fixture the connector's tests share (same files, same answer)
  pulse.test.js            bin/harold pulse and the project pulse in boot, end to end
  first-run.test.js        a fresh install: first boot and first close pass on any date, with the examples in place
  action-items.test.js     close blocks on a meeting note whose action items carry no task reference
  close-push.test.js       close never reports "nothing to push" over commits that did not reach the remote
  context-gate.test.js     a boot context larger than the hook budget is served as parts, and the gate holds until all are read
  update.test.js           bin/harold update and the committed harold/settings.env
  setup.test.js            boot's "not set up yet" notice, and close, brief and housekeeping never pushing to the public starter
  tasks.test.js            Harold's task list: the commands, the offline queue and the snapshot, against a mock database
  heartbeats.test.js       close rolls each heartbeats.jsonl, keeping recent entries and moving older ones to monthly files
```

Run them all with `node --test tests/*.test.js` (Node 22+ and Python 3.8+). `tests/crm.test.js` also runs the CRM app's migration checks once `pnpm install` has run in `tools/harold-crm`.

### The CRM model

Every contact has exactly **one type**, from a short list you choose (for example investor, partner, founder, team, other), **any number of labels**, and a **warmth**: Hot, Warm, Lukewarm, Cold, or unrated. There is **one pipeline**; every entry in it has a required **purpose** ("Raising the seed round") and one of seven stages: Identified, Reached Out, In Conversation, Advancing, Committed, Active, Dormant. `tools/harold-mcp/schema.sql` creates exactly the tables the MCP server uses: `contacts`, `contact_categories` (labels), `contact_pipelines`, `pipeline_stages`, `stage_changes`, `interactions`, `tasks` (Harold's task list), `task_links`, `sync_log`, `sync_state`; the web app adds its own tables around them.

Every conversation with a contact is logged, and every contact is filed the same way, whatever its type. The one exception is a person whose vault card says `crm: none`: they are deliberately kept out of the CRM, and only their vault profile is updated. `playbook/core/crm-filing.md` describes the full procedure.

## Finding things: search and the link graph

`bin/harold search "<query>"` is full-text search over every markdown file in the workspace (the knowledge directories, every folder in the project map, and archives: `archive/` folders and `*-archive.md` files). Each hit also lists the notes it links to. `bin/harold related "<person, company, project or topic>"` follows the links from a note, one hop or two (`--depth 2`): people, companies, projects, decisions and meetings, how each is linked and the line where, and a closing `gaps:` line (stale notes, broken links, orphans, no meeting notes). `bin/harold backlinks "<note>"` lists everything that points at a note. Links are `[[wikilinks]]` (by file name, title or `aliases:`), relative markdown links, and frontmatter fields that name notes (`company`, `project`, `people`, `attendees`, `related`). A note counts as stale after `HAROLD_STALE_DAYS` (default 30) without an update; daily notes, meetings and archives never do.

All of it lives in `harold/search.db`, which boot, search and close rebuild whenever a file changed (only changed files are read). Close also writes `harold/graph.json`, a compact copy of the graph with no note text, and commits it, so anything that reads your repository (the connector's `harold_read`, for example) can see the links without the workspace.

## Project pulse: which projects have gone quiet

`crm_stale` tells you which people you are dropping; `bin/harold pulse` does the same for projects. For each active project in `harold/projects.md` it shows the newest activity, what it was and its date, the next step, and a flag when the project has gone quiet:

```
- Example Project — quiet 19 days (last: meeting note 2026-09-18, "Acme kickoff"); next step: Send Jane Doe the signed NDA
```

- **Activity** is the newest of: the project card, any note that links to it, the meeting, daily and decision notes it links to, any note in the project's folder, daily and meeting notes that name the project or one of its aliases (in the title or a heading; in the text only when the note names at most three projects, so a monthly review that walks through every project is not activity for all of them), and the newest git commit touching its folder. Note dates are the ones written in the notes (`last_updated`, `date`, or a dated file name); a date after today (a planned meeting) does not count.
- **Next step** is `next_step:` in the project's `harold/projects.md` entry, else `next_step:` in its card's frontmatter, else a `Next step:` line (or the first line under a `Next step` heading) in the card, then in the folder's `README.md`. With none, it says "no next step recorded", which is a gap worth closing.
- **Quiet** means no activity in more than `HAROLD_PULSE_DAYS` days (default 14, set it in `harold/settings.env`). Paused and archived projects are not judged.
- **Heartbeats** let a project report for itself. At each finished piece of work, a session posts one with `bin/harold file heartbeat '{"project":"<name or alias>","done":"what finished","running":"what is in progress","waiting":"what waits on you, with due dates","detail":"<repo file with the detail>"}'`. It is appended to `<project folder>/heartbeats.jsonl` (the project resolved through `harold/projects.md`), and a project that has heartbeats is judged by its newest one.

Quiet projects come first, with their next step; the rest follow in one line each. `--all` adds every next step and lists the projects that are not active; `--json` gives the data. Boot prints only the quiet ones (or one line saying all are active), and the morning brief lists them under WATCH next to stale relationships. The connector's `harold_pulse` computes the same thing from `harold/graph.json`, the project map and the repository's commit history, so a chat on your phone gets the same answer as a terminal session.

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
- **Cursor.** Create a User API key in the Cursor dashboard (Integrations) and store it as `CURSOR_API_KEY`. Cursor's own SDK guide describes a User API key as running "as a specific user"; no published source says whether headless use draws on your plan's included usage.
- **Gemini CLI.** Sign in with Google once in a throwaway home folder, just for the scheduled jobs, and store the file it writes (run this inside your repository, so `gh` knows which one):
  ```bash
  export SIGNIN_HOME="$(mktemp -d)"
  HOME="$SIGNIN_HOME" gemini        # choose "Sign in with Google", then /quit
  gh secret set GEMINI_OAUTH_CREDS < "$SIGNIN_HOME/.gemini/oauth_creds.json"
  rm -rf "$SIGNIN_HOME"
  ```
  The job sets `GOOGLE_GENAI_USE_GCA=true` so Gemini CLI uses it. If personal sign-in does not work for your account, set `GEMINI_API_KEY` instead.
- **Copilot CLI.** Create a fine-grained personal access token at github.com/settings/personal-access-tokens/new with the "Copilot Requests" permission, and store it as `COPILOT_GITHUB_TOKEN`. Each prompt uses your plan's premium requests.
- **Grok Build.** `GROK_HOME="$HOME/.grok-harold" grok login` (or `--device-auth`), then `gh secret set GROK_AUTH_JSON < "$HOME/.grok-harold/auth.json"` and delete that folder. The renewal and cache handling is the same as for Codex.
- **Kimi Code CLI.** Store your Kimi Code API key (the one its `/login` asks for) as `KIMI_API_KEY`. The job writes the provider settings its documentation gives (`https://api.kimi.com/coding/v1`, model `kimi-for-coding`).
- **Qwen Code.** Store your Coding Plan key (`sk-sp-…`) as `QWEN_CODING_PLAN_KEY`. The job uses the international endpoint; for an account in the Beijing region set `HAROLD_AGENT_BASE_URL` to `https://coding.dashscope.aliyuncs.com/v1`.

How tightly each agent is limited differs because the CLIs differ: Claude Code, Gemini CLI, Copilot CLI, Grok Build and Qwen Code get an explicit list of allowed commands; Codex runs in its workspace-write sandbox; Cursor (`--force`) and Kimi (prompt mode) approve every tool call, because their headless modes have no per-command list. In every case the job's last step, outside the agent, checks the result, refuses to commit anything that looks like a credential, and pushes.

### Claude Code with another model provider

Several providers sell coding plans for their own models behind an Anthropic-compatible endpoint, so Claude Code can run on them. Add the repository secrets `ANTHROPIC_BASE_URL` (the provider's endpoint) and `ANTHROPIC_AUTH_TOKEN` (your plan's or account's key), and optionally `ANTHROPIC_MODEL` (a secret or a variable); leave `HAROLD_AGENT` as `claude`. When `ANTHROPIC_BASE_URL` is set, the job uses that provider and not your Claude credentials.

| Provider | `ANTHROPIC_BASE_URL` | Example model |
|---|---|---|
| Moonshot (Kimi) | `https://api.moonshot.ai/anthropic` | `kimi-k2.5` |
| Zhipu Z.ai (GLM Coding Plan) | `https://api.z.ai/api/anthropic` | `glm-5.1` |
| DeepSeek | `https://api.deepseek.com/anthropic` | `deepseek-reasoner` |
| MiniMax (Token Plan) | `https://api.minimax.io/anthropic` | `minimax-m2.7` |
| Alibaba Cloud (DashScope) | `https://dashscope-intl.aliyuncs.com/apps/anthropic` | `qwen3.6-plus` |

These endpoints come from the community reference [Alorse/cc-compatible-models](https://github.com/Alorse/cc-compatible-models) (April 2026); the providers' own pages have not been checked, so treat them as unverified and confirm them in your provider's documentation. A coding plan can use a different endpoint or key from pay-as-you-go access.

### Any other agent CLI: the custom command

Set `HAROLD_AGENT` to `custom` and the variable `HAROLD_AGENT_CMD` to the command that runs your CLI headless. The contract:

- **The prompt** arrives on stdin; its path is also in `$HAROLD_PROMPT_FILE`, for CLIs that take the prompt as an argument (`mycli -p "$(cat "$HAROLD_PROMPT_FILE")"`). `$HAROLD_MODEL` holds `HAROLD_AGENT_MODEL`.
- **It runs at the repository root** and should write only inside it.
- **Its shell may run only `bin/harold`** and the read-only helpers listed in `$HAROLD_COMMANDS`: configure your CLI's permissions that way if it has them. The job's last step commits and pushes, outside the agent.
- **Install** (optional): the variable `HAROLD_AGENT_INSTALL`, for example `npm install -g some-cli`.
- **Secrets**: the variable `HAROLD_AGENT_SECRETS` lists repository secret names, comma-separated. `NAME` is exported as that environment variable; `NAME:~/path/file` is written to that file instead (for a CLI that keeps its sign-in in a file). Only the secrets named reach the agent.

For example, Antigravity CLI (`agy`) runs headless with `-p` and accepts `GEMINI_API_KEY`: `HAROLD_AGENT_CMD` = `agy -p "$(cat "$HAROLD_PROMPT_FILE")"`, `HAROLD_AGENT_INSTALL` = `curl -fsSL https://antigravity.google/cli/install.sh | bash`, `HAROLD_AGENT_SECRETS` = `GEMINI_API_KEY` (its changelog says that also needs `modelProvider: "gemini"` in its `settings.json`). Its Google subscription sign-in lives in the system keyring, and how to carry that to a server is not documented, so Antigravity works via the custom command, but its subscription path is not yet verified.

**Local open-weight models** (Ollama, LM Studio) work through any harness that supports them, via the custom command, with no API key or subscription; the model server must be reachable from where the job runs, which usually means your own runner rather than GitHub's.

GitHub Actions is the starter's way to schedule. Any other scheduler that can run a headless agent on your repository works the same way with the same prompt files, for example a Claude Code routine (see the end of each section) or cron on your own computer or server. Wherever a job runs, `bin/harold close` checks the job, not session filing, while the job runs (its marker, such as `harold/.brief-job.json`, shows it started and not finished). A scheduler that runs only Harold's jobs can also set `HAROLD_JOB=1` in the job's environment, as GitHub Actions and routines are already taken to.

### Morning brief: your time zone, your time

Say "good morning" and Harold runs the morning brief (`playbook/core/morning-brief.md`). Optionally, Steps 1 and 2 can be written for you before you sit down, so the morning starts with them on screen. By default that happens at **6:30am on weekdays, in your time zone**.

`.github/workflows/morning-brief.yml` does it on GitHub's machines, so no computer of yours needs to be on. GitHub schedules only in UTC, so the workflow wakes every hour (at :35, so a 6:30 brief starts about 6:35) and asks `bin/harold brief start` whether the brief is due: a weekday in your zone, at or after your time, and no brief yet today. Every other hour it stops in seconds, and daylight saving takes care of itself. The draft lands in `harold/briefs/YYYY-MM-DD.md`; the next time you boot, Harold sees it and shows it instead of re-running those steps.

To turn it on, add the secret for your agent (above) and give it your zone and time: in `harold/settings.env` (committed, so the job reads it too), or as two repository **variables**, which win when set:

| Variable | Example | Default |
|---|---|---|
| `HAROLD_TZ` | `America/Chicago`, `Europe/London`, `Asia/Singapore` | UTC on GitHub's machines (each run warns until you set it) |
| `HAROLD_BRIEF_TIME` | `07:15` (24-hour, your local time) | `06:30` |

To change the time or zone later, change the variables; nothing else. Check the gate any time with `bin/harold brief status`. When the brief is due, the job first runs `bin/harold check` (the same contract test as boot). Until you add a secret for your agent, a due run ends green at the agent step with a notice that the job is not set up, rather than failing every hour. If a run does fail, the next hourly run tries again, for up to six hours after your brief time (`HAROLD_BRIEF_WINDOW_HOURS` changes that). The workflow wakes about 720 times a month; each wake-up that is not due stops in seconds, but on a private repository every run counts as at least one Actions minute (the workflow file shows how to narrow the hours).

**Phone notice.** Set the repository secret `NTFY_TOPIC` (a topic name only you know, in the free ntfy app) and you get a notice when a draft lands. The job notifies from its own run; `.github/workflows/brief-notify.yml` covers every other writer (a routine, a session, another computer) by sending one for each new `harold/briefs/YYYY-MM-DD.md` pushed to your default branch. The notice says only that the brief is ready, with a link to the file.

**Prefer a Claude Code routine?** Delete the workflow and create a routine whose prompt is `harold/brief-prompt.md`, on its own schedule (for example weekdays at your brief time). The routine's schedule is the clock; the same gate still skips weekends and days that already have a brief. Set `HAROLD_TZ` in the routine's environment so dates are yours, not the server's.

### Housekeeping: weekly, monthly, month-end

Three of the scheduled triggers are upkeep rather than conversation: the **weekly scan** (Fridays), the **monthly full audit** (the 1st, including the slim-down that moves stale sections of over-budget startup files into an archive file beside them) and the **month-end review** (the last business day, Monday to Friday). By default a session does them when boot lists them as due. Turned on, `.github/workflows/housekeeping.yml` does them instead, silently, and pushes the results; anything worth your attention lands as one line in `harold/briefs/housekeeping-notes.md`, and the next morning brief shows it once.

**One switch.** In `harold/housekeeping.json`, set `"cloud": true`, commit and push. That line does two things at once: the workflow starts doing the jobs, and sessions stop treating them as due work (boot shows a one-line note instead, and close never asks for them), so a job is never done twice or not at all. While it is `false`, the workflow stops at its gate within seconds and costs nothing else. The same secret as the brief, plus `HAROLD_TZ`, is all it needs.

GitHub schedules only in UTC, so the workflow wakes every three hours and asks `bin/harold housekeeping start` whether a job is due: that job's day in your zone, and not yet recorded as ran or skipped today. The first wake-up after your local midnight does it, usually before your brief. When two jobs share a day (a Friday that is the 1st, or the last business day), they run on two consecutive wake-ups. `bin/harold housekeeping status` shows the gate for each job today.

The job ends with `bin/harold housekeeping finish`, which checks that the job was recorded and its daily note written, commits everything it changed (after the same secret scan as close) and pushes. A job that cannot finish is saved anyway, recorded as skipped so it does not start again that day, and noted for your next brief: a cloud checkout is thrown away after the run, so unsaved work would be lost.

**The CRM.** The workflow gives the agent no MCP servers and no CRM credentials, so the full audit's CRM consistency step is skipped there (the audit says so, and leaves you a note when people cards changed). To run that step unattended too, schedule `harold/housekeeping-prompt.md` with a runner that has a CRM tool, for example a Claude Code routine with the hosted connector attached; the step's limits in `playbook/core/knowledge-base-health.md` (what it may correct, and the "Never" list) apply either way. No housekeeping job ever logs an interaction, moves a pipeline entry or creates a task.

**Prefer a Claude Code routine (or another scheduler)?** Delete the workflow and schedule a daily run whose prompt is `harold/housekeeping-prompt.md`, with `HAROLD_TZ` in its environment. The same gate picks the job, if any; `bin/harold close` inside the routine saves the work.

## The connector: Harold from any tool and any device

The connector in `tools/harold-connector` is a required part of Harold. It is how every AI tool reaches the knowledge base, the CRM and the task list, including tools without the workspace folder, such as a chat app on your phone or the Claude website: a small remote MCP server you host yourself, in your own free Vercel account (or on any Node 22+ host). It reads and writes the knowledge base in your private GitHub repository through the GitHub API, and the CRM and the task list in your Supabase database. It accepts exactly one GitHub account (yours), keeps no database of its own (its tokens are encrypted with your own key), has no delete tools, and refuses to write anything that looks like a secret. Setting it up is step 8 of the [Quick start](#quick-start) and of the setup playbook; [`tools/harold-connector/README.md`](tools/harold-connector/README.md) has the **Deploy with Vercel** button, every setting and how to connect each tool. Add `<your connector address>/mcp` as a remote MCP server in every tool that supports them, or give a scheduled job a personal access token. harold-mcp remains only as a local fallback for a tool that cannot connect to a remote MCP server.

One difference to know: boot and close do not run in a connector chat, so filing is not enforced there. The tools file directly, and the next workspace session's boot and close see what landed. A workspace session that writes the CRM through the connector, on a computer without the CRM credentials, records each write with `bin/harold file crm '{"contact":"…","action":"upsert_contact","applied":"connector"}'` so close counts the contact as filed (`playbook/core/crm-filing.md`).

## Keeping Harold up to date

Your workspace starts as a copy of the starter, and the starter keeps improving. `bin/harold update` brings Harold's own machinery up to it, and nothing else:

```bash
bin/harold update --dry-run   # what would change
bin/harold update             # do it; review with git diff, harold close commits it
```

- **What it changes:** only the files `harold/update-manifest.txt` lists (`bin/`, `tests/`, the `tools/` code, every harness's hook and plugin files, the scheduled-job workflows and action, `playbook/core/`, `vault/templates/`, the brief and housekeeping prompts, `.gitignore`). New ones are added and ones the starter removed are removed.
- **What it never touches:** your content: the vault (except its templates), `memory/`, `dashboard/`, `raw/`, and Harold's data files (learnings, blockers, alerts, events, facts, `projects.md`, the CRM queue, briefs, `settings.env`).
- **Your edits are never overwritten.** A machinery file you changed, which the starter also changed, stays as it is; the starter's copy is written next to it as `<file>.upstream` and listed. Merge it by hand (a session can do it), then delete the copy; `bin/harold check` warns until you do. `AGENTS.md` is yours: when the starter's changes, you get `AGENTS.md.upstream` to bring the new sections in.
- **Where from:** `harold/upstream.json` names the starter (`url`, `ref`, default `main`) and records the commit last applied, which is how it tells your edits from the starter's. `--from <git url or path>` and `--ref <branch>` override them for one run. To keep a path out of updates, add it to `"skip"` there.
- **When:** boot prints one line when the starter has moved past your last update (a quick look, at most twice a day, never in scheduled jobs).

## Keeping it private

- The workspace repo must be private. Everything in it is your context.
- Credentials live in `~/.harold/env`, never in the repo (`harold/settings.env` is committed and is read only for non-secret `HAROLD_*` settings). `bin/harold close` refuses to commit anything that looks like a key.
- The visualizer listens on localhost only. Do not expose its port.
- Harold never pushes to the public starter. While `origin` still points at it (the URL in `harold/upstream.json`, over https or ssh), close, the scheduled brief and housekeeping commit your work locally, exit 1 and tell you to make a private copy (`playbook/core/setup.md`); they do not attempt the push.

## Contributing to Harold

Improvements to Harold itself are welcome. Report a problem or ask for a new task tool or CRM with the issue forms, and propose a change through a pull request from a fork; never from your own workspace, which holds your private content. [CONTRIBUTING.md](CONTRIBUTING.md) has the steps.

## License and credit

Harold was built and documented at [harold.works](https://harold.works). Adapt this starter freely for your own use.


