# Dashboard: People & Structure

*Who you are in this system, who matters, and how Harold turns raw input (notes, emails, documents) into filed knowledge.*

---

## Your Role

- **Name:** [YOUR NAME]
- **Role / title:** [YOUR ROLE] at [YOUR COMPANY] (or independent)
- **What you are accountable for:** [2-3 lines]
- **How you like to work:** [e.g. voice-first, short answers, drafts for review rather than sends]

---

## Your Contact Types

*Each contact in the CRM has exactly one type, from this list. Keep it short: if you are unsure which type someone is, you have too many. If there are types whose conversations you never want logged (some people choose this for their own team), list them in `HAROLD_NO_LOG_TYPES` (see "CRM Filing Protocol" in `AGENTS.md`).*

| Type | Who it covers |
|------|---------------|
| investor | [e.g. VCs, angels, family offices] |
| partner | [e.g. distribution, channel, ecosystem bodies] |
| founder | [e.g. founders you advise or peer with] |
| team | Your own colleagues |
| other | Everyone else worth knowing |

**Labels** add anything else worth seeing at a glance (e.g. `ecosystem`, `board`, `advisor`). Any number per contact; never a copy of the type.

---

## Key Relationships

*The people Harold should recognize instantly. Everyone else is in the CRM and `vault/people/`.*

| Name | Organization | Type | Why they matter |
|------|--------------|------|-----------------|
| Jane Doe (example) | Acme Corp | partner | Example row |

---

## Your Team

*Colleagues (type `team`).*

| Name | Role | Notes |
|------|------|-------|
| [Name] | [Role] | |

---

## Contact Intake (Passive, Always On)

A new name with business context (an organization, a title, a deal, a meeting, an intro) runs `playbook/core/contact-intake.md` without being asked: duplicate check first, then the vault card, the CRM record (one type, labels, warmth), and a pipeline entry only if the conversation established a purpose.

---

## Input Processing Protocol

When you paste or drop anything (notes, a transcript, an email, a document, an article):

1. **Save the raw source first** to `raw/<subfolder>/YYYY-MM-DD-<slug>.md` (or the original file).
2. **Identify what it is** and route it:
   - meeting notes or a transcript → `playbook/core/meeting-debrief.md`, then `playbook/core/analyst.md`
   - new names → `playbook/core/contact-intake.md` for each
   - intel (news, data, research) → `playbook/core/analyst.md`
   - a document going out → `playbook/core/document-qc.md`
3. **Mark the raw file compiled** (`compiled: true`, `compiled_date`, `compiled_to`).
4. **Confirm what was filed.** Don't ask "what should I do with this?": file it, then say where it went.

---

## Folder Structure

| Where | What |
|-------|------|
| `harold/` | Operational state: alerts, blockers, events, facts, the project map, lessons, session files |
| `memory/` | Working memory and glossary |
| `dashboard/` | These modules |
| `vault/` | Long-term knowledge: people, companies, projects, intel, decisions, meetings, daily notes |
| `raw/` | Inbox of unprocessed sources |
| `playbook/` | Procedures: `core/` goes everywhere with you, `engagements/<name>/` belongs to one employer or client |
| Project folders | Wherever `harold/projects.md` says (`bin/harold where <topic>`) |
