# Dashboard: Processes & Operating Rules

> **CRM tools.** Where a step names two tools (`crm_upsert_contact` / `harold_upsert_contact`), the first is the hosted connector's and the second harold-mcp's. Use whichever your harness has: they write the same database. A write made through the connector on a computer without CRM credentials is recorded with `bin/harold file crm '{...,"applied":"connector"}'` (see `AGENTS.md`, CRM Filing Protocol).

*How Harold operates. Loaded every session. The Context Engine below is always on: playbooks fire on what you say, by meaning, never on exact commands.*

---

## Context Engine

**Harold does not wait for explicit playbook invocations.** You speak naturally; Harold detects intent and fires the right playbook and its full cascade. Slash commands still work, but are never needed.

**Before any output** → `playbook/core/pre-flight-verification.md` (names, dates, facts, filing). Always on.

### Always-On Monitors (every message)

| What Harold detects | Action |
|---------------------|--------|
| A **new name with business context** (organization, title, deal, meeting, intro) | `playbook/core/contact-intake.md`: duplicate check, vault card, CRM record, pipeline entry only if a purpose was established |
| A **project, client, engagement or workstream** that `bin/harold where` cannot resolve | `playbook/core/project-intake.md`: folder, `harold/projects.md` entry, vault card, cross-links. You never announce a new project; you just start working on it |
| A **task signal** ("done", "started", "blocked", a new to-do) | Update the task manager now; add to `harold/blockers.md` if blocked |
| **Commitments in pasted call notes, a transcript or a forwarded email** (something the operator said they would do, or something someone owes the operator) | Tasks, automatically, without asking: check the open tasks first (no duplicates), then one task per commitment in the task manager (`bin/harold-linear create`, `task_create` on the connector, or the task manager's own tool), with a due date when stated or implied and the project from `bin/harold where`; `crm_task` as well when it is tied to a contact. Things owed to the operator read "Follow up: <who> owes <what>". Each task ID goes on its line under `## Action items` in the meeting note; `bin/harold close` blocks until it does. Harold never reads email on its own: it acts on what is pasted or forwarded |
| **New intel** (news, market data, notes, a strategic insight) | `playbook/core/analyst.md`: apply it across the knowledge base, don't just mention it |
| A **correction** from you (wrong name, wrong title, skipped step) | Record it first: `bin/harold file learning '{...}'`, then fix the error |
| **Substantive synthesis** (3+ sources, or analysis worth keeping) | File it to `vault/intel/` or `vault/decisions/` so it compounds |

### Context Triggers (natural phrases → playbook)

| You say something like... | Playbook |
|---------------------------|----------|
| A start-of-day opener at any hour: "good morning", "gm", "morning", "let's get started", "let's go", "start the day", "daily brief" (a first message that is a project request is NOT one) | `playbook/core/morning-brief.md` (Step 0 first: show today's scheduled draft if boot says READY; otherwise 3 steps, two pauses, follow exactly) |
| "just got off a call with...", "we met with...", pasting notes or a transcript, forwarding an email | `playbook/core/meeting-debrief.md` (its commitments become tasks automatically), then `playbook/core/analyst.md` |
| "met someone new", "intro to...", "add X to the CRM" | `playbook/core/contact-intake.md` |
| "I'm starting work on...", talking about a client or workstream the map doesn't know | `playbook/core/project-intake.md` |
| "prep me for...", an event in the next 10 days | `playbook/core/event-prep.md` |
| "what does this mean for us", "analyze this", pasting an article | `playbook/core/analyst.md` |
| "this is stuck", "still waiting on...", "blocker:" | add to `harold/blockers.md`; if older than 7 days → `playbook/core/blocker-escalation.md` |
| "resolved: B00X" | move the row to `## Resolved` in `harold/blockers.md`, update alerts |
| "write a post / article / newsletter about..." | `playbook/core/content-production.md` |
| "this is final", "ready to send", "send this to...", "lock it in" | `playbook/core/document-qc.md` **before** it goes out |
| dropping a file, pasting source material | save to `raw/` first, then route it (`dashboard/people.md` → Input Processing Protocol); `playbook/core/compile.md` for batches |
| "compile", "process the inbox", "recompile everything on X" | `playbook/core/compile.md` |
| "audit the knowledge base", "clean up the vault" | `playbook/core/knowledge-base-health.md` |
| "which model should do this?" | `playbook/core/model-routing.md` |
| "ship it", "push this", "deploy" | `playbook/core/ship-to-github.md`, `playbook/core/preview-deploys.md` |
| "show me the dashboard", "open HQ" | `playbook/core/expedition-hq.md` |
| "done", "wrap up", "that's it for today" | Session close (`AGENTS.md` → /done): summary, CRM sweep, daily note, `bin/harold close --final` |

*Add a row whenever you add a playbook, and a row to `playbook/README.md`. Engagement playbooks (`playbook/engagements/<name>/`) fire only while that engagement's project is `status: active` in `harold/projects.md`.*

### Time Triggers

`bin/harold boot` computes these from the real date and `harold/trigger-log.jsonl`. Due work runs the same session and is recorded with `bin/harold file trigger <id> ran|skipped|deferred "<reason>"`; `bin/harold close` blocks until it is. Exception: with `"cloud": true` in `harold/housekeeping.json`, `weekly-scan`, `full-audit` and `month-end` run as silent scheduled jobs (`.github/workflows/housekeeping.yml` or `harold/housekeeping-prompt.md`), and sessions only see a note.

| Trigger id | When | What runs |
|------------|------|-----------|
| `weekly-scan` | Every Friday | Weekly summary + Quick Scan (`playbook/core/knowledge-base-health.md`) |
| `full-audit` | 1st of the month | Full Audit (`playbook/core/knowledge-base-health.md`) |
| `month-end` | Last business day of the month | Month-End Review (below) |
| `alerts-rebuild` | `harold/alerts.md` more than 1 day old | Rebuild Current Alerts from source |
| `blocker-escalation:<ID>` | A blocker older than 7 days (at most weekly) | `playbook/core/blocker-escalation.md` |
| `event-prep:<event>` | An event under 10 days out, prep not Complete | `playbook/core/event-prep.md` |
| (flag only) | Items in `raw/` without `compiled: true` | Mention them; never auto-compile |
| (flag only) | No `vault/daily/` note in 3+ days | Say so; one is written at close |

### Cascade Logic

One trigger usually means several writes. A meeting debrief, for example: meeting note in `vault/meetings/` → CRM interaction + contact update + vault card (external contacts only) → tasks in the task manager → facts in `harold/facts.md` → analyst sweep → daily note. The playbook names every file; do all of them in the same turn.

---

## Month-End Review

Runs on the last business day of the month (trigger id `month-end`).

As an unattended cloud job (`harold/housekeeping.json` → `"cloud": true`) it is read-only: it writes the review (step 6's file) and turns every change it would make (a project status, a pipeline entry, `memory/CLAUDE.md`) into a note for the next brief.

1. **Goals:** read `dashboard/status.md` Goals / KPIs; mark each on track, at risk, or missed, with one line of evidence.
2. **Projects:** for each active entry in `harold/projects.md`, one line: what moved this month, what didn't (`bin/harold pulse --all` gives each one's last activity and next step). Set `status: paused` or `archived` where that is now true.
3. **Relationships:** run `harold_cadence_check` on harold-mcp (on the connector, `crm_stale`); list who went stale and decide re-engage or re-rate warmth.
4. **Pipeline:** `crm_pipeline` / `harold_pipeline` with action `list`; close entries that are really dead (`Dormant` with an outcome).
5. **Blockers:** anything open more than 30 days gets a decision: resolve, re-scope, or accept.
6. **Write it down:** `vault/daily/YYYY-MM-DD-month-end.md` with the above, and update `memory/CLAUDE.md` Current Priority if it changed.
7. **Record it:** `bin/harold file trigger month-end ran "<one-line summary>"`.

---

## Task Management

- The task manager (Linear by default) owns tasks and due dates. `bin/harold-linear tasks` pulls them (and writes `harold/linear-snapshot.md` for harnesses without the key).
- Every task has a due date and a project.
- CRM tasks (`crm_task` / `harold_crm_task`) are only for follow-ups tied to one contact.

---

## Memory Hygiene

- `memory/CLAUDE.md` holds only what every session needs. History goes to `vault/`.
- Corrections become lessons immediately (`bin/harold file learning`), never later.
- Derived files (`harold/alerts.md`, the weekly summary) are rebuilt from source, never hand-maintained (`harold/sync-map.md`).

---

## Session Handoff

When a session runs long (100+ tool calls) or the work will continue elsewhere, write a handoff in `memory/CLAUDE.md` → Session Handoff: what was done, what is left, key file paths, gotchas. Then start fresh rather than waiting for the context to overflow.
