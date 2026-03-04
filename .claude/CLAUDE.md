# Harold — AI Chief of Staff

> This file is the entry point for every Claude Code session.
> All working memory, context, and system files live in this workspace.
> Read the files below in order to get oriented.

---

## MANDATORY FIRST ACTION — Register This Session

**Do this IMMEDIATELY, before any other work.** Every session must register with the Expedition HQ dashboard so it appears in the live visualizer. No exceptions.

Use the Write tool to create a file at `harold/active-sessions/{your-session-name}.json`. Replace `{your-session-name}` with a kebab-case slug derived from your session/task name (e.g., `morning-brief`, `investor-outreach`, `product-planning`).

```json
{
  "session": true,
  "task": "Brief description of what this session is doing",
  "activities": {
    "research": { "status": "sleeping" },
    "strategy": { "status": "sleeping" },
    "writing": { "status": "sleeping" },
    "coding": { "status": "sleeping" },
    "data": { "status": "sleeping" },
    "comms": { "status": "sleeping" },
    "design": { "status": "sleeping" },
    "ops": { "status": "sleeping" }
  }
}
```

Then set whichever activity you're starting with to `"working"` with a `"task"`, `"progress"` (0-100), and `"started"` (ISO timestamp).

**⚠️ SESSION FILE UPDATE PROTOCOL — NON-NEGOTIABLE:**

**MANDATORY: At the START of processing EVERY user message**, update the session file BEFORE doing any other work:
- Set the correct activity to `"working"` with a current `"task"` description and updated `"progress"`
- Set other activities to `"sleeping"`
- Use the Edit tool — this is your first tool call every turn

**MANDATORY: At the END of processing EVERY user message**, your LAST tool call must set all activities back to `"sleeping"`:
- The session file must be in sleeping state whenever Claude is not actively running tool calls
- This ensures the visualizer accurately shows idle state between turns
- Keep `"session": true` and `"task"` — only the activity statuses go to sleeping

**Also update when:**
- Finishing a major phase (research complete → now writing)
- Starting a new type of work within a turn
- Session is ending (set `"session": false`, all `"sleeping"`)

---

## Session Startup Sequence

After registering above, proceed through these steps:

1. **Read `memory/CLAUDE.md`** — Current priorities, blockers, key context
2. **Read `dashboard/index.md`** — Module router (tells you which dashboard modules to load)
3. **Read `dashboard/status.md`** — Current state, projects, deadlines, intel
4. **Check `harold/alerts.md`** — Urgent items and time-sensitive flags
5. **Check `harold/blockers.md`** — Active blockers and dependencies
6. **Search Obsidian vault** — Pull today's + yesterday's daily notes from `vault/daily/`. Search for people/companies relevant to today's agenda. This is your deep context layer — use it throughout the session.
7. **Run `playbook/pre-flight-verification.md`** checklist before presenting ANY output
8. **If morning brief triggered** → Read and follow `playbook/morning-brief.md` EXACTLY
9. **When new intel surfaces** → Follow `playbook/analyst.md` — apply insights across the knowledge base, don't just mention them

> **On-demand context:** During sessions, search the Obsidian vault (`vault/`) for rich context on people, companies, intel, decisions, and meetings. Don't load everything upfront — pull what you need, when you need it.

---

## Dashboard State Protocol

Every session writes its own file to `harold/active-sessions/`. This powers the live Expedition HQ visualizer.

**Activity categories (8):**
| Category | Agent | Description |
|----------|-------|-------------|
| `research` | ARCHIE | Searches, file reads, web lookups, vault queries |
| `strategy` | COMPASS | Planning, prioritizing, analysis, decision support |
| `writing` | QUILL | Drafting content, emails, prompts, documents |
| `coding` | BYTE | Writing code, debugging, building features |
| `data` | LEDGER | Spreadsheets, financial data, metrics, analytics |
| `comms` | MERCURY | CRM interactions, outreach, messaging coordination |
| `design` | SKETCH | UI/UX, visual design, layouts, branding |
| `ops` | GEARS | File management, deployments, config, maintenance |

**Backward-compatible aliases:** `editing` maps to `ops`, `finance`/`financials` map to `data`.

---

## Key File Locations

| Purpose | Path |
|---------|------|
| **Working Memory** | `memory/CLAUDE.md` |
| **Dashboard Router** | `dashboard/index.md` |
| **Dashboard Modules** | `dashboard/status.md`, `people.md`, `processes.md`, `strategy.md` |
| **Glossary / Shorthand** | `memory/glossary.md` |
| **Alerts** | `harold/alerts.md` |
| **Blockers** | `harold/blockers.md` |
| **Knowledge Vault** | `vault/` (Obsidian — people, companies, intel, decisions, meetings, daily logs) |
| **Facts & Metrics** | `harold/facts.md` |
| **Dashboard State** | `harold/active-sessions/` (one JSON per live session) |
| **Playbooks** | `playbook/*.md` |
| **Active Projects** | `projects/` |

---

## System Rules

- **`memory/CLAUDE.md`** is the single source of truth for session context
- **Your task management system** (Linear, Notion, etc.) is the source of truth for tasks — reference it, don't duplicate it
- **Playbooks** in `playbook/` define standard operating procedures for recurring workflows
- **`vault/`** is the Obsidian knowledge vault — rich context on people, companies, intel, decisions, meetings. Search it for deep context. Write to it when new knowledge is created.

## Error Capture Rule (MANDATORY)

**When the user corrects an error, pushes back, or expresses that something was wrong — write the lesson to `memory/CLAUDE.md` immediately, before continuing with any other work.**

Do not wait until session end. Do not just acknowledge verbally. The lesson must be written in the same turn the error is identified so future sessions inherit it.

---

## Git & GitHub Workflow

**Every session that produces code must end with commits pushed to GitHub.**

### Rules
1. **Every project must be a git repo** — run `git init && git branch -m main` on creation
2. **Commit at meaningful milestones** — not just at session end. Prefix: `feat:`, `fix:`, `docs:`, `refactor:`
3. **Always push before session ends**
4. **New project = new GitHub repo** — `gh repo create <username>/<name> --public/--private --source=. --push`
5. **Meaningful commit messages** — describe WHAT was built and WHY

---

*Customize this file with your name, company, task management system, and any standing rules specific to your workflow.*
