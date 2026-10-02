# Playbook: Knowledge Base Health Check

**Purpose:** Keep the knowledge base accurate, consistent and fresh: a weekly quick scan and a monthly full audit.
**Trigger:** Scheduled: every Friday (Quick Scan, `weekly-scan`), 1st of the month (Full Audit, `full-audit`). On demand: "run health check", "audit the knowledge base", after a restructure or file migration.

---

## How the schedule works

`bin/harold boot` prints scheduled work that is due. On a Friday it lists `weekly-scan`; on the 1st of the month it lists `full-audit`. Due work runs in the same session, not "later". Each part ends by recording what happened:

```bash
bin/harold file trigger weekly-scan ran "<one-line summary>"
bin/harold file trigger full-audit ran "<one-line summary>"
# or, if it could not run:
bin/harold file trigger weekly-scan skipped "<reason>"
```

`bin/harold close` checks that due triggers were recorded. A skipped run with a reason is fine; a silent skip is how weeks of drift accumulate.

**Unattended (cloud housekeeping).** With `"cloud": true` in `harold/housekeeping.json`, the weekly scan and the full audit (and the month-end review in `dashboard/processes.md`) run as silent scheduled jobs: `.github/workflows/housekeeping.yml`, or any scheduler running `harold/housekeeping-prompt.md`. Sessions then see them as notes, not due work. The job follows this playbook with the limits in that prompt: anything that needs the operator (a deletion, an escalation, a debrief prompt, a judgment call) becomes one line in `harold/briefs/housekeeping-notes.md` for the next morning brief; the task manager is read-only; the CRM is touched only by Step 9, within its limits, and only when the job has a CRM tool. `bin/harold housekeeping start` is the gate, and `bin/harold housekeeping finish` commits and pushes what the job changed.

About the vault: `vault/` is plain markdown. Obsidian is an optional viewer, not a requirement. Search it with `bin/harold search "<query>"` (full-text over all markdown in the workspace; run `bin/harold index` first if results look stale).

---

## Part 1: Weekly Quick Scan (Fridays, trigger id `weekly-scan`)

A lighter pass, done alongside the weekly summary.

1. **Alerts review** (`harold/alerts.md`)
   - Any alert older than 7 days? → Resolve it, or escalate it (for blockers, run `playbook/core/blocker-escalation.md`).
   - Any new blockers that should be in `harold/blockers.md`?

2. **Events check** (`harold/events.md`)
   - Any event in the next 10 days with Prep Status not `Complete`? → Run `playbook/core/event-prep.md`.
   - Any event that has ended with Debrief Status still open? → Prompt the operator for the debrief.

3. **Name spot check**
   - Scan this week's `vault/daily/` notes and any new `vault/people/` or `vault/companies/` notes for misspellings, using the error-pattern table in Part 2, Step 2.

4. **Freshness touch**
   - Update the "Last updated" line in `dashboard/status.md`.
   - Move resolved blockers under `## Resolved` in `harold/blockers.md`.

