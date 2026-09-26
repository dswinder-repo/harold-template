# Event Tracker

*Structured event tracking for automatic prep and debrief. `bin/harold boot` reads the Upcoming Events table and makes `event-prep:<event>` due work when an event is less than 10 days out and its Prep Status is not `Complete` (`playbook/core/event-prep.md`).*

*Format is machine-read: the table must sit under the Upcoming Events heading below, with exactly these seven columns (boot finds it by that heading, so do not write the heading anywhere else in this file). Dates can be `Mar 12, 2027`, `2027-03-12` or a range like `May 3-6, 2027` (the start date counts). Prep Status is `Not Started`, `In Progress` or `Complete`. The `harold_event` MCP tool writes rows in this format.*

---

## How This Works

1. **Every boot:** days until each event are computed from the real date.
2. **Triggers:**
   - Event 10 days out or less, prep not Complete → WARNING, and event prep becomes due work
   - Event 3 days out or less, prep not Complete → URGENT
   - Event ended 3 days ago or less, debrief not done → WARNING
3. **Actions:** run `playbook/core/event-prep.md`; after the event, `playbook/core/meeting-debrief.md`.

---

## Upcoming Events

| Event | Dates | Project | Task | Prep Status | Debrief Due | Debrief Status |
|-------|-------|---------|------|-------------|-------------|----------------|
| **Example: Acme Corp partner summit (delete this row)** | Mar 12, 2027 | Example Project | — | Not Started | Mar 14, 2027 | — |

---

## Events Under Consideration

| Event | Dates | Why it might matter | Decision By |
|-------|-------|---------------------|-------------|

---

## Completed Events

| Event | Dates | Prep Status | Debrief Status | Notes |
|-------|-------|-------------|----------------|-------|
