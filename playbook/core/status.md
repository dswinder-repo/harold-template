# Playbook: Status

**Purpose:** Give the operator a concise dashboard summary: active projects, flags, stale relationships and upcoming deadlines.
**Trigger:** "status", "what's happening", "where are we", "dashboard", "/status".

Advice only: this playbook writes nothing.

---

**Sequence:**
1. Read `dashboard/status.md`, `harold/alerts.md` and `harold/blockers.md`.
2. Check for stale relationships with the CRM tool: `crm_stale` on the connector, `harold_cadence_check` on harold-mcp (the same rule).
3. Check which projects are active: `bin/harold pulse` (`harold_pulse` on the connector, the same answer). Active is derived from recent or upcoming activity; quiet projects are listed plainly, never nagged.
4. Present a concise summary: the active projects with their next step, the quiet ones on one line only if the operator asks, flags, stale relationships, upcoming deadlines.

**If data is missing:** with no CRM tool, say stale relationships were not checked; if `harold/alerts.md` is more than a day old, say so (its rebuild is a scheduled trigger).

---

## Completion checklist

- [ ] `dashboard/status.md`, `harold/alerts.md` and `harold/blockers.md` read
- [ ] Stale relationships and active projects checked (or the gap stated)
- [ ] Concise summary presented
