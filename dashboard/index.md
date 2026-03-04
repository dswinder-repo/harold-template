# Harold Dashboard — Module Router

> This is the entry point. The dashboard is split into focused modules.
> **Read `status.md` first**, then load the module relevant to your task.

---

## Module Load Order

| Priority | Module | What It Contains | When to Load |
|----------|--------|-----------------|--------------|
| **1** | `dashboard/status.md` | Active projects, deadlines, recent activity | **Always** — start here |
| **2** | `dashboard/processes.md` | Operating rules, task management, handoff protocols | **Always** — operating manual |
| **3** | `dashboard/people.md` | Roles, contacts, org structure | When processing people or communications |
| **4** | `dashboard/strategy.md` | Strategic context, financials, positioning | When doing briefs or strategy work |

---

## Playbook Cross-References

**These workflows live in `playbook/` — load them when triggered:**

| Trigger | Playbook |
|---------|----------|
| Morning brief / "gm" / "daily brief" | `playbook/morning-brief.md` |
| New intel surfaces | `playbook/analyst.md` |
| Before ANY output | `playbook/pre-flight-verification.md` |
| Post-meeting | `playbook/meeting-debrief.md` |
| New contact mentioned | `playbook/contact-intake.md` |
| Knowledge base audit | `playbook/knowledge-base-health.md` |
| System cleanup | `playbook/hygiene.md` |

*Add your own playbooks here as you build them.*

---

## MCP Tools

| Tool Server | Purpose | Config |
|-------------|---------|--------|
| `harold-mcp` | Atomic KB writes, alerts engine, CRM integration | `.mcp.json` → `tools/harold-mcp/server.js` |

> **Prefer MCP tools over manual file edits** where available. They handle formatting, deduplication, and survive context compaction.

---

## Quick Navigation

- **"What's happening right now?"** → `dashboard/status.md`
- **"How does Harold operate?"** → `dashboard/processes.md`
- **"Who's who?"** → `dashboard/people.md`
- **"What's the strategy?"** → `dashboard/strategy.md`
- **"What's the morning routine?"** → `playbook/morning-brief.md`
