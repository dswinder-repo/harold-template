# Playbook: Event Prep & Debrief

> **CRM tools.** Where a step names two tools (`crm_upsert_contact` / `harold_upsert_contact`), the first is the hosted connector's and the second harold-mcp's. Use whichever your harness has: they write the same database. A write made through the connector on a computer without CRM credentials is recorded with `bin/harold file crm '{...,"applied":"connector"}'` (see `AGENTS.md`, CRM Filing Protocol).

**Purpose:** Prepare for events before they arrive, capture well on the day, and debrief afterwards so nothing is lost.
**Trigger:** Boot lists an event in `harold/events.md` less than 10 days out with Prep Status not Complete (trigger id `event-prep:<event name>`); "prep me for [event]"; "debrief [event]"; an event's end date has passed with the debrief open.

---

## Where events live

`harold/events.md` is the only list of events. Do not hardcode events in this playbook or anywhere else; a hardcoded list goes stale silently. The file has an `## Upcoming Events` table:

```
| Event | Dates | Project | Task | Prep Status | Debrief Due | Debrief Status |
|-------|-------|---------|------|-------------|-------------|----------------|
| Globex Summit | YYYY-MM-DD to YYYY-MM-DD | [PROJECT] | [TEAM]-123 | Not Started | YYYY-MM-DD | Open |
```

- **Prep Status:** `Not Started`, `In Progress` or `Complete`.
- **Debrief Due:** end date + 2 days.
- Past events move out of `## Upcoming Events` once the debrief is done (to a `## Past Events` section or archive).

Every session, `bin/harold boot` checks this table against the system date. Any event less than 10 days out whose Prep Status is not `Complete` fires this playbook as `event-prep:<event name>`.

**If data is missing:** an event with no dates cannot be scheduled against. Ask the operator for the dates and fill them in. An event with no Project: resolve it through `harold/projects.md` (`bin/harold where <topic>`) or ask.

---

## Part 1: Pre-Event Prep

### Inputs
- The event's row in `harold/events.md`.
- The event website or agenda, if available.
- Project context: resolve the folder through `harold/projects.md`.
- Notes from the last edition, if it is a repeat event (`bin/harold search "<event name>"`).

**If inputs are missing:** write the brief with what exists and list the gaps at the top ("agenda not yet published", "attendee list unknown").

### Steps

1. **Pull event context.** Dates, location, format, key sessions and speakers, attendee list if available. Set Prep Status to `In Progress` in `harold/events.md`.

2. **Identify goals.**
   - Business goals: meetings, partnerships, deals.
   - Content goals: what to capture (trends, quotes, observations) for later writing.
   - Relationship goals: who to meet or reconnect with. For each person, check the vault profile (`vault/people/`) and the CRM (`crm_get_contact` / `harold_get_contact`) for warmth, history and any open pipeline entry.

3. **Write the prep brief** using the template below. Save it in the project's folder (resolved through `harold/projects.md`), for example `<project>/notes/YYYY-MM-DD-<event>-prep.md`. Run `playbook/core/pre-flight-verification.md` over it before presenting.

4. **Logistics checklist.** Travel, lodging, meetings confirmed, materials. Flag anything unconfirmed to the operator; do not book or pay for anything.

5. **Capture setup.** Note-taking method ready, a way to capture contacts, any recording or photo permissions clear.

6. **Mark it.** When the brief and logistics are done, set Prep Status to `Complete` and record:
   ```bash
   bin/harold file trigger "event-prep:Globex Summit" ran "Prep brief written; 3 meetings confirmed"
   ```
   If prep can't finish this session, leave Prep Status `In Progress` and record `deferred "<reason>"`; the trigger will fire again next session.

### Pre-event brief template

```
## EVENT PREP: [Event Name]
**Dates:** [date range]
**Location:** [city, venue]
**Format:** [conference / meeting / trade show / etc.]
**Gaps:** [anything not yet known]

### GOALS

**Business:**
1. [specific outcome: meeting, partnership, deal]

**Content:**
1. [what to capture: trends, quotes, observations]

**Relationships:**
1. [who to meet: name, why]
2. [who to reconnect with]

### KEY SESSIONS / AGENDA

| Time | Session | Why attend | Capture |
|------|---------|------------|---------|
| [time] | [session] | [relevance] | [what to note] |

### PEOPLE TO FIND

| Name | Org | Warmth | Why | Approach |
|------|-----|--------|-----|----------|
| Jane Doe | Acme Corp | Warm | [goal] | [how to connect] |

### LOGISTICS

- [ ] Travel: [details]
- [ ] Lodging: [details]
- [ ] Ground transport: [details]
- [ ] Meetings confirmed: [list]
- [ ] Materials: [deck, cards, etc.]

### CONTENT ANGLES TO WATCH

1. **[YOUR THEME 1]:** [what to look for]
2. **[YOUR THEME 2]:** [what to look for]
3. **Contrarian takes:** [what conventional wisdom to test]

### DAILY RHYTHM

**Morning:** [plan]
**Afternoon:** [plan]
**Evening:** [plan]
**Nightly:** 10-minute voice memo or notes capturing the day's highlights
```

