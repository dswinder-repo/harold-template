# Harold Sync Map

*Cross-file consistency reference. Which data points appear in more than one file, which file is authoritative for each, and what else to update when one changes. `bin/harold boot` requires this file (it is part of the core set). Use it during any multi-file edit and during the weekly and monthly knowledge-base health checks (`playbook/core/knowledge-base-health.md`).*

---

## How to Use This

When you edit any file below, check its cascade column. If the field you are changing has downstream files listed, update those too, in the same session. When two files disagree, the authoritative source wins and the other is corrected.

---

## Blocker Data

| Field | Authoritative Source | Also Appears In | Cascade |
|-------|---------------------|-----------------|---------|
| Active blocker list | `harold/blockers.md` | `harold/alerts.md`, `memory/CLAUDE.md` | Edit blockers.md first → rebuild the alerts rows → update the Active Blockers list in memory/CLAUDE.md |
| Blocker age | `harold/blockers.md` (Raised column) | `harold/alerts.md` | Never typed by hand: boot computes it from Raised |
| Blocker resolution | `harold/blockers.md` | `harold/alerts.md`, `memory/CLAUDE.md` | Move the row to `## Resolved` with the date → remove from alerts → remove from memory |

**Validation rule:** every blocker in the Current Blockers table is either in alerts.md or younger than 3 days.

---

## Event Data

| Field | Authoritative Source | Also Appears In | Cascade |
|-------|---------------------|-----------------|---------|
| Upcoming events | `harold/events.md` | `harold/alerts.md`, `memory/CLAUDE.md` | Edit events.md first → proximity alerts follow → memory's upcoming list |
| Prep status | `harold/events.md` | `harold/alerts.md` | Prep not Complete and event under 10 days out → alert, and event prep is due work |
| Debrief status | `harold/events.md` | `harold/alerts.md` | Event ended and no debrief after 3 days → alert |
| Completed events | `harold/events.md` (Completed Events) | weekly summary | Move the row out of Upcoming once debriefed |

**Validation rule:** no past event stays in the Upcoming Events table.

---

## Contact Data

| Field | Authoritative Source | Also Appears In | Cascade |
|-------|---------------------|-----------------|---------|
| Relationship state (type, labels, warmth, pipeline entries, last contact) | **CRM** | `vault/people/<Name>.md` frontmatter | CRM first → vault card frontmatter (`warmth`, `last_updated`) |
| Names, titles, organizations | `harold/facts.md` + `vault/people/` | CRM, project folders, `memory/CLAUDE.md` | Fix the spelling everywhere it appears → add the mistake to the Terminology table in facts.md |
| New contacts | `playbook/core/contact-intake.md` | CRM, `vault/people/`, `harold/facts.md` | Vault card → CRM record → facts.md row if it is a fact worth guarding |
| Internal team | vault card `type: team` | CRM record | Record kept current; interactions are never logged |

---

## Project Status

| Field | Authoritative Source | Also Appears In | Cascade |
|-------|---------------------|-----------------|---------|
| Which projects exist, where they live | `harold/projects.md` | `vault/projects/`, `dashboard/status.md` | Map entry first (`playbook/core/project-intake.md`) → vault card → status dashboard |
| Task state and due dates | **Task manager** (Linear by default) | weekly summary, `memory/CLAUDE.md` | Never duplicated by hand: summaries pull from the task manager |
| Project deadlines | `dashboard/status.md` | `harold/events.md` (if date-specific), `memory/CLAUDE.md` | Status dashboard → events.md → memory |
| Current priorities | `memory/CLAUDE.md` | weekly summary | Memory is authoritative; the summary mirrors it |

---

## Numbers

| Field | Authoritative Source | Also Appears In | Cascade |
|-------|---------------------|-----------------|---------|
| Key metrics and figures | `harold/facts.md` (Numbers) | `dashboard/strategy.md`, documents going out | Change the number in facts.md first, with its source and date → strategy dashboard → re-run `playbook/core/document-qc.md` on anything external that quotes it |

---

## Derived Files (never originate data)

| File | Built From |
|------|------------|
| `harold/alerts.md` | blockers.md, events.md, the task manager, CRM freshness |
| Weekly summary | task manager (completed / in progress), blockers.md, events.md, `vault/daily/` notes, memory's priorities |
| `harold/search.db` | every markdown file (rebuilt by `bin/harold`; gitignored) |

**Validation rule:** anything in a derived file that does not trace to its source is deleted from the derived file.

---

## Quick Cascade Cheat Sheet

| When you edit... | Also update... |
|------------------|----------------|
| `harold/blockers.md` (add or resolve) | `harold/alerts.md`, `memory/CLAUDE.md` |
| `harold/events.md` (add or complete) | `harold/alerts.md`, `memory/CLAUDE.md` |
| A contact's warmth or details | CRM first, then the vault card |
| `harold/projects.md` | the project's vault card, `dashboard/status.md` |
| `memory/CLAUDE.md` priorities | the next weekly summary |
| A misspelling found | every file containing it, then the Terminology table in `harold/facts.md` |
