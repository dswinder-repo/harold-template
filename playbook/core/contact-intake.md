# Playbook: Contact Intake

> **CRM tools.** Where a step names two tools (`crm_upsert_contact` / `harold_upsert_contact`), the first is the hosted connector's and the second harold-mcp's. Use whichever your harness has: they write the same database. A write made through the connector on a computer without CRM credentials is recorded with `bin/harold file crm '{...,"applied":"connector"}'` (see `AGENTS.md`, CRM Filing Protocol).

**Purpose:** File a new or changed contact into the CRM, vault and tasks, with a duplicate check first.
**Trigger:** Runs passively whenever a name with business significance appears; also "add [name] to the CRM", "met [name]", "new contact", "/intake".

**This playbook runs automatically.** The operator does not need to say "add this contact". It happens whenever a new name shows up.

---

## Trigger (passive detection)

Watch every message for names with business significance:
- Names in the context of meetings, calls, emails, intros
- Names attached to an organization, title or role
- Names tied to deals, partnerships, investments, hiring, projects
- Names from business cards, profiles, event attendee lists

**Not triggered by:**
- Casual mentions ("my friend Sam")
- Historical references with no current relevance
- Names already in the system (that is an update; see below)

---

## Step 1 — Duplicate check (MANDATORY, before anything else)

1. **`crm_search_contacts` / `harold_search_contacts`** by name (and organization if known). This is the primary check.
2. **`bin/harold search "<name>"`** — catches `vault/people/`, `harold/facts.md`, meeting notes, spelling variants. Then `bin/harold related "<name>"` shows their card (if any), their company and every note that links to them.
3. The task manager (Linear by default) for existing tasks naming this person.
4. Any tracker you keep for a project (resolve its folder with `bin/harold where <topic>`).

**If the contact EXISTS:** this is an **update**, not an intake. Call `crm_upsert_contact` / `harold_upsert_contact` with the existing contact id for whatever changed (email, title, company, warmth). Update the `vault/people/` profile to match. Do not create a duplicate record, profile, or task. Confirm in one line: "Updated [Name]'s record — [what changed]."

**If the contact is NEW:** continue.

**If the CRM is unreachable:** do the vault side now and queue the CRM side (`bin/harold file crm`, see Step 5). Never skip the record because the CRM is down.

---

## Step 2 — Classify

### Type (exactly one)

Every contact has **exactly one type**, chosen from **your own short list**. Define the list once in `memory/CLAUDE.md` and keep it short (five or so). The CRM stores it in the `category` column. An example list:

| Type | Indicators |
|------|------------|
| **investor** | Deploys capital: VC, angel, family office, fund, PE |
| **partner** | Ongoing collaboration: co-delivery, channel, program partner, chamber of commerce, trade or economic-development office, government counterpart |
| **founder** | Runs or is starting a company, whatever else they are |
| **team** | Your own colleagues |
| **other** | Advisor, introducer, prospect, general business contact |

- **Unclear between partner and other:** default to **other** unless there is an explicit ongoing collaboration or formal program.
- **Truly ambiguous:** ask one closed question: "Quick check: is [Name] at [Org] an investor, partner, founder, or general contact?"
- Replace the list with yours. The rule that stays: one type per contact.

### Labels (any number, or none)

Anything else worth tagging is a **label**, stored separately: e.g. `board`, `advisor`, `press`, `customer-prospect`. **A label never duplicates the type** (no `investor` label on an investor).

### Warmth (a judgment about closeness)

`Hot`, `Warm`, `Lukewarm`, `Cold`, or **unset**. Warmth is independent of type. Freshness (days since last contact) is measured separately by the CRM, so don't encode recency into warmth.
- A new cold contact: `Cold`. A warm intro: `Lukewarm` or `Warm`. Not yet assessed: leave it **unset**.
- It drives nudges when the contact isn't in the pipeline: Hot 7 days, Warm 14, Lukewarm 28. Cold and unset get no nudges.

### Pipeline (only when a conversation establishes a purpose)

A contact record is **not** a pipeline entry. There is **one pipeline**. Add someone only when a conversation establishes **why** they're in it, and record that purpose: "Raising the seed round", "First design partner", "Hiring a head of sales".

