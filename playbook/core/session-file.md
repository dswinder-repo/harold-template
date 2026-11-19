# Playbook: Session File

**Purpose:** Keep this session's file in `harold/active-sessions/` current so the live Expedition HQ visualizer shows what is happening.
**Trigger:** Every session, every turn: boot creates the file, the first tool call of each user message updates it, close puts it to sleep.

`AGENTS.md` keeps the short form of this rule. This playbook holds the schema and the full protocol.

---

## The session file

Every session has a file in `harold/active-sessions/` so it appears in the live Expedition HQ visualizer (`tools/visualizer/`). `bin/harold boot` creates it for you (`session-<date>-<time>-<id>.json`) and prints its path. If boot did not run in this harness, create one yourself, named with a kebab-case slug of the task (e.g. `client-proposal.json`), using the schema below with every activity `"sleeping"`.

Then set whichever activity you're starting with to `"working"` with a `"task"`, `"progress"` (0-100) and `"started"` (ISO timestamp).

## Update protocol

The visualizer polls every few seconds but only shows what's in the file.

- **At the START of processing every user message**, set the right activity to `"working"` with a current `"task"` and `"progress"`, and the others to `"sleeping"`. Make it your first tool call of the turn.
- **At the END of processing every user message**, set all activities back to `"sleeping"` (`bin/harold close` does this for you; where close does not run, your last tool call does it). Keep `"session": true` and `"task"`.
- **Also update** when finishing a major phase or starting a new type of work, and when the session ends (`"session": false`, all `"sleeping"`; `bin/harold close --final` does this).

---

## Schema

```json
{
  "session": true,
  "task": "High-level task description",
  "activities": {
    "research": { "status": "working", "task": "What the agent is doing", "progress": 50, "started": "ISO-timestamp" },
    "strategy": { "status": "sleeping" },
    "writing":  { "status": "sleeping" },
    "coding":   { "status": "sleeping" },
    "data":     { "status": "sleeping" },
    "comms":    { "status": "sleeping" },
    "design":   { "status": "sleeping" },
    "ops":      { "status": "sleeping" }
  }
}
```

**Activity categories (8):**
| Category | Agent | Description |
|----------|-------|-------------|
| `research` | ARCHIE | Searches, file reads, web lookups, knowledge-base queries |
| `strategy` | COMPASS | Planning, prioritizing, analysis, decision support |
| `writing` | QUILL | Drafting content, prompts, documents |
| `coding` | BYTE | Backend logic, APIs, data structures, algorithms, non-visual code |
| `data` | LEDGER | Data analysis, audits, diagnostics, metrics, financial data, research synthesis |
| `comms` | MERCURY | CRM interactions, outreach, messaging, drafting emails to external contacts |
| `design` | SKETCH | Frontend/UI code, CSS, visual design, layouts, HTML templates |
| `ops` | GEARS | File management, deployments, git operations, config, maintenance |

**Activity selection:** when work spans categories, pick the one that best describes the *primary* output. Frontend/UI code is `design`, not `coding`. Analyzing data or auditing systems is `data`, not `research` (research *finds* information, data *analyzes* it). Messages to external people are `comms`, not `writing`.

**Optional field:** `"artifact": "/absolute/path/to/output/file"` — the main output this session is producing, recorded for whoever reads the file. The starter's Expedition HQ page does not display it.

**Cleanup:** `bin/harold boot` and `close` move session files older than 48 hours to `harold/active-sessions/archive/`, so a stuck `"session": true` never shows as live forever. Ended sessions older than 2 hours are hidden by the visualizer.

**If data is missing:** a session file that cannot be found or parsed is recreated from the schema above; never block the operator's work on it. Keep updates lightweight.

---

## Completion checklist

- [ ] The session file exists in `harold/active-sessions/` (boot creates it)
- [ ] It was updated first thing on every user message, with the working activity, task and progress
- [ ] All activities are `"sleeping"` whenever the session is not running tool calls (`"session": true` kept until the session ends)
