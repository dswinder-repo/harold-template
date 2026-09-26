# Playbook: Project Intake

**Purpose:** Give every new project a folder, a `harold/projects.md` entry and a vault card so sessions can find it.
**Trigger:** Runs passively whenever the operator mentions a project, client, engagement, venture or workstream that `bin/harold where` cannot resolve.

**This playbook runs automatically.** People rarely announce a new project; they just start working on it. Without an intake, new work gets no folder, no map entry and no card, and every later session has to be told where things live. Contacts have `contact-intake.md`; this is its twin for projects.

---

## Trigger (passive detection)

Watch every message for a body of work that will produce files and needs a home:
- A new client, employer or engagement ("I'm doing some work for…", "they want a proposal on…")
- A new venture, product or experiment ("I want to try…", "thinking about launching…")
- A new workstream inside an existing engagement ("my manager wants us to look at…")
- A deliverable that fits no existing folder (a memo, model, deck or tool for something unmapped)
- A name the operator uses for a project that `bin/harold where` cannot resolve

**Not triggered by:**
- A one-off question with no follow-on work
- Personal topics with no work output
- Anything that resolves to an existing map entry (that's an update, not an intake)

---

## Step 1 — Existing check (MANDATORY, before creating anything)

1. **`bin/harold where "<what the operator called it>"`** — the project map is the primary check.
2. Search `harold/projects.md` for the folder, keywords and linked people.
3. Look in `vault/projects/` for a card.
4. Check the top-level folders on disk for an obvious match.

**If the project EXISTS:** update, don't duplicate.
- Work in its folder.
- If the operator used a name the map doesn't list, add it to the entry's `aliases` line.
- If their words imply a status change (paused, archived, revived), update `status`.
- Do NOT create a second folder or card. Confirm in one line: "Filed under [Project] — added alias '[name]'." Otherwise say nothing about intake.

**If the project is NEW:** continue.

---

## Step 2 — Classify

### Type
| Type | Indicators |
|------|------------|
| **employer** | The operator holds a role there. Rare. |
| **client** | Someone is paying, or may pay, for a deliverable (proposal, engagement, retainer) |
| **venture** | Something the operator owns and is building to earn (a company, product, agency) |
| **workstream** | A body of work inside an engagement, or a career/revenue lane (a sub-project, a job-search lane) |
| **personal** | Side project, experiment, family; no revenue intent |
| **tool** | Software the operator or Harold runs (a dashboard, an MCP server, a test harness) |

- **Unclear between client and workstream:** default to **workstream** until money or a counterparty is named.
- **Truly ambiguous:** ask one closed question: "Is [X] its own thing, or part of [nearest existing project]?" Never ask the operator to describe the architecture of their work.

### Parent
- Inside an existing engagement → the folder goes **under the parent's folder**, and the map entry names the parent in `notes`.
- Otherwise → a top-level folder. Follow the naming convention your workspace already uses (e.g. `company/seed-round`, or `snake_case` at the top level). Be consistent.

### Status
- **active** — work is happening now (the default for anything just raised)
- **paused** — on hold, waiting, "later"
- **archived** — ended. **Ending a project = `status: archived`.** Nothing else changes: folder, card and history stay.

---

## Step 3 — The cascade

1. **Create the folder** at the resolved path. If the parent uses numbered subfolders (e.g. `00_strategy`, `01_research`, `02_deliverables`), mirror only the ones needed now; don't scaffold empties. Add a `README.md` with: purpose (one paragraph), a status line with today's date, and any isolation rule (e.g. "this workstream never touches the task manager or the CRM").

2. **Add the map entry** to `harold/projects.md`, exactly this shape:
   ```
   ## Seed Round
   - folder: company/seed-round
   - status: active
   - type: workstream
   - aliases: the raise, the round, fundraise
   - keywords: investor, term sheet, data room
   - people: [[Jane Doe]], [[Sam Lee]]
   - card: vault/projects/seed-round.md
   ```
   - `status`: `active` | `paused` | `archived`
   - `type`: `employer` | `client` | `venture` | `workstream` | `personal` | `tool`
   - `aliases`: what the operator actually said first, then other names they're likely to use
   - `keywords`: names, organizations, products and places that will signal this project in conversation
   - Optional lines: `routes` (subfolder → purpose), `competitors` (read by the analyst playbook), `notes` (parent, isolation rule, binding lessons)
   - **Verify:** `bin/harold where "<name>"` resolves to the new entry. If it doesn't, fix the entry before moving on.

3. **Create the vault card** `vault/projects/<slug>.md` (from `vault/templates/project.md` if you have one; otherwise this shape):
   ```yaml
   ---
   tags: [project]
   status: active
   type: workstream
   started: YYYY-MM
   folder: company/seed-round
   owner: [YOUR NAME]
   ---
   ```
   Body: one-paragraph description; a **Project home** line pointing at the folder; the goal in one line; Key Links; a Status Log (dated, newest first); `[[wiki-links]]` to every person and company already in the vault that this project touches.

4. **Cross-link.** For each linked person or company card, add `[[<project-slug>]]` to its `## Related` section. If a decision note in `vault/decisions/` created the project, link both ways.

5. **Scope lessons.** If the operator's words include a correction or constraint specific to this project, record it now so future sessions inherit it:
   ```bash
   bin/harold file learning '{"severity":"warning","project":"<slug>","category":"scope","lesson":"..."}'
   ```

6. **Downstream playbooks:**
   - New people named → `playbook/core/contact-intake.md` for each.
   - New intel about the domain → `playbook/core/analyst.md` (it reads the project map, so the new project is in scope automatically).
   - A deliverable was requested → produce it **in the new folder, in the same turn**. Intake is never a separate step from the work.

7. **Log** in today's `vault/daily/YYYY-MM-DD-<slug>.md`: "Project intake: [name] → [folder], card, map entry."

---

## Data capture template

```
Name:        [what the operator calls it — the first alias]
Type:        [employer / client / venture / workstream / personal / tool]
Parent:      [existing project, or none]
Folder:      [path]
Status:      [active / paused / archived]
Counterparty/owner: [who's on the other side, if anyone]
Goal:        [one line]
People:      [[...]], [[...]]
Competitors: [optional]
Isolation:   [if this must not touch the task manager or CRM, say so]
Source:      [what the operator said, close to verbatim, to keep their vocabulary]
Date:        [today, from bin/harold boot, never inferred]
```

**If data is missing:** create the entry with what is known and `TODO` on unknown fields (e.g. `aliases: the round — TODO`). A thin entry that resolves beats a perfect entry that never gets written.

---

## Example flows

### New client
**Operator:** "Acme Corp wants a two-page proposal on automating their invoice processing. Can you draft it?"
1. `bin/harold where "Acme invoice"` → no match. New.
2. Type `client`. Parent: if a consulting practice entry exists, it goes under that folder (e.g. `consulting/clients/acme-corp/`); otherwise top level.
3. Folder + README, map entry, vault card, cross-link to any named person (contact-intake runs for them).
4. Draft the proposal into the new folder, this turn.
5. Confirm in one line: "Filed as a client under Consulting → `consulting/clients/acme-corp/`. Proposal draft below."

### Alias for an existing project
**Operator:** "How's the data-center thing looking?"
1. `bin/harold where "data-center thing"` → matches an existing entry by keyword.
2. Add "the data-center thing" to its `aliases`. Answer from the folder and card. Say nothing about intake.

### Project ends
**Operator:** "I'm wrapping up with Globex at the end of the month."
Set `status: paused` now with a note ("ends [date] per operator"); at month end set `status: archived`. Nothing deleted, nothing moved.

---

## Completion checklist

- [ ] Existing check run (`bin/harold where`, `harold/projects.md`, `vault/projects/`, disk) before creating anything
- [ ] Folder exists with `README.md` (purpose, dated status, isolation rule if any)
- [ ] `harold/projects.md` entry in the standard format; `bin/harold where "<name>"` resolves to it
- [ ] `vault/projects/<slug>.md` exists with frontmatter and a Project home line
- [ ] Every person/company card it touches links back
- [ ] Project-specific lessons filed with `bin/harold file learning`
- [ ] Any requested deliverable is in the folder, not only in chat
- [ ] Line written in today's `vault/daily/` note