- Stages: Identified · Reached Out · In Conversation · Advancing · Committed · Active · Dormant.
- `crm_pipeline` / `harold_pipeline` with `add`, the purpose (required) and a stage; link a project slug from `harold/projects.md` when the entry belongs to one.
- Someone in play for two reasons gets two entries.
- **Never auto-place a contact in the pipeline.** A stage is a claim about where the relationship actually stands. Set it when the conversation establishes it, `move` it when that changes, `close` it when it ends.

### Priority (High / Medium / Low)

High **only** if (a) it is explicitly marked high in a source you trust, or (b) you are actively working with them right now. **Don't guess.** Otherwise Medium.

### Status (active / pending / cold)

- **active** — live dialogue, a scheduled meeting, or an open outreach task. Your own team members are usually active.
- **pending** — in the system but not yet contacted, or awaiting a reply, or on hold.
- **cold** — went dark: outreach finished with no reply, or 60+ days dormant.
- **If unsure: pending.**

---

## Step 3 — Check for exceptions (before any CRM action)

If the frontmatter says **`crm: none`**, the person is deliberately out of the CRM: vault profile only, no CRM calls.

If the optional `HAROLD_NO_LOG_TYPES` setting lists the contact's type (see "CRM Filing Protocol" in `AGENTS.md`; off by default, and some people use it for their own team), keep the **record** current with `crm_upsert_contact` / `harold_upsert_contact` but never log an interaction with them.

---

## Step 4 — The cascade

All of these, together, for every new contact:

1. **`crm_upsert_contact` / `harold_upsert_contact`** — name, company, role, type (`category`), labels, warmth (or unset), status, priority, plus whatever is known: email, location, what they work on, how you met, notes.
2. **`vault/people/<Name>.md`** from `vault/templates/person.md`, frontmatter:
   ```yaml
   tags: [person]
   type: other          # exactly one, from your list
   labels: []           # e.g. [advisor]
   company: Acme Corp
   role: Head of Partnerships
   warmth:              # Hot | Warm | Lukewarm | Cold | blank
   status: pending
   crm: yes             # or none
   last_updated: YYYY-MM-DD
   ```
   Body: context (how you know them, intro path), timeline, and `[[wiki-links]]` to their company card, the introducer, and any project card.
3. **`harold/facts.md`** — add to the contacts section for their type (and Terminology if the name is easy to misspell).
4. **Follow-up tracking** if there is a next step: a task in the task manager (Linear by default) under the right project, plus `crm_task` / `harold_crm_task` for the contact-specific reminder. Due within 3 business days for high priority, 7 for medium.
5. **Pipeline entry** only if Step 2 says one exists.

### Additions by type (adapt to your list)

- **investor** — record firm and investor style (VC / angel / family office / PE) in notes. If you run a raise, add them to that project's tracker (`bin/harold where <raise>`) and let the raise's own playbook take over research and outreach. Run `playbook/core/analyst.md`: does their portfolio, thesis or network create an angle? Surface them in the next morning brief's pipeline health if they're in the pipeline.
- **partner** — add a label when it helps you find them later (e.g. `government` for trade offices and public bodies, `advisor` for someone who also advises you). If they're tied to a project, update that project's card or README. Run the analyst playbook: any recent news about their organization or region?
- **founder** — record what the company does. Create or link a `vault/companies/` card if the company matters. Pipeline only if something is in motion (an investment, a partnership, a piece of work). Analyst playbook: what does this company change about anything you're doing?
- **team** — update `dashboard/people.md` if they change operational context (new role, new reporting line). Onboarding checklist task if needed.
- **other** — default warmth `Cold` or unset, status `pending`. **Watch for reclassification:** if investor, partner or founder context appears later, change the type with `crm_upsert_contact` / `harold_upsert_contact` and run that type's additions.

**Downstream triggers:** a meeting mentioned or imminent → queue meeting prep; a meeting just happened → `playbook/core/meeting-debrief.md`.

---

## Step 5 — If the CRM is unreachable

