# Playbook: Pre-Flight Verification

> **CRM tools.** Where a step names two tools (`crm_upsert_contact` / `harold_upsert_contact`), the first is the hosted connector's and the second harold-mcp's. Use whichever your harness has: they write the same database. A write made through the connector on a computer without CRM credentials is recorded with `bin/harold file crm '{...,"applied":"connector"}'` (see `AGENTS.md`, CRM Filing Protocol).

**Purpose:** Catch wrong names, dates, facts and filing before any output reaches the operator.
**Trigger:** Before presenting any brief, research, email draft, meeting prep or filing decision; any output with names, dates, facts or recommendations.

---

## Why This Exists

Most errors an assistant makes are not reasoning failures. They are lookups that were skipped: a name spelled from memory, a date described as "last week" without checking, a news item reported without noticing it touches an existing partnership, a colleague assumed to be in the office while they were travelling, a document filed in the wrong project because nobody thought about it.

Every one of those is cheap to prevent and expensive to repair, because each one costs the operator trust in everything else the assistant says. This checklist makes the lookups mandatory.

**Principle:** When an error gets caught, fix the system so it cannot happen again (see "Where errors are recorded" below).

---

## The Checklist

### 1. Names, titles and organizations

Before using any person, company, title or event name:

- [ ] **Is it spelled correctly?** Check the vault profile first: `bin/harold search "<name>"`, then `vault/people/` and `vault/companies/`.
- [ ] **Does the CRM agree?** Look the person up with `crm_search_contacts` / `harold_search_contacts` / `crm_get_contact` / `harold_get_contact`. The CRM record and the vault profile must match on name, title (`role`) and organization (`company`). If they disagree, say so and ask which is right; do not pick one silently.
- [ ] **Do I actually know what this is?** If not, research it before continuing.
- [ ] **Is it a known contact?** Check `harold/facts.md` and the vault before treating anyone as new.
- [ ] **Did the input come from transcription or voice?** Names from transcripts are frequently wrong. Verify every one.

**If data is missing:** no vault profile and no CRM record means the name is unverified. Either research it or mark it in the output as unverified (for example `Jane Doe [spelling unverified]`). Never present a guessed spelling as fact.

**Rule:** Unknown name or entity = stop and research before continuing.

---

### 2. Cross-reference (news and intel)

When presenting news or market intel:

- [ ] **Does it relate to an existing partnership, agreement or relationship?** Search the vault (`bin/harold search "<company or topic>"`) and check `harold/facts.md`.
- [ ] **Does it affect an upcoming event?** Check `harold/events.md`.
- [ ] **Does it touch an active project?** Check `harold/projects.md` (or `bin/harold where <topic>`) and `dashboard/status.md`.
- [ ] **Is there a second-order connection?** Think about pipeline contacts, target markets, open blockers in `harold/blockers.md`.

**Rule:** Don't just report news. Connect it to what the knowledge base already knows. If it is substantive, run `playbook/core/analyst.md`.

---

### 3. Dates and timelines

Before using any date reference:

- [ ] **What is today, really?** Take it from the system (`date "+%Y-%m-%d %A"`, which `bin/harold boot` already prints). Never infer today's date from file contents or memory.
- [ ] **Is the date correct?** Calculate actual days and weeks from the system date.
- [ ] **Specific beats relative.** Write "Tuesday 14 [MONTH]" rather than "last week". If you use a relative phrase, you must have checked the date it refers to.
- [ ] **Task dates come from the task manager (Linear by default), not memory.**
- [ ] **Event dates come from `harold/events.md`, not memory.**
- [ ] **Who is where?** Check whether relevant people are travelling (see section 4).

**If data is missing:** if the date cannot be verified, say "date unverified" in the output rather than guessing.

**Rule:** Never use relative time ("last week", "recently") without verifying the actual date against the system date.

---

### 4. Context and location

Before stating where someone is or what they are doing:

- [ ] **Check `harold/events.md`** for travel and meetings.
- [ ] **Check recent daily notes** in `vault/daily/` (today and yesterday at minimum).
- [ ] **Check `harold/alerts.md`** for time-bound context (travel windows, leave, deadlines).
- [ ] **Don't assume.** If you are not certain, say so or look it up.

**Rule:** Verify context before making location- or availability-based suggestions.

---

### 5. Facts and grounding

Before stating a figure, metric or claim:

