# Harold Proactive Alerts

*A derived view. Nothing originates here: every alert traces back to a source file (`harold/blockers.md`, `harold/events.md`), the CRM, or the task manager. Harold rebuilds the Current Alerts section from those sources whenever it is more than a day old (`bin/harold boot` reports it as due work, trigger id `alerts-rebuild`).*

*Formats this file must keep, because tools read them by heading: boot reads the date in the footer line (Month D, YYYY) and prints the Current Alerts section into every session; the `harold_alert` MCP tool adds rows to the three severity tables under Current Alerts and moves resolved alerts to the Alert History table. Keep each of those headings exactly once in this file.*

---

## Current Alerts

*Rebuilt from: blockers.md, events.md, task manager. Delete the example rows once you have real alerts.*

### 🔴 URGENT

| Alert | Context | Suggested Action |
|-------|---------|------------------|
| **Example: blocker B001 aging** | Example row from the starter. Waiting on a signed NDA from Acme Corp. | Delete this row when you rebuild alerts for the first time. |

### 🟠 WARNING

| Alert | Context | Suggested Action |
|-------|---------|------------------|

### 🟡 WATCH

| Alert | Context | Suggested Action |
|-------|---------|------------------|

---

## Alert Rules

**URGENT (surface immediately)**
- Blocker aged more than 7 days with no update
- Task due today, status "Not Started"
- Event less than 3 days away with prep not complete

**WARNING (surface in the brief)**
- Blocker aged 3 to 7 days
- Task due in less than 3 days, status "Not Started"
- Event less than 10 days away with prep not complete
- Event ended in the last 3 days with no debrief

**WATCH (mention if relevant)**
- Blocker aged more than 14 days (close it or escalate it)
- Task due this week, not started
- A relationship rated Lukewarm or warmer going stale (see the CRM cadence thresholds)

---

## Alert History

| Date | Alert | Resolution |
|------|-------|------------|

---

## How Harold Uses This File

1. At session start, `bin/harold boot` prints Current Alerts and says whether this file is stale.
2. If it is stale, rebuild Current Alerts from source: `harold/blockers.md`, `harold/events.md`, the task manager, the quiet projects under WATCH (`bin/harold pulse`), and, when a CRM tool is available, stale relationships under WATCH (`crm_stale` on the connector, `harold_cadence_check` or `harold_alerts_sync` on harold-mcp). Then update the footer date and record it: `bin/harold file trigger alerts-rebuild ran "<what you rebuilt from>"`.
3. Surface every URGENT and WARNING item unprompted, in the morning brief's flags section.
4. Move resolved alerts to Alert History.

---

*Last updated: never (starter template: example content only; the first rebuild writes the date here, as Month D, YYYY)*