Queue each CRM action (the payload uses `crm_upsert_contact` / `harold_upsert_contact`'s field names: `org`, `category` for the type, `categories` for labels). `bin/harold boot` and `bin/harold close` apply the queue automatically the next time they run with the CRM reachable, skipping anything already applied; `bin/harold replay` does it on demand (`--dry-run` to preview):
```bash
bin/harold file crm '{"contact":"Jane Doe","action":"upsert_contact","payload":{"org":"Acme Corp","category":"partner","categories":["advisor"],"status":"pending"}}'
bin/harold file crm '{"contact":"Jane Doe","action":"crm_task","payload":{"title":"Initial outreach: Jane Doe (Acme Corp)","due_date":"YYYY-MM-DD"}}'
```
The vault profile is written now regardless.

---

## Data capture template

```
Name:        [full name, correct spelling]
Company:     [organization]
Role:        [title, if known]
Type:        [exactly one, from your list]
Labels:      [any number, or none]
Location:    [city, country, if relevant]
Email/Phone: [if provided]
Warmth:      [Hot / Warm / Lukewarm / Cold, or blank if not assessed]
Priority:    [High / Medium / Low]
Status:      [active / pending / cold]
Pipeline:    [purpose + stage, or none]
Notes:       [how introduced, what was discussed, commitments]
Source:      [meeting, email, intro, research]
Date added:  [today, from bin/harold boot, never inferred]
```

**If data is missing:** file what you have. A record with a name, company and source beats no record. Leave unknown fields blank (never guess warmth or priority) and ask at most one question.

---

## Spelling and accuracy

1. Re-run the duplicate check if the spelling is uncertain (variants hide duplicates).
2. Verify uncertain spellings: ask the operator or look it up.
3. Confirm the organization's exact name.
4. Add easily-misspelled names to the Terminology section of `harold/facts.md`.

---

## Example flows

### New investor
**Operator:** "Good call with Jane Doe from Globex Ventures. She liked the pilot data."
1. Duplicate check: not found.
2. Type `investor`; warmth `Warm` (a good first call); status `active`; priority Medium unless you're actively working the raise with her.
3. CRM record + vault profile + facts entry + follow-up task.
4. Pipeline: only if the call established a purpose ("considering the seed round") — then `crm_pipeline add` / `harold_pipeline add` with that purpose, stage In Conversation.
5. Confirm: "Added Jane Doe (Globex Ventures) as investor, Warm. Follow-up task created. Pipeline: Raising the seed round, In Conversation."

### Trade-office partner
**Operator:** "Got a reply from Sam Lee at the regional trade office."
1. Duplicate check.
2. Type `partner`, label `government`.
3. Cascade. Pipeline only if you're actually working something with them; otherwise the record is enough.

### Ambiguous
**Operator:** "Met someone at the conference who runs a consulting firm."
Ask: "Is he a potential partner, or a general contact to track? (So I file him correctly.)" Get the name if you don't have it.

### Existing contact, new fact
**Operator:** "Jane Doe moved to Acme Corp."
Duplicate check finds her → `crm_upsert_contact` / `harold_upsert_contact` (company), update the vault profile and its `last_updated`. Confirm: "Updated Jane Doe — company now Acme Corp."

---

## Completion checklist

- [ ] Duplicate check run (CRM, `bin/harold search`, task manager) before creating anything
- [ ] Exactly one type from your list; labels separate and not duplicating the type
- [ ] Warmth set only if assessed (else unset); status and priority by the rules above
- [ ] `crm: none` and `HAROLD_NO_LOG_TYPES` (if set) respected
- [ ] `crm_upsert_contact` / `harold_upsert_contact` done (or queued with `bin/harold file crm`)
- [ ] `vault/people/<Name>.md` created/updated with full frontmatter and `last_updated`
- [ ] `harold/facts.md` updated
- [ ] Follow-up task + `crm_task` / `harold_crm_task` if there's a next step
- [ ] Pipeline entry only if a conversation established its purpose
- [ ] Downstream playbooks queued (analyst, meeting prep/debrief)
- [ ] Line added to today's `vault/daily/YYYY-MM-DD-<slug>.md`
