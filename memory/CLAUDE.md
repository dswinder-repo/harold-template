# Working Memory

*The single source of truth for session context. `bin/harold boot` verifies it is readable and `AGENTS.md` has every session read it first. Keep it short and current: this is what Harold must know before your first sentence, not an archive. History belongs in `vault/`.*

**Operator:** [YOUR NAME], [YOUR ROLE] at [YOUR COMPANY]
**Time zone:** [YOUR TIMEZONE] (set `HAROLD_TZ` in `~/.harold/env` or your shell to the IANA name, e.g. `America/Chicago`, so boot prints the right date)

---

## Tool Access Rules

*Which tools Harold may use in which harness, and anything that must be initialized first. Examples:*

- Calendar: [how Harold reads your calendar, e.g. the calendar connector, or "ask me"]
- Task manager: [Linear by default; team key `[TEAM]`]
- CRM: the hosted connector (`crm_*` tools) or harold-mcp (`harold_*` tools), whichever this harness has. A connector write on a computer without CRM credentials: `bin/harold file crm '{...,"applied":"connector"}'`. CRM unreachable: queue with `bin/harold file crm` and say so.

---

## Current Priority

*One to three items. Specific enough that Harold can tell whether a request serves them.*

1. [Your top priority, with its deadline]
2. [Second priority]
3. [Third priority]

---

## Active Blockers

*Mirror of `harold/blockers.md` (authoritative). Updated per `harold/sync-map.md`.*

- B001 (example): mutual NDA with Acme Corp, waiting on Jane Doe since Sep 26, 2026

---

## Upcoming Events (Next 30 Days)

*Mirror of `harold/events.md` (authoritative).*

- [Event, date, prep status]

---

## Pending Conversations

*Things to raise the next time you talk to someone. Cleared once raised.*

| With | Topic | Since |
|------|-------|-------|
| [Name] | [What to raise] | [Date] |

---

## Key Relationships

*The handful of people Harold should always recognize without searching. Everyone else lives in the CRM and `vault/people/`.*

| Name | Role | Type | Why they matter |
|------|------|------|-----------------|
| Jane Doe (example) | VP Partnerships, Acme Corp | partner | Example row |

---

## Isolated Projects

*Projects whose knowledge must never cross into others (e.g. a confidential side venture, a client under NDA). Harold does not cross-reference them in briefs or analyst sweeps.*

- [Project name]: [the isolation rule]

---

## Key Versions & Files

*The canonical version of each important document, so Harold never works from a stale copy.*

| Document | Canonical file | Notes |
|----------|----------------|-------|
| [e.g. company deck] | [path relative to the workspace] | [e.g. locked, do not edit] |

---

## Task Management Rules

- Every task has a due date and a project.
- [Your rules, e.g. "No tasks for meetings themselves; tasks are for the follow-ups."]

---

## Process Notes (Learned the Hard Way)

*Standing rules that come from real mistakes. Individual corrections go to `harold/learnings.jsonl` via `bin/harold file learning`; promote a lesson here only when it shapes every session.*

- [Rule]

---

## Session Handoff

*Written at the end of a long session so the next one can pick up. Replace, do not append.*

- **Last session:** [date, what was done]
- **Next:** [what is left]
- **Gotchas:** [anything the next session must not trip on]

---

*Last updated: [DATE]*
