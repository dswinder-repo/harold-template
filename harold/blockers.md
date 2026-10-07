# Blockers

*Harold tracks anything stuck or waiting that is mentioned in conversation. Say "blocker: <description>" to add one, "resolved: B00X" to close one.*

*Format is machine-read by `bin/harold boot`: one row per blocker in the table below, ID like `B004` (plain, not bold), the Raised date in any of `Sep 26, 2026` / `2026-09-26` / `Sep 26`. Boot computes each blocker's age from Raised; a blocker older than 7 days makes `blocker-escalation:<ID>` due work (`playbook/core/blocker-escalation.md`). Everything in the Resolved section at the bottom is ignored by boot. (Boot finds that section by its heading, so do not write that heading anywhere else in this file.)*

---

## Current Blockers

| ID | Project | Blocker | Waiting On | Raised | Last Update |
|----|---------|---------|------------|--------|-------------|
| B001 | Example Project | Example (delete this row): mutual NDA not yet signed | Jane Doe (Acme Corp) | (example: no date) | Starter example row, undated so it never ages. Replace with your own blockers; a real row needs a Raised date. |

---

## Resolved

| ID | Project | Blocker | Resolution | Resolved |
|----|---------|---------|------------|----------|

---

*IDs are never reused. The next blocker is one higher than the highest ID in either table.*
