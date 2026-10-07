# Playbook: Meeting Debrief

> **CRM tools.** Where a step names two tools (`crm_upsert_contact` / `harold_upsert_contact`), the first is the hosted connector's and the second harold-mcp's. Use whichever your harness has: they write the same database. A write made through the connector on a computer without CRM credentials is recorded with `bin/harold file crm '{...,"applied":"connector"}'` (see `AGENTS.md`, CRM Filing Protocol).

**Purpose:** Capture a meeting's outcomes and file them into the CRM, vault, tasks and facts so nothing is lost.
**Trigger:** "just finished [meeting]", "debrief [name]", "had a call with", "meeting notes", "here's the transcript", pasted notes or a transcript, or any mention of a completed meeting with a contact.

---

## Inputs

The operator may provide any of:
- **Raw notes** typed during or after the meeting
- **A transcript** from a meeting-transcription tool
- **A recording** to be transcribed first
- **A quick dump** of unstructured thoughts about how it went

Harold processes whatever is provided, then **asks follow-up questions only for the gaps**.

---

## Debrief Questions

1. **"How did it go?"** Vibe check (good / meh / rough) plus 1-2 sentences.
2. **"What did you learn?"** Key insights, surprises, new context.
3. **"What do they need from us?"** Their asks, concerns, blockers.
4. **"What do we need from them?"** Our asks, information gaps.
5. **"What's the next step, and when?"** Follow-up action and timing.

**If notes or a transcript were provided:** extract first, then ask only what is still missing.

**Example flow:**
```
Operator: "Just finished with Jane Doe from Acme Corp. Transcript: [paste]"
Harold:   [extracts key points]
Harold:   "Got it. Looks like she's interested but wants two customer case studies.
           A few quick questions:
           - Overall feel: good momentum?
           - Did she mention timing for a follow-up?
           - Anything she needs from us before the next conversation?"
```

---

## Steps

### 0. Gate check (before any CRM action)
For each attendee, open their `vault/people/<Name>.md` profile.
- **`crm: none`** → deliberately out of the CRM. Skip steps 3 and 5 for them; the vault profile is still updated.
- **No profile** → run `playbook/core/contact-intake.md` for them first (it does the duplicate check).
- **Type listed in `HAROLD_NO_LOG_TYPES`** (an optional setting, off by default; see "CRM Filing Protocol" in `AGENTS.md`) → skip step 3 for them; keep their record and profile current in step 5. Action items and facts still get filed.

### 1. Process input
- **Notes / transcript:** extract attendees, topics, decisions, action items, and asks from both sides.
- **Recording:** transcribe, then extract.
- **Just a trigger** ("debrief Jane Doe"): ask the debrief questions directly.

### 2. Ask clarifying questions
Target the gaps only. Never re-ask what the notes already answer.

### 3. Log the interaction to the CRM
**`crm_log_interaction` / `harold_log_interaction`**, immediately after processing:
- type: `meeting` (or `call`)
- contact: the primary contact (one interaction per attendee you track)
- subject: brief description (e.g. "Pilot scoping call")
- body: key takeaways in 2-3 sentences, not the transcript
- This feeds freshness tracking automatically; no manual cadence update is needed.

**If the CRM is unreachable:** queue it and keep going (boot and close apply the queue once the CRM answers):
```bash
bin/harold file crm '{"contact":"Jane Doe","action":"log_interaction","payload":{"type":"meeting","subject":"...","body":"..."}}'
```

### 4. Create tasks
For each action item:
- **Task manager (Linear by default):** clear title, owner, due date, linked to the right project (resolve it with `bin/harold where <topic>`).
- **`crm_task` / `harold_crm_task`** for contact-specific follow-ups ("Send case studies to Jane Doe", "Schedule follow-up with Sam Lee"), with due dates taken from what was said ("by Friday", "next week"). Queue with `bin/harold file crm` (`action: crm_task`) if the CRM is down.
- *If the task manager is unreachable:* list the tasks in today's daily note under "Tasks to create" so the next session files them.

### 5. Update the relationship
All three together, per the CRM filing protocol:
1. **`crm_upsert_contact` / `harold_upsert_contact`** — warmth if the meeting changed closeness (e.g. Cold → Lukewarm after a good intro, Warm → Hot after deep engagement), status (pending → active after the first real meeting), notes with the meeting context.
2. **Pipeline** — if the meeting *established a purpose* ("they want to pilot", "they're considering investing"), add an entry with `crm_pipeline` / `harold_pipeline` (`add`, with that purpose and a stage). If it moved an existing purpose, `move` the stage. If it ended one, `close` it. Never create an entry the conversation didn't establish.
3. **`vault/people/<Name>.md`** — **evolve** the profile, don't just append: update `warmth`, `status`, `last_updated`, correct any facts that changed (role, company, focus), and add a Timeline entry using the template below.