- [ ] **Is it in `harold/facts.md`?** If so, cite it (for example "per facts.md"). If facts.md and another file disagree, facts.md is the source of truth; flag the other file for correction.
- [ ] **Is it grounded or speculative?** Separate them visibly. Grounded = came from a file, the CRM, the task manager, or a source you just read. Speculative = your inference. Label inference as inference ("likely", "my read is").
- [ ] **Is it stale?** Check the fact's last-updated date. Anything older than the relevant cycle (a quarter for financials, a month for pipeline state) gets a caveat.

**If data is missing:** say the fact could not be verified rather than filling the gap from memory.

**Rule:** No uncited numbers. No inference dressed as fact.

---

### 6. File categorization

Before creating or filing any document:

- [ ] **Which project does it belong to?** Resolve the folder through `harold/projects.md` (`bin/harold where <topic>`). Never hard-code a project path.
- [ ] **Project-specific or cross-project?** Project-specific goes to that project's folder; cross-project goes to the shared location `harold/projects.md` names.
- [ ] **Committed event or one under consideration?** Committed → its own entry under `## Upcoming Events` in `harold/events.md`. Considering → noted as such, not in the upcoming table.
- [ ] **Does the task in the task manager match the filing location?** A cross-project brief should not hang off a single project's task.

**If data is missing:** if `bin/harold where` returns nothing for the topic, ask the operator where it belongs and add the answer to `harold/projects.md`.

**Rule:** Think through categorization before filing.

---

### 7. Email and message drafts

Before presenting any draft:

- [ ] **When was the original outreach sent?** Verify the exact date (CRM interaction log, sent mail, daily notes).
- [ ] **What did the original say?** Reference the actual content, not a paraphrase from memory.
- [ ] **Who is "we"?** Confirm who is attending or participating.
- [ ] **Does it follow the operator's style rules?** See "Your style rules" below.
- [ ] **Any earlier corrections?** Check `harold/learnings.jsonl` for lessons about this contact or this kind of message.

**Rule:** Follow-ups must reference real dates and real content from the original outreach.

---

### 8. Format

- [ ] **Does the output match what was asked for?** A one-line question gets a short answer, not a report.
- [ ] **Is the most important thing first?**
- [ ] **Are open questions and unverified items called out at the end,** not buried in the middle?

---

## Your style rules

Replace this section with your own preferences. They are checked in step 7 and on every draft. Examples (fictional, delete them):

- Default meeting length in any scheduling request is 30 minutes unless stated otherwise.
- No exclamation marks in external email.
- Sign off with first name only; never "Best regards".

---

## When to Run This

**Always run before:**
- Presenting a morning brief or daily brief
- Drafting emails or outreach
- Presenting research findings
- Creating meeting prep briefs
- Filing new documents
- Presenting news with strategic callouts

**Quick version (for simple outputs):**
1. Any unknown names? → Verify against the vault and the CRM first.
2. Any dates? → Verify against the system date.
3. Any figures? → Cite `harold/facts.md` or mark as unverified.
4. Any news? → Cross-reference the knowledge base.
5. Any filing? → Resolve through `harold/projects.md`.

---

## Integration with Other Playbooks

This protocol runs before task-specific playbooks finish their output:

```
Task playbook (gather + draft) → Pre-flight verification → Output
```

Example:
1. The operator asks for meeting prep.
2. Harold gathers context and drafts the brief.
3. Harold runs this checklist over the draft (names, dates, facts, context).
4. Harold presents the verified output.

---

## Where errors are recorded

When an error slips through and the operator corrects it, record the lesson in the same turn, before any other work:

```bash
bin/harold file learning '{"severity":"critical","project":"global","category":"names","lesson":"..."}'
```

Use `category` `names`, `titles`, `facts`, `context`, `filing`, `process`, `scope` or `tools` as fits. Never hand-edit `harold/learnings.jsonl` and never choose the id yourself. If the same kind of error recurs, add a check to this playbook so the fix becomes structural.

---

## Completion checklist

- [ ] Every name, title and organization checked against the vault and the CRM (or marked unverified)
- [ ] Every date checked against the system date; no unverified relative dates
- [ ] Every figure cited to `harold/facts.md` or marked unverified
- [ ] Speculation labeled as speculation
- [ ] Location and availability claims checked against `harold/events.md`, `harold/alerts.md` and recent daily notes
- [ ] Filing location resolved through `harold/projects.md`
- [ ] Drafts checked against "Your style rules"
- [ ] Any correction from the operator filed with `bin/harold file learning` in the same turn
