# Playbook: Status

**Purpose:** Give the operator a concise dashboard summary: projects, quiet projects, flags, stale relationships and upcoming deadlines.
**Trigger:** "status", "what's happening", "where are we", "dashboard", "/status".

Advice only: this playbook writes nothing.

---

**Sequence:**
1. Read `dashboard/status.md`, `harold/alerts.md` and `harold/blockers.md`.
2. Check for stale relationships with the CRM tool: `crm_stale` on the connector, `harold_cadence_check` on harold-mcp (the same rule).
3. Check which projects have gone quiet: `bin/harold pulse` (`harold_pulse` on the connector, the same answer).
4. Present a concise summary: project status, quiet projects with their next step, flags, stale relationships, upcoming deadlines.

**If data is missing:** with no CRM tool, say stale relationships were not checked; if `harold/alerts.md` is more than a day old, say so (its rebuild is a scheduled trigger).

---

## Completion checklist

- [ ] `dashboard/status.md`, `harold/alerts.md` and `harold/blockers.md` read
- [ ] Stale relationships and quiet projects checked (or the gap stated)
- [ ] Concise summary presented