5. **Hot items**
   - Any fact, contact or concept referenced 3+ times this week (search this week's daily notes)?
   - If yes → promote it: add it to `dashboard/status.md` or `memory/CLAUDE.md` so it is easy to find, not buried.

6. **Fact verification**
   - Pick 3 random entries from `harold/facts.md` and check they are still accurate.
   - Update their last-updated date if confirmed; correct them if stale.

7. **Weekly summary**
   - Write the summary to `harold/weekly-summary.md` (overwrite; the previous week lives in git history), or, if you prefer not to keep that file, into today's daily note `vault/daily/YYYY-MM-DD-weekly-scan.md`. Pick one and stay consistent.
   - Contents: tasks completed this week (Monday to Friday) from the task manager (Linear by default; `bin/harold-linear tasks` if the helper is configured), tasks in progress, open blockers, events in the next two weeks, and next week's focus areas.
   - **If the task manager is unreachable:** write the summary from `vault/daily/` notes and say in the summary that task data is missing.

8. **Working folder cleanup**
   - `ls` the workspace root. It should contain only the expected structure (AGENTS.md, CLAUDE.md, `bin/`, `harold/`, `memory/`, `dashboard/`, `vault/`, `raw/`, `playbook/`, project folders). Loose files are misplaced.
   - Temp and junk files (`.tmp`, `.~lock.*`, `~$*`, `.DS_Store`) → flag for deletion.
   - Deliverables (PDF, PPTX, DOCX, HTML, images) → file into the right project folder, resolved through `harold/projects.md` (`bin/harold where <topic>`).
   - Duplicates → confirm with `diff` or a checksum, then flag the copy for deletion.
   - Scripts that generated a deliverable → file alongside the deliverable.
   - Stale drafts → keep the final version, flag earlier ones.
   - **If deletion is blocked or risky:** list the files for the operator to delete, with a one-line safety note per file. Never permanently delete without the operator's go-ahead.

   *Why this step exists:* steps 1-7 look after Harold's own metadata files. This one catches the working folder itself, where deliverables, temp files and duplicates pile up during the week.

9. **Record it**
   - Append a one-line result to today's daily note: `bin/harold file daily weekly-scan "<summary>"`.
   - `bin/harold file trigger weekly-scan ran "<summary>"` (or `skipped "<reason>"`).

---

## Part 2: Monthly Full Audit (1st of the month, trigger id `full-audit`)

### Step 1: Date and freshness audit

| File | Check for |
|------|-----------|
| `dashboard/status.md` | "Last updated" date; deadlines that have passed |
| `harold/alerts.md` | Alert ages; timestamp at the bottom (older than 1 day means the `alerts-rebuild` trigger should already have fired) |
| `harold/events.md` | Past events still under `## Upcoming Events`; prep and debrief status |
| `harold/blockers.md` | Blockers older than 14 days; resolved items not moved to `## Resolved` |
| `memory/CLAUDE.md` | Priorities that no longer match reality |
| Project READMEs (via `harold/projects.md`) | Status indicators, "Last updated" dates |

**Action:** update stale dates, archive past events, close resolved blockers.

### Step 2: Name and spelling consistency

Keep a table of names that get misspelled in your knowledge base. Transcripts and voice input are the usual source. Start empty and add a row every time a misspelling is caught. Example rows (fictional, replace them):

| Correct | Common errors |
|---------|---------------|
| Jane Doe | Jane Dough, Jayne Doe |
| Sam Lee | Sam Li, Sam Leigh |
| Globex | Globecs, Globax |

**Search for each error pattern:**
```bash
bin/harold search "Dough"
grep -rli "Globecs\|Globax" vault/ dashboard/ harold/
```

**Action:** fix every hit. Check the CRM record too (`harold_search_contacts`); a wrong spelling there spreads into every draft.

### Step 3: Cross-file consistency

Key facts appear in several files. Check they agree, and fix downstream files from the source of truth. The full cascade and validation rules live in `harold/sync-map.md`; the table below is the short version:

| Fact | Where it appears | Source of truth |
|------|------------------|-----------------|
| Active blockers | `harold/blockers.md`, `harold/alerts.md`, `memory/CLAUDE.md` | `harold/blockers.md` |
| Upcoming events and dates | `harold/events.md`, `harold/alerts.md`, `dashboard/status.md`, project READMEs | `harold/events.md` |
| Contact names, titles, organizations | `vault/people/`, the CRM, `harold/facts.md` | The CRM record and the vault profile must match; if they differ, ask the operator |
| Recurring meeting schedule | `memory/CLAUDE.md`, `harold/facts.md` | `memory/CLAUDE.md` |
| Key metrics and figures | `harold/facts.md`, `dashboard/strategy.md`, project docs | `harold/facts.md` |
| Project list and folders | `harold/projects.md`, `dashboard/status.md` | `harold/projects.md` |
| [ADD YOUR OWN] | | |

**Action:** reconcile each discrepancy at the source, then propagate it using the cascade rules in `harold/sync-map.md`.

### Step 4: Orphaned files

Look for files that:
- are not referenced from any README, dashboard module, `harold/projects.md` or vault note;
- have no clear purpose;
- duplicate another file.

Check especially the workspace root, any shared project folder, and any `archive/` folder (make sure nothing active is sitting there).

**Action:** move misplaced files, update references, and list true orphans for the operator to confirm deletion.

### Step 5: Link integrity

- Cross-references between project READMEs.
- Playbook references in `dashboard/processes.md` and in `AGENTS.md`.
- Wiki-links (`[[...]]`) in vault notes: every target should exist.
- File paths mentioned in dashboard modules and playbooks.

**Action:** fix broken links; create the missing vault note if the link is right and the note should exist.

### Step 6: Task manager sync

Compare the knowledge base with the task manager (Linear by default):
- Are active tasks reflected in the relevant project docs?
- Are completed tasks marked done in both places?
- Do task descriptions match the knowledge base context?

**Action:** sync discrepancies. The task manager is the source of truth for task state.
**If it is unreachable:** skip this step and say so in the report.

### Step 7: Time-sensitive external references

Some things the knowledge base cites can quietly stop being true: programs that are wound down, regulations that change, prices, organizations that merge or close, people who change roles. A cited source that no longer exists damages credibility in anything sent outside.

| Check | Action |
|-------|--------|
| Any reference known to be defunct still cited in active docs? | Remove it, or add a dated historical caveat |
| Any reference with uncertain status cited without a caveat? | Add a status note |
| Any reference not verified in 60+ days? | Re-verify (web search or source check) and record the date in `harold/facts.md` |

**Action:** update the affected docs and the verified dates.

### Step 8: Vault hygiene

**8a. Orphaned notes.** Vault notes with zero incoming links:
- people nobody references → check they are still relevant;
- intel not linked from any daily, decision or meeting note → link it or archive it;
- companies with no people or meetings linked → check relevance.

Action: add missing `[[links]]`, or move truly orphaned notes to `vault/archive/`.

**8b. Frontmatter consistency.**
- People: `tags: [person]`, `type` (exactly one, from your own list, e.g. investor, partner, founder, team, other), `labels`, `company`, `role`, `warmth` (Hot, Warm, Lukewarm, Cold or empty), `status`, `crm`, `last_updated`.
- Companies: `tags: [company]` plus a category.
- Intel: `tags: [intel]`, `type: durable` or `type: timely`, `status: active` or `status: superseded`; optional `source:`, `relevance:`. Normalize non-standard values (for example `durable-insight` → `durable`).
- Decisions: `tags: [decision]`, `status: active` or `status: superseded`.
- Meetings: `tags: [meeting]`. Daily notes: `tags: [daily]`.

Action: fix non-standard values; add missing frontmatter.

**8c. Stale daily notes.**
- Older than 30 days → skim for decisions or intel that were never extracted into their own notes; extract them.
- Older than 90 days → archive to `vault/archive/daily-YYYY-MM/`, batched by month.

**8d. Superseded decisions.** For each decision with `status: active`, check whether a newer decision replaced it. If so, set `status: superseded` and add `superseded_by: [[newer-decision]]`.

**8e. Broken wiki-links.** Find `[[links]]` whose target does not exist. Create the note if it should exist; otherwise fix the link.

**Tidying is not a contact update.** Tag, link, date and formatting fixes on `vault/people/` cards are housekeeping: they do not change `last_updated`, warmth or status, and they need no CRM write (`bin/harold close` ignores them).

### Step 9: CRM consistency

**Purpose:** keep the CRM and the vault people cards saying the same thing about each person.

**Read** the CRM with whatever CRM tool this session has (the harold-mcp tools `harold_search_contacts` and `harold_get_contact`, or a CRM connector). If none is available in this run, skip this step and say so in the report.

**Compare** every `vault/people/` card (except `crm: none`) with its CRM record, and correct the CRM when the vault (or a dated meeting or daily note) clearly shows the right value:

| Case | Correction |
|---|---|
| Title, company/org, email, phone or location changed in the notes; the CRM still has the old value | Update the CRM field |
| Name spelled differently, and the notes settle which is right | Correct the CRM name; fix any vault spelling too |
| Card exists, no CRM record | Create the record (type from the card's `type`) |
| CRM type is not on your list of contact types (`dashboard/people.md`) | Set the type from the card |
| Warmth differs **and** logged interactions clearly support one value | Align the CRM to the evidence |

**Never:** log an interaction, change last-contacted dates, add, move or close pipeline entries, create tasks, merge or delete contacts, or touch any record's interactions. Anything ambiguous (two plausible values, a possible duplicate, warmth without clear evidence) is not corrected: it goes to the operator as one line in the report (and, for an unattended run, in `harold/briefs/housekeeping-notes.md` under `## New`).

**How to write:** with `harold_upsert_contact`, passing the `contact_id` of the existing record (a name correction cannot be matched by the new name; omit it only when creating) and only the corrected fields. If the CRM tool is a connector that `bin/harold` cannot see from here, record each write so `bin/harold close` counts it as filed: `bin/harold file crm '{"contact":"<name>","action":"upsert_contact","applied":"connector","payload":{...the same fields...}}'`. If the CRM is unreachable, queue the correction without `applied` (`bin/harold file crm '{"contact":"<name>","action":"upsert_contact","payload":{"contact_id":"<id>", ...}}'`); boot and close apply it once the CRM answers.

**Record:** list every correction (contact, field, old → new, the evidence file) in the report.

### Step 10: Raw inbox

List files in `raw/` without `compiled: true` in frontmatter. Report the count and age of the oldest. Do not compile them here; that is `playbook/core/compile.md`, run when the operator asks.

### Step 11: Size budgets (slim-down)

Every session loads a few files at startup, so their size is a cost paid on every boot. `bin/harold boot` warns when one is over its character budget (defaults: `AGENTS.md` 30k, `memory/CLAUDE.md` 10k, `dashboard/status.md` 10k, `dashboard/processes.md` 15k, `harold/alerts.md` 8k; change any of them under `"size_budgets"` in `harold/housekeeping.json`).

For each file over budget, move the sections that are clearly stale (superseded, finished, or older than 90 days and not referenced by an active project in `harold/projects.md`) into an archive file beside it, `<same folder>/<name>-archive.md`, leaving a one-line pointer where they were. `bin/harold search` still finds them; sessions no longer load them. Never move rules, instructions or anything current. If a file cannot get under budget without a judgment call, leave the rest and tell the operator in one line. Nothing is deleted.

### Step 12: Report and record

- Write the report (template below) into today's daily note: `vault/daily/YYYY-MM-DD-kb-health.md`.
- `bin/harold file trigger full-audit ran "<one-line summary>"` (or `skipped "<reason>"`).

---

## Health Check Report Template

```
## Knowledge Base Health Check: [Month Year]

**Run date:** [YYYY-MM-DD]
**Run by:** Harold

### Summary

| Category | Status | Issues found | Actions taken |
|----------|--------|--------------|---------------|
| Date freshness | OK / Warn / Fail | [n] | [brief] |
| Name consistency | OK / Warn / Fail | [n] | [brief] |
| Cross-file consistency | OK / Warn / Fail | [n] | [brief] |
| Orphaned files | OK / Warn / Fail | [n] | [brief] |
| Link integrity | OK / Warn / Fail | [n] | [brief] |
| Task manager sync | OK / Warn / Fail / Skipped | [n] | [brief] |
| External references | OK / Warn / Fail | [n] | [brief] |
| Vault hygiene | OK / Warn / Fail | [n] | [brief] |
| CRM consistency | OK / Warn / Fail / Skipped | [n] | [brief] |
| Raw inbox | [n] uncompiled | | |

### Issues found

1. [Issue] - [file] - [action taken]

### Recommendations

- [Structural improvements]
- [New error patterns to watch]

### Next check

Weekly: [next Friday]. Monthly: [1st of next month].
```

---

## Adding to the error-pattern list

When a new spelling or consistency error is found:

1. Add the correct and incorrect forms to the table in Part 2, Step 2.
2. Search for and fix every existing instance (`bin/harold search`, `grep`), including the CRM.
3. If the operator had to point it out, record it: `bin/harold file learning '{"severity":"critical","project":"global","category":"names","lesson":"..."}'`.

---

## Success criteria

- No stale dates older than 30 days.
- Zero known name inconsistencies.
- Cross-file facts agree with their source of truth.
- No orphaned files in active folders.
- Internal links work.
- Task manager and knowledge base in sync.

---

## Completion checklist

**Weekly Quick Scan**
- [ ] Alerts older than 7 days resolved or escalated
- [ ] Events within 10 days have prep underway; ended events have a debrief prompt
- [ ] Name spot check done on this week's notes
- [ ] `dashboard/status.md` "Last updated" refreshed; resolved blockers moved to `## Resolved`
- [ ] 3 facts in `harold/facts.md` verified
- [ ] Weekly summary written (`harold/weekly-summary.md` or the daily note)
- [ ] Workspace root cleaned or flagged
- [ ] `bin/harold file trigger weekly-scan ran|skipped "<reason>"` recorded

**Monthly Full Audit**
- [ ] Steps 1-11 run (or each skipped step noted with a reason)
- [ ] Report written to `vault/daily/YYYY-MM-DD-kb-health.md`
- [ ] New error patterns added to Part 2, Step 2
- [ ] `bin/harold file trigger full-audit ran|skipped "<reason>"` recorded
