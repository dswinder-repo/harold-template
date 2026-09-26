# Harold Dashboard — Module Router

> The entry point for the dashboard. **Read `status.md` first**, then load the module your task needs. `AGENTS.md` has every session read this file and `status.md` after boot.

---

## Module Load Order

| Priority | Module | What It Contains | When to Load |
|----------|--------|------------------|--------------|
| **1** | `dashboard/status.md` | Active projects, deadlines, open loops, recent activity | **Always**: start here |
| **2** | `dashboard/processes.md` | The Context Engine (what you say → which playbook fires), operating rules, time triggers | **Always**: the operating manual |
| **3** | `dashboard/people.md` | Your role, key relationships, how inputs are processed | When processing people, notes or documents |
| **4** | `dashboard/strategy.md` | Positioning, key numbers, brief format | When doing briefs, strategy or numbers |

---

## Playbook Cross-References

Playbooks live in `playbook/`, not in the dashboard. The full index is `playbook/README.md`; the trigger map is the Context Engine in `dashboard/processes.md`.

| Trigger | Playbook |
|---------|----------|
| Good morning / start of day | `playbook/core/morning-brief.md` (3-step sequence, follow exactly) |
| New intel surfaces | `playbook/core/analyst.md` |
| Before any output | `playbook/core/pre-flight-verification.md` |
| A meeting just happened | `playbook/core/meeting-debrief.md` |
| A new name with business context | `playbook/core/contact-intake.md` |
| A project the map does not know | `playbook/core/project-intake.md` |
| An event is coming up | `playbook/core/event-prep.md` |
| Something is stuck | `playbook/core/blocker-escalation.md` |
| Raw sources waiting | `playbook/core/compile.md` |
| Writing content | `playbook/core/content-production.md` |
| A document is going out | `playbook/core/document-qc.md` |
| Knowledge-base audit | `playbook/core/knowledge-base-health.md` |
| Choosing a model tier | `playbook/core/model-routing.md` |
| Shipping code | `playbook/core/ship-to-github.md`, `playbook/core/preview-deploys.md` |
| Live session dashboard | `playbook/core/expedition-hq.md` |

---

## MCP Tools

| Server | Purpose | Config |
|--------|---------|--------|
| `harold-mcp` | CRM (contacts, labels, pipeline, interactions, tasks, cadence) + alerts engine + atomic writes to the `harold/` markdown files | `.mcp.json` → `bin/harold-mcp` → `tools/harold-mcp/server.js`, credentials from `~/.harold/env` |

> **Prefer MCP tools over hand edits** for the files they own (facts, alerts, blockers, events). They keep the formats boot depends on.
>
> **Data source hierarchy:** CRM (relationships) → task manager (tasks and due dates) → markdown (events, blockers, facts). Each system owns its domain; nothing is duplicated by hand.

---

## Quick Navigation

- **"What's happening right now?"** → `dashboard/status.md`
- **"How does Harold operate?"** → `dashboard/processes.md`
- **"Who's who?"** → `dashboard/people.md`, then the CRM and `vault/people/`
- **"What are the numbers?"** → `dashboard/strategy.md` and `harold/facts.md`
- **"Where does project X live?"** → `bin/harold where X`
- **"What do we know about Y?"** → `bin/harold search "Y"`
