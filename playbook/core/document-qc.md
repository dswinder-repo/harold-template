# Playbook: Document QC

**Purpose:** Fact-check a final document before it leaves the building, and fix the knowledge base wherever it was wrong.
**Trigger:** The operator signals a document is final: "this is final", "ready to send", "lock it in", "good to go", "send this to [person]", "finalize this".

Quality control for final documents before external distribution. It serves two purposes: (1) make sure the document is accurate, and (2) surface and correct knowledge base errors at the moment they would cause real-world harm.

---

## Trigger

**Run this playbook when the operator signals a document is final:**
- "This is final"
- "Ready to send"
- "Lock it in"
- "Good to go"
- "Send this to [person]"
- "Finalize this"
- "This is the version"
- "Let's go with this one"
- Any explicit approval for external distribution

**Applies to:**
- Word documents (.docx)
- Presentations (.pptx)
- Spreadsheets (.xlsx) with external-facing data
- PDFs
- Email drafts to external parties
- Any document going to investors, partners, public bodies, customers or the public

**Does NOT apply to:**
- Iterative drafts during active editing
- Internal working documents
- Quick notes or memos
- Documents explicitly marked "draft" or "WIP"

---

## Philosophy

The knowledge base is not infallible. Errors enter through:
- Transcription mistakes
- Outdated information that was never updated
- Misheard names or figures
- Copy/paste errors
- Assumptions that were never verified

**Every final document is an audit opportunity.** Fact-checking against external sources catches knowledge base errors at the moment they would cause harm, and fixes them at the source.

---

## Steps

### 1. Pre-Flight Checklist (Structural)

Before content review, verify basics:

- [ ] **Format correct** — margins, fonts, spacing per template (if applicable)
- [ ] **Sections complete** — no placeholder text, no "[TBD]" or "[INSERT]"
- [ ] **Attachments present** — every referenced file included
- [ ] **Metadata clean** — author name and file properties appropriate for the recipient
- [ ] **Version identifiable** — date or version number if relevant

If any item fails, stop and fix it (or tell the operator) before step 2.

### 2. Internal Consistency Review

Cross-reference document content against the knowledge base:

| Check | Against |
|-------|---------|
| People: names, spellings, titles, companies | `vault/people/<name>.md` (frontmatter `company`, `role`) **and** the CRM record (`harold_search_contacts` / `harold_get_contact`) |
| Metrics and numbers (revenue, users, raise size, headcount) | `harold/facts.md` first, then `dashboard/status.md` |
| Terminology and product names | `harold/facts.md`, `memory/glossary.md` |
| Dates and timelines | `harold/events.md`, project milestones |
| Company positioning | The project's own docs, resolved with `bin/harold where <project>` |
| Team info | `vault/people/` profiles of your colleagues (e.g. `type: team`) |
| Historical claims ("we met in...", "they committed to...") | `vault/meetings/`, `vault/daily/`, `vault/decisions/`; use `bin/harold search "<claim>"` |

**Flag every discrepancy** between the document and the knowledge base, and between the vault profile and the CRM record for the same person. Do not assume the document is wrong; the knowledge base might be the error source.

**If data is missing:** a number with no entry in `harold/facts.md`, or a person with no vault profile and no CRM record, is marked **unverified internally**. It goes to step 3 for external verification and is listed in the clearance report. It is never silently passed.

### 3. External Fact Verification

**This is the critical step.** Verify checkable facts against authoritative external sources:

| Fact type | Verification source | Search query pattern |
|-----------|--------------------|--------------------|
| **Person's title/role** | Professional profile, company website | "[Name] [Company] [title]" |
| **Company info** | Official website, company databases | "[Company] official site" |
| **Funding amounts** | Company databases, news, regulatory filings | "[Company] funding round [year]" |
| **Revenue/metrics** (public companies) | Regulatory filings, earnings reports | "[Company] revenue [year] annual report" |
| **Event dates** | Official event websites | "[Event name] [year] dates" |
| **Policy/regulatory** | Government sources | "[Policy] official government source" |
| **Geographic/demographic facts** | Official statistics | Verify as needed |

**Priority verification targets:**
1. Any number an investor or funder will see
2. Names and titles of the people receiving the document
3. Claims about third parties (partners, competitors)
4. Dates that drive action (deadlines, events)
5. Regulatory or compliance statements

Use web search. Record what was checked and the source for each fact.

**If an external source cannot be found or reached:** the fact stays marked **unverified** in the clearance report, and the operator decides whether to send with it, soften it, or cut it.

### 4. Discrepancy Resolution

When external sources conflict with the knowledge base:

```
┌─────────────────────────────────────────────────────────────┐
│  DISCREPANCY FOUND                                          │
│                                                             │
│  Document says: [X]                                         │
│  Knowledge base says: [X]  (file: [path] / CRM)             │
│  External source says: [Y]                                  │
│  Source: [URL/citation]                                     │
│                                                             │
│  → Recommend: Update KB to [Y] based on [source authority]  │
└─────────────────────────────────────────────────────────────┘
```

**Resolution process:**
1. **Present the discrepancy to the operator** — what we have vs. what the external source says.
2. **Recommend a resolution** — which source is more authoritative, and why.
3. **If the KB was wrong, fix it at the source, all places at once:**
   - The file the wrong value came from (project doc, `dashboard/status.md`, `harold/events.md`, etc.).
   - `harold/facts.md` if it is a discrete fact (`harold_fact`, or edit the file).
   - **For a person:** the CRM contact record comes first (`harold_upsert_contact` with the corrected title/company/name), then `vault/people/<name>.md` (fix the field, bump `last_updated`). A correction is not an interaction: do not call `harold_log_interaction` for it. If the CRM is unreachable, queue the update: `bin/harold file crm '{"contact":"Jane Doe","action":"upsert_contact","payload":{...}}'`.
   - If the error came from something Harold introduced (misheard, assumed, mis-transcribed) or the operator corrected it, file a lesson immediately: `bin/harold file learning '{"severity":"critical","project":"global","category":"facts","lesson":"..."}'` (use category `names` or `titles` where that fits).
4. **Update the document** with the correct information.
5. **Note the fix** in today's daily note: `bin/harold file daily <slug> "Document QC: corrected [X] to [Y] in [files], source [citation]"`.

### 5. Final Review (Skeptical Pass)

Spawn a reviewer subagent with this framing:

```
You are a skeptical editor reviewing this document before it goes to [recipient type].
Your job is to find problems. Assume errors exist until proven otherwise.

Check for:
- Claims that sound too precise (fake precision)
- Numbers without clear sources
- Superlatives that may not be defensible ("largest", "first", "only")
- Names that could be misspelled
- Dates that seem off
- Anything that would embarrass us if wrong

Return a punch list of concerns, even minor ones. Better to flag and dismiss than to miss.
```

Address every concern raised (fix it, or record why it was dismissed), then proceed. If subagents are unavailable, do the pass yourself in a separate, explicitly adversarial read.

### 6. Clearance

Once all steps are complete:

```
✓ DOCUMENT QC COMPLETE

  Pre-flight: Passed
  Internal consistency: [X] items checked
  External verification: [X] facts verified, [X] unverified (listed below)
  Discrepancies found: [X] (resolved)
  KB updates made: [files, CRM records]
  Final review: Passed

  Document cleared for distribution.
```

Clearance does not send anything. Sending, publishing or posting is the operator's action, or needs their explicit yes.

---

## Quick Reference: What to Verify Externally

**Always verify before sending to investors or funders:**
- Revenue figures
- Growth rates
- Customer counts
- Funding amounts (yours and comparables)
- Market size claims
- Competitor information

**Always verify before sending to partners or public bodies:**
- Their organization's correct name
- The contact person's current title
- Any claims about their programs or initiatives
- Geographic or demographic data about their region

**Always verify for any external document:**
- Spelling of all proper nouns
- Dates of upcoming events
- Any "as of [date]" statements

---

## Knowledge Base Feedback Loop

```
Document Created
      ↓
QC Process Runs
      ↓
External Verification
      ↓
Discrepancy Found? ──No──→ Document Cleared
      ↓ Yes
Determine Truth
      ↓
Update Knowledge Base + CRM ←──┐
      ↓                        │
Update Document                │
      ↓                        │
Next Document ─────────────────┘
      (starts with a better KB)
```

Over time the knowledge base gets more accurate, because every external document forces verification of the data underneath it.

---

## Integration with Other Playbooks

This playbook runs **after** content creation and **before** distribution:

- Meeting-prep briefing → **document-qc.md** → send
- Outreach email → **document-qc.md** → send
- `content-production.md` → post → **document-qc.md** → publish
- Any document workflow → final version → **document-qc.md** → distribute

---

## Completion checklist

- [ ] Document passes structural pre-flight
- [ ] Internal consistency checked: metrics against `harold/facts.md`, people against `vault/people/` and the CRM
- [ ] Key facts verified against external sources, with sources recorded
- [ ] Unverified items listed in the clearance report (never silently passed)
- [ ] Discrepancies resolved; KB files, `harold/facts.md`, CRM record and vault profile corrected together (or CRM queued with `bin/harold file crm`)
- [ ] Lesson filed with `bin/harold file learning` if Harold introduced the error
- [ ] Fix recorded in today's `vault/daily/` note
- [ ] Skeptical review passed
- [ ] Clearance report given to the operator; nothing sent without their yes
