# Harold Project Map

*The live registry of every project and engagement Harold routes work into. `bin/harold boot` loads it; `bin/harold where <topic>` queries it; playbooks resolve folders through it instead of hard-coding paths; `bin/harold close` and the search index treat every `folder:` here as a knowledge directory. `playbook/core/analyst.md` cross-references new intel against the **active** entries here, not against a static list.*

**Format is machine-read.** One `## ` heading per project. Fields are `- key: value` bullets directly under the heading. Keys:

- `folder` — path relative to the workspace root (must exist, or boot warns)
- `status` — active | paused | archived
- `type` — employer | client | venture | workstream | personal | tool
- `aliases` — comma-separated: what you actually call it out loud. Harold adds new ones as it hears them.
- `keywords` — comma-separated terms that signal this project in conversation
- `routes` — subfolder → purpose, `;`-separated
- `people` — wiki-links to `vault/people` cards
- `competitors` — read by the analyst protocol
- `card` — the `vault/projects` note
- `notes` — anything else

**Ending an engagement = set `status: archived`.** Nothing else changes; the folder, cards and history stay. New projects are added by `playbook/core/project-intake.md`, usually without being asked: you start talking about something the map does not know, and Harold creates the folder, this entry, the vault card and the cross-links.

---

## Example Project
- folder: projects/example
- status: active
- type: workstream
- aliases: example, the example, sample project
- keywords: acme, nda, partnership
- routes: notes → working notes; drafts → documents in progress
- people: [[Jane Doe]]
- competitors: Globex
- card: vault/projects/example-project.md
- notes: Starter example. Replace it with your first real project, or set status: archived.

## Harold (this system)
- folder: tools
- status: active
- type: tool
- aliases: harold, the system, chief of staff
- keywords: boot, close, playbook, vault, crm, mcp
- routes: harold-mcp → CRM + knowledge-base MCP server; harold-plugin → Cowork plugin; visualizer → Expedition HQ dashboard
- card: vault/projects/harold.md
- notes: The workspace's own tooling.
