# Playbook: Analyst

> **CRM tools.** Where a step names two tools (`crm_upsert_contact` / `harold_upsert_contact`), the first is the hosted connector's and the second harold-mcp's. Use whichever your harness has: they write the same database. A write made through the connector on a computer without CRM credentials is recorded with `bin/harold file crm '{...,"applied":"connector"}'` (see `AGENTS.md`, CRM Filing Protocol).

**Purpose:** Cross-reference new intel against the whole knowledge base and apply it to every file it touches.
**Trigger:** New intel from a morning brief, meeting, market data, news, strategy session or team update; "analyze this", "what does this mean for us", "implications", "/analyst".

**Don't just mention it. Apply it.**

---

## When to activate

Whenever any of these enter the system:
- **Morning brief intel** (the Step 1 analyst-mode 📌 callouts)
- **Meeting notes** (strategy sessions, partner debriefs, investor or customer calls)
- **Market data** (earnings, funding rounds, M&A, pricing moves)
- **External signals** (regulation, policy, competitor moves, partnership openings)
- **Team updates** (overnight messages, decisions, operational changes)

**Rule:** the moment you call something "relevant" or "worth noting", this playbook has fired.

---

## The process

### 1. Identify the insight
Name the signal precisely. Not "Acme Corp is using AI" but "Acme Corp moved its compliance review to an AI vendor — evidence that buyers in our segment will pay for agent-executed work."

### 2. Cross-reference against the full knowledge base

**Load `harold/projects.md` first.** The project map, not this table, defines which projects, people and competitors are in scope today. Then check the insight against every row:

| Domain | What to check | Where / tools |
|--------|---------------|---------------|
| **Active projects** | Every entry with `status: active`: its `keywords`, `people` and folder | `harold/projects.md`, `bin/harold where <topic>` |
| **Competitors** | The `competitors` line of each active entry | `harold/projects.md` |
| **Upcoming events and meetings** | Who are we meeting, and about what? Does this change the conversation? | `harold/events.md`, calendar, `crm_get_contact` / `harold_get_contact` |
| **Blockers** | Does this resolve, worsen, or create a blocker? | `harold/blockers.md` |
| **Key relationships** | Does it touch an active contact, a pipeline entry, or a target? | `crm_search_contacts` / `harold_search_contacts`, `crm_pipeline list` / `harold_pipeline list`, `bin/harold search "<name or company>"` |
| **Strategy and narrative** | Does it strengthen or weaken your positioning, fundraising story or pitch to partners? | `dashboard/strategy.md` |
| **Product / offering** | Roadmap, priorities, pricing, competitive position | the relevant project folder |
| **Policy watchlist** | [YOUR POLICY WATCHLIST] (e.g. trade, tax, immigration, sector regulation) | `dashboard/strategy.md` |
| **Geographic focus** | [YOUR REGIONS] | `crm_search_contacts` / `harold_search_contacts` by region |
| **Current priorities** | Does it change what matters this week? | `memory/CLAUDE.md` |
| **Personal context** | Location, travel, commitments the operator has told Harold about | `memory/CLAUDE.md` |

- *If the project map is missing or empty:* say so, run the rest of the table, and suggest `playbook/core/project-intake.md` for the work the intel touches.
- *If the CRM is unreachable:* use `bin/harold search` over `vault/people/` and `vault/companies/` instead, and note the gap.

### 3. Apply the insight
For each real connection, update the file or system it touches:

| Where it's relevant | What to update | CRM action |
|---------------------|----------------|------------|
| An upcoming meeting | Add a "Current events — talking points" section to the meeting prep | `crm_task` / `harold_crm_task` → "Mention [intel] to [contact]" if actionable |
| Investor / buyer conversations | Talking points or objection handling in the project folder | `crm_task` / `harold_crm_task` → "Reference [intel] in next touch with [contact]" if relevant |
| Strategy | Positioning, messaging or competitive analysis in `dashboard/strategy.md` or the project folder | — |
| Product / roadmap | Flag it to whoever owns the roadmap (a task in the task manager, Linear by default) | — |
| A contact's situation changed (they raised, moved, got promoted) | Their `vault/people/` profile (`last_updated`) | `crm_upsert_contact` / `harold_upsert_contact` → notes, maybe warmth |
| A company changed | `vault/companies/<Company>.md` | — |
| A blocker | `harold/blockers.md` (resolve, update, or add) | — |
| A date or deadline | `harold/events.md` | — |
| Durable facts or numbers | `harold/facts.md` | — |
| Current priorities | `memory/CLAUDE.md` | — |
| How a process should run | the relevant playbook | — |

Applying intel is not a conversation: never log a CRM interaction for it. To pass intel on to a colleague, use a task.

### 4. Log the application
Append to today's `vault/daily/YYYY-MM-DD-<slug>.md` (or `bin/harold file daily <slug> "<text>"`):

```
## Analyst intel applied — [source]
**Trigger:** [what surfaced it]

**Insights applied:**
1. [Insight] → [file/location] — [what was added or changed]
2. [Insight] → [file/location] — [what was added or changed]
```

**Durable insights** (still relevant beyond this week): also create `vault/intel/<topic-slug>.md` from `vault/templates/intel.md`, with `[[wiki-links]]` to the projects, people and companies it touches, so it's findable with `bin/harold search`.

---

## Quality standards

- **Don't force it.** Apply only where the connection is real and actionable.
- **Look for second-order effects.** "A new trade bloc forms" → exporters in that bloc need new compliance help → that's a service line → relevant to partner conversations next week.
- **Think like a strategist, not a librarian.** The goal is surfacing angles, risks, opportunities and urgency the operator can act on, not filing information.
- **Preserve voice.** Talking points should be things the operator would actually say, not academic analysis.
- **Be specific.** "Relevant to the raise" is useless. "Use this as a proof point when investors ask about reliability" is actionable.
- **High stakes, second opinion.** For investor materials, public writing or strategic decisions, fact-check key claims against the source (or a second model) before they go into a file.

---

## Integration with the morning brief

The 📌 callouts in the morning brief are the output of this playbook's steps 1-2. The brief is only the surface; the real work is updating the files so the insight persists.

After Step 1 of the brief:
- Apply every callout the operator confirms as relevant (step 3).
- Log all applications in today's daily note (step 4).
- If an insight creates work, create the task in the task manager.

---

## Completion checklist

- [ ] Insight stated specifically (signal + why it matters)
- [ ] `harold/projects.md` loaded; every active project's keywords, people and competitors checked
- [ ] Events, blockers, relationships/pipeline, strategy and priorities checked
- [ ] Every real connection applied to its file (and CRM where relevant); nothing forced
- [ ] Tasks created for any work the insight creates
- [ ] Application logged in today's `vault/daily/` note
- [ ] `vault/intel/` note created if the insight is durable
- [ ] Gaps (missing map, unreachable CRM) stated, not skipped silently
