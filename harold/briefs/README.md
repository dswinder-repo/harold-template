# Morning brief drafts

Optional. If you turn on the scheduled morning brief, one file per weekday lands here as `YYYY-MM-DD.md` (the date in your time zone): Steps 1 and 2 of `playbook/core/morning-brief.md`, written before you sit down. Step 3 happens live with you.

| Piece | What it does |
|---|---|
| `.github/workflows/morning-brief.yml` | Wakes every hour on GitHub's machines and asks `bin/harold brief start` whether the brief is due. Set the repository variables `HAROLD_TZ` and `HAROLD_BRIEF_TIME` (default 06:30) to your zone and time. |
| `bin/harold brief start` | The gate: due only on a weekday in `HAROLD_TZ`, at or after `HAROLD_BRIEF_TIME`, when today's file does not exist yet. Otherwise it prints one `NOT DUE` line and exits 0. `--force` overrides it. |
| `harold/brief-prompt.md` | What the model does: Steps 1-2, then `bin/harold brief finish`. The same prompt works as a Claude Code routine on its own schedule. |
| `bin/harold brief finish` | Validates the file, stamps when the job fired and finished, commits only the brief paths and pushes. |
| `bin/harold brief status` | Where today's draft is and whether the brief is due right now. |
| `bin/harold boot` | Prints "Today's morning brief draft": READY (here), READY on origin (pull first), or NONE. On "good morning", Harold shows the draft instead of re-running Steps 1-2 (`playbook/core/morning-brief.md`, Step 0). |
| `housekeeping-notes.md` | Created when needed. Unattended jobs leave one-line notes under `## New`; the next brief shows them once and moves them under `## Shown`. |

Nothing here depends on a particular computer being on.
