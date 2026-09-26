# Playbooks

Standard operating procedures: plain markdown files that say exactly how Harold runs a recurring workflow. Harold does **not** need exact trigger phrases: the Context Engine in `dashboard/processes.md` maps what you say to the right playbook, by meaning.

**Layout (location only):**
- `core/` — portable. How you operate anywhere; nothing here names an employer or client.
- `engagements/<name>/` — employer- or client-specific (see `engagements/example/README.md`). Ending an engagement means setting its project to `status: archived` in `harold/projects.md`; its playbooks stay where they are and stop firing, because the Context Engine only routes to active engagements. A new job gets a new folder, and nothing in `core/` needs editing.

**This index is machine-read.** `bin/harold boot` reads every playbook body under `playbook/` and refuses to start if one cannot be read. It warns when a playbook on disk is missing from this table, and refuses when this table lists a playbook that is not on disk. The first column must be the path relative to `playbook/`, in backticks, at the start of the row. If you add a playbook, add a row here and its trigger to `dashboard/processes.md`.

| Playbook | Purpose | Trigger |
|----------|---------|---------|
| `core/analyst.md` | Cross-reference new intel against the whole knowledge base and apply it to every file it touches. | New intel from a morning brief, meeting, market data, news, strategy session or team update; "analyze this", "what… |
| `core/blocker-escalation.md` | Move blockers that aren't resolving: flag, escalate by age, and force a decision before they rot. | Boot lists a blocker in `harold/blockers.md` older than 7 days (trigger id `blocker-escalation:<ID>`); "escalate… |
| `core/compile.md` | Turn raw sources in `raw/` into structured vault knowledge, or re-synthesize one topic from everything known. | "/compile", "compile", "process raw sources", "/compile [topic]", "recompile [topic]". Boot flags uncompiled `raw/`… |
| `core/contact-intake.md` | File a new or changed contact into the CRM, vault and tasks, with a duplicate check first. | Runs passively whenever a name with business significance appears; also "add [name] to the CRM", "met [name]", "new… |
| `core/content-production.md` | Turn an idea or hook into a published post, thread or newsletter in your own voice, then log how it did. | "Draft content on [topic]", "write a thread about [topic]", "newsletter draft on [topic]", or a news/intel sweep… |
| `core/document-qc.md` | Fact-check a final document before it leaves the building, and fix the knowledge base wherever it was wrong. | The operator signals a document is final: "this is final", "ready to send", "lock it in", "good to go", "send this… |
| `core/event-prep.md` | Prepare for events before they arrive, capture well on the day, and debrief afterwards so nothing is lost. | Boot lists an event in `harold/events.md` less than 10 days out with Prep Status not Complete (trigger id… |
| `core/expedition-hq.md` | Start the Expedition HQ live dashboard so you can watch every session's activity in a browser. | "Open Expedition HQ", "start the visualizer", "show me the dashboard", or at session start when live monitoring is… |
| `core/knowledge-base-health.md` | Keep the knowledge base accurate, consistent and fresh: a weekly quick scan and a monthly full audit. | Scheduled: every Friday (Quick Scan, `weekly-scan`), 1st of the month (Full Audit, `full-audit`). On demand: "run… |
| `core/meeting-debrief.md` | Capture a meeting's outcomes and file them into the CRM, vault, tasks and facts so nothing is lost. | "just finished [meeting]", "debrief [name]", "had a call with", "meeting notes", "here's the transcript", pasted… |
| `core/model-routing.md` | Route each task to the cheapest model tier that handles it well; save the top tier for work that needs it. | Consulted automatically on every request, and when writing priority prompts in the morning brief. The operator never… |
| `core/morning-brief.md` | Start the day in three guided steps: intel, then the brief and priorities, then ready-to-run prompts. | "good morning", "morning", "gm", "daily brief", "start the day", "let's go", or any morning greeting. |
| `core/pre-flight-verification.md` | Catch wrong names, dates, facts and filing before any output reaches the operator. | Before presenting any brief, research, email draft, meeting prep or filing decision; any output with names, dates,… |
| `core/preview-deploys.md` | Test every change on a preview link before it reaches production, and verify every deploy before calling it live. | Any change to a project that deploys (website, app, API, serverless function); "deploy this", "ship to prod", "is it… |
| `core/project-intake.md` | Give every new project a folder, a `harold/projects.md` entry and a vault card so sessions can find it. | Runs passively whenever the operator mentions a project, client, engagement, venture or workstream that `bin/harold… |
| `core/ship-to-github.md` | Commit, push and (for live projects) open a PR at the end of every coding session, without leaking secrets. | End of any coding session; "push this", "ship it", "commit and push"; starting a new project that needs a repo. |

## Rules for writing a playbook

- Start with `# Playbook: <Title>`, then `**Purpose:**` (one sentence; boot prints it) and `**Trigger:**`.
- Every step names the file it writes to. A step that says "update the relevant systems" is not a step.
- State what happens when data is missing.
- End with a completion checklist.
- A workflow earns a playbook after you have done it manually three times, not before.
- Playbooks that only produce advice and write nothing should say so at the top.
- Resolve project folders through `harold/projects.md` (`bin/harold where`), never by hard-coded path.