---

## Part 2: Day-of

Harold's job on event days is to make capture cheap:

- Keep the prep brief one search away (`bin/harold search "<event name>"`).
- When the operator sends quick notes ("met Sam Lee from Globex, wants a follow-up on pricing"), append them to today's daily note: `bin/harold file daily <event-slug> "<note>"`. Don't process them into the CRM mid-event unless asked; the debrief does that properly.
- At the end of each event day, if the operator is in a session, ask for the day's highlights and append them to the same daily note. Nothing runs this on a schedule.

---

## Part 3: Post-Event Debrief

### Trigger
- "Debrief [event]", or the operator says the event is over.
- An event's Debrief Due date (in `harold/events.md`; usually the end date plus a day or two) has passed and its Debrief Status is still open. Boot does not compute this one: the session that rebuilds alerts sees it in the Upcoming Events table (the "event ended, no debrief" rule in `harold/alerts.md`) and offers the debrief.

### Steps

1. **Capture raw impressions.** Ask the operator: what stood out, what surprised you, who was interesting? Pull the day-of notes from `vault/daily/`.

2. **Process contacts.** For each person met:
   - Check the vault and CRM first; don't treat known contacts as new.
   - New people → run `playbook/core/contact-intake.md` (or the intake flow).
   - File all three together: `crm_log_interaction` / `harold_log_interaction` + `crm_upsert_contact` / `harold_upsert_contact` + the `vault/people/` profile (warmth, last_updated). If the CRM is unreachable, queue with `bin/harold file crm '{...}'`.
   - Types listed in the optional `HAROLD_NO_LOG_TYPES` (see `AGENTS.md`) get their record updated, never an interaction.
   - Pipeline: only add a pipeline entry if a conversation established a purpose. Never auto-place someone because you met them.

3. **Create follow-up tasks** in the task manager (Linear by default): thank-you notes within 48 hours, meeting requests within a week.

4. **Extract content.** Identify 2-3 content pieces from the observations; draft hooks or outlines; save them in the project folder.

5. **Update the knowledge base.**
   - New intel → `vault/intel/YYYY-MM-DD-<topic>.md`; if it's strategic, run `playbook/core/analyst.md`.
   - Durable figures → `harold/facts.md`.
   - Lessons for next time → the debrief note (below) so the next edition's prep finds them.

6. **Write the debrief note** to `vault/meetings/YYYY-MM-DD-<event>-debrief.md` using the template below.

7. **Close it out** in `harold/events.md`: set Debrief Status to done and move the row out of `## Upcoming Events`.

### Post-event debrief template

```
## EVENT DEBRIEF: [Event Name]
**Dates attended:** [dates]
**Debrief date:** [YYYY-MM-DD]

### TOP TAKEAWAYS
1. [most important insight]
2. [second]
3. [third]

### NEW CONTACTS

| Name | Org | Context | Follow-up | Priority |
|------|-----|---------|-----------|----------|
| Sam Lee | Globex | [how met, what discussed] | [action] | H/M/L |

### CONTENT CAPTURED

**Observations:**
- [observation]

**Potential pieces:**
1. [topic] - [format] - [hook]

**Quotes / data points:**
- "[quote]" - [source]

### FOLLOW-UPS

| Action | Who | By when | Status |
|--------|-----|---------|--------|
| [action] | [person] | [date] | [ ] |

### LESSONS FOR NEXT TIME
- [what worked]
- [what to do differently]
```

---

## Output
- Prep brief saved in the project folder; Prep Status `Complete`.
- Day-of notes in the daily note.
- Debrief note in `vault/meetings/`.
- Contacts filed in the CRM and vault; follow-up tasks created.
- Content ideas captured.
- `harold/events.md` current.

---

## Success criteria
- No scrambling in the last days before an event.
- Every contact captured and followed up.
- Content extracted from every significant event.
- Institutional memory builds up for repeat events.

---

## Completion checklist

**Pre-event**
- [ ] Event row in `harold/events.md` has dates and project; Prep Status set to `In Progress`
- [ ] Goals written (business, content, relationships)
- [ ] People to find checked against the vault and the CRM
- [ ] Prep brief saved in the project folder and pre-flight verified
- [ ] Logistics gaps flagged to the operator
- [ ] Prep Status set to `Complete` (or left `In Progress` with a reason)
- [ ] `bin/harold file trigger "event-prep:<event name>" ran|deferred "<reason>"` recorded

**Post-event**
- [ ] Raw impressions and day-of notes gathered
- [ ] Contacts filed (log + upsert + vault profile, or queued); `HAROLD_NO_LOG_TYPES` respected
- [ ] Follow-up tasks created in the task manager
- [ ] Debrief note written to `vault/meetings/`
- [ ] Intel and facts filed
- [ ] Debrief Status closed and row moved out of `## Upcoming Events`