If the contact belongs to a project, also update that project's folder or `vault/projects/<slug>.md` card with the status change.

### 6. Extract atomic facts → `harold/facts.md`

| Fact type | Example | Section |
|-----------|---------|---------|
| Preferences | "Prefers morning calls", "Email, not chat" | Preferences |
| Commitments | "Will send the intro by Friday" | Commitments |
| Relationships | "Knows Sam Lee at Globex", "Introduced by Jane Doe" | Relationships |
| Constraints | "Doesn't do pre-revenue", "Budget frozen until Q3" | Constraints |
| Numbers | "Fund is $50M", "Team of 40" | Numbers |
| Terminology | Correct spelling of a name, title, company | Terminology |

**If a fact contradicts an existing entry:** update that entry with the new date. Don't add a duplicate.

### 7. Vault notes
- **Always** create `vault/meetings/YYYY-MM-DD-<contact-slug>.md` from `vault/templates/meeting.md`: attendees, decisions, action items, and `[[wiki-links]]` to people and companies.
- If the meeting surfaced market, competitor or strategy intel, create `vault/intel/<topic-slug>.md` from `vault/templates/intel.md` (mark it durable or timely) and run `playbook/core/analyst.md` on it.

### 8. Draft the follow-up (if needed)
Reference specific points from the conversation, include any promised materials, end with a clear next step. **Draft only; the operator sends it.**

### 9. Update the dashboard
Add to Recent Activity in `dashboard/status.md`:
```
- [DATE]: [Meeting type] with [Name] — [one-line outcome]
```

### 10. Schedule the next touch
- A scheduled meeting → `harold/events.md` (or `harold_event`).
- A dated reminder or deadline → the task manager, or `harold_alert` if it is urgent. `harold/alerts.md` is rebuilt from sources each morning, so the source entry is what matters.

### 11. Log the session
Append to today's `vault/daily/YYYY-MM-DD-<slug>.md` (or `bin/harold file daily <slug> "<text>"`): who was met, what was filed where, anything queued.

---

## Templates

### Timeline entry (for the person profile)
```markdown
#### [DATE] — [Meeting type]
**Attendees:** [Names]
**Vibe:** [Positive / Neutral / Challenging]
**Key takeaways:**
- [Insight 1]
- [Insight 2]

**Their ask:** [What they need]
**Our ask:** [What we need]
**Next step:** [Action + timeline]
```

### Follow-up email (investor or buyer)
```
Subject: Great connecting — [specific reference]

[Name],

Thanks for taking the time today. [Reference a specific point from the conversation].

As discussed, I'm sending over [promised materials]. [One line restating the value most relevant to their interest].

[Clear next step + timeline].

Best,
[YOUR NAME]
```

### Follow-up email (partner)
```
Subject: Following up — [topic from the meeting]

[Name],

Appreciate the conversation today. [Reference their priority or challenge].

[How [YOUR COMPANY] connects to their goals]. I'd love to [specific next step].

[Clear ask + timeline].

Best,
[YOUR NAME]
```

---

## Success criteria

- No meeting insight is lost to memory
- Every action item is trackable in the task manager
- Relationship context builds over time instead of being overwritten
- Follow-up happens inside the right window
- Future prep briefs can cite past conversations

---

## Completion checklist

- [ ] Gate checked for every attendee (`crm: none` and `HAROLD_NO_LOG_TYPES`, if set, respected)
- [ ] `crm_log_interaction` / `harold_log_interaction` called (or queued) for each contact
- [ ] Tasks created in the task manager; `crm_task` / `harold_crm_task` for contact-specific follow-ups
- [ ] `crm_upsert_contact` / `harold_upsert_contact` called; pipeline entry added/moved/closed only if the conversation established it
- [ ] `vault/people/` profile evolved (warmth, status, `last_updated`, timeline)
- [ ] Atomic facts in `harold/facts.md` (contradictions updated, not duplicated)
- [ ] `vault/meetings/` note created; intel note + analyst run if applicable
- [ ] Follow-up drafted if needed (not sent)
- [ ] `dashboard/status.md` Recent Activity updated
- [ ] Next touch scheduled (events, task manager, or alert)
- [ ] Today's `vault/daily/` note updated
