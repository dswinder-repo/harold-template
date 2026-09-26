# Playbook: Compile / Recompile Knowledge Base

**Purpose:** Turn raw sources in `raw/` into structured vault knowledge, or re-synthesize one topic from everything known.
**Trigger:** "/compile", "compile", "process raw sources", "/compile [topic]", "recompile [topic]". Boot flags uncompiled `raw/` items but never compiles them itself.

---

## What `raw/` is

`raw/` is the inbox for unprocessed sources: articles, PDFs, transcripts, research, exported documents. Anything dropped there waits until it is compiled. A file counts as compiled once it carries `compiled: true` in its frontmatter.

**Never auto-compile.** `bin/harold boot` (and the morning brief) only report "[N] items in raw/ inbox; run /compile to process." Compiling writes to many files and makes judgment calls about people and facts; it runs only when the operator asks. The one exception is an item the operator has already marked urgent, and even then ask first.

---

## Mode 1: Process new raw sources

### Step 1: Scan

1. List every file in `raw/` and its subfolders.
2. Keep the ones without `compiled: true` in frontmatter.
3. Sort oldest first.
4. Tell the operator: "[N] uncompiled sources: [list]." Confirm which to process if the list is long.

**If `raw/` is empty or everything is compiled:** say so and stop.
**If a file can't be read** (binary, corrupt, not downloaded from cloud storage): list it as unreadable and move on; don't mark it compiled.

### Step 2: Compile each source

For each source:

1. **Read the whole thing.** Understand what it contains before filing anything.
2. **Classify it.** Which domain does it touch (a person, a company, a market, product, regulation, an event, a decision)?
3. **Extract structured knowledge:**
   - key facts, figures, quotes;
   - people mentioned (search the vault with `bin/harold search "<name>"` and the CRM with `harold_search_contacts` first; don't treat known contacts as new);
   - companies and organizations;
   - dates, deadlines, events;
   - implications for active projects.
4. **File it:**
   - People → create or update `vault/people/<name>.md` (frontmatter: `tags: [person]`, `type`, `labels`, `company`, `role`, `warmth`, `status`, `crm`, `last_updated`). A person merely mentioned in an article is not a CRM contact; don't create CRM records or pipeline entries from a source document. Add them via intake only if the operator wants to track them.
   - Companies → create or update `vault/companies/<name>.md`.
   - Intel / analysis → `vault/intel/YYYY-MM-DD-<topic>.md` (`tags: [intel]`, `type: durable|timely`, `status: active`, `source:`).
   - Decisions → `vault/decisions/YYYY-MM-DD-<topic>.md`.
   - Durable figures → `harold/facts.md`.
   - Project-specific material → the project's folder, resolved through `harold/projects.md` (`bin/harold where <topic>`). Never hard-code a project path.
   - Dashboard-level changes → `dashboard/status.md`, only if material.
   - Time-sensitive items → `harold/alerts.md`.
   - Upcoming events → `harold/events.md` (`## Upcoming Events`, Prep Status `Not Started`).
5. **Mark it compiled.** Add frontmatter to the raw file:
   ```yaml
   ---
   compiled: true
   compiled_date: YYYY-MM-DD
   compiled_to:
     - vault/intel/YYYY-MM-DD-topic.md
     - vault/companies/acme-corp.md
   ---
   ```
   For files that can't hold frontmatter (PDFs, images), write a sidecar note `raw/<filename>.md` with that frontmatter.
6. **Run an analyst sweep** if the source contains strategic intel (`playbook/core/analyst.md`).

### Step 3: Report

One line per source: what it was and where it went. Then log the session in today's daily note: `bin/harold file daily compile "<N> sources compiled: ..."`.

---

## Mode 2: Recompile a topic

When called with a topic (for example `/compile acme-corp`):

### Step 1: Gather every source

1. `raw/` files on the topic (compiled or not).
2. Existing vault notes: `bin/harold search "<topic>"`.
3. Project docs mentioning it (via `harold/projects.md`).
4. CRM contact and interaction history if it's a person or company (`harold_get_contact`).
5. Related tasks in the task manager (Linear by default).

**If a source is unreachable** (CRM or task manager down): continue with what's available and say which sources were missing in the report.

### Step 2: Synthesize

1. **Read everything.** Build the complete picture.
2. **Find gaps.** What's missing, contradictory or stale?
3. **Rewrite the primary vault note(s)** with the full accumulated context. This is a fresh synthesis, not an append. Keep the frontmatter valid and update `last_updated`.
4. **Update backlinks.** Related notes should link to the recompiled note.
5. **Update indexes** (`dashboard/status.md`, `harold/alerts.md`, project docs) only if the synthesis changes material facts.

### Step 3: Report

- What was recompiled.
- Key new insights from the synthesis.
- Gaps (things to research or ask the operator about).
- Files created or updated.

Log it in today's daily note (`bin/harold file daily compile "<summary>"`).

---

## When to recompile

| Signal | Action |
|--------|--------|
| 3+ raw sources on one topic in a week | Recompile that topic |
| A question needed 4+ vault files to answer | Recompile that topic afterwards |
| The monthly health check finds inconsistencies in a topic | Recompile it |
| A major event completed (call, meeting, milestone) | Recompile the person, company or project |
| Before an important meeting | Recompile the contact's profile |

---

## Output

- Raw sources marked `compiled: true` with destination paths.
- Vault notes created or rewritten.
- Dashboard, alerts, facts and events updated where material.
- A compilation summary in chat and in the daily note.

---

## Completion checklist

- [ ] Ran only because the operator asked (never auto-compiled at boot)
- [ ] Every processed source read in full
- [ ] Known people and companies checked in the vault and CRM before creating anything new
- [ ] Knowledge filed to the right vault folders; project material resolved through `harold/projects.md`
- [ ] No CRM records or pipeline entries created from mere mentions
- [ ] Each processed source marked `compiled: true` with `compiled_date` and `compiled_to` (or a sidecar note)
- [ ] Unreadable files listed, not marked compiled
- [ ] Analyst sweep run for strategic intel
- [ ] Summary reported and logged in `vault/daily/`
