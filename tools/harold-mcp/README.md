# harold-mcp

The MCP server that connects Harold to your CRM and keeps the `harold/` markdown files in the formats `bin/harold` reads.

**Tools (14)**

| Tool | What it does |
|------|--------------|
| `harold_log_interaction` | Log a call, email, meeting, note |
| `harold_upsert_contact` | Create or update a contact (one type, labels, warmth, status) |
| `harold_search_contacts` | Find contacts by name, org, type, warmth, stage, purpose, project, keyword |
| `harold_get_contact` | Full profile: labels, pipeline entries, interactions, open tasks, stage history |
| `harold_pipeline` | The one pipeline: add (with a purpose), move, close, list |
| `harold_cadence_check` | Relationships overdue for contact, plus overdue CRM tasks |
| `harold_crm_task` | Contact-specific follow-ups: create, update, complete, cancel, list |
| `harold_alerts_sync` | The alerts engine: events, blockers, CRM freshness, CRM tasks, task-manager input |
| `harold_log` | Append to `harold/context-log.md` |
| `harold_fact` | Upsert a row in `harold/facts.md` |
| `harold_alert` | Add, update or resolve an alert in `harold/alerts.md` |
| `harold_blocker` | Add, update or resolve a blocker in `harold/blockers.md` |
| `harold_event` | Add, update or complete an event in `harold/events.md` |
| `harold_read` | Read a `harold/` file, optionally filtered |

**Setup**

1. Create a Supabase project in your own account. In its SQL editor, run `schema.sql` (this folder). It creates exactly the seven tables this server uses, with row-level security on.
2. `bin/harold-setup-crm` — stores `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `~/.harold/env` (outside the repo) and tests the connection.
3. `cd tools/harold-mcp && npm install` (node_modules is gitignored).
4. Copy `.mcp.example.json` at the workspace root to `.mcp.json` (gitignored) and set the absolute path to `bin/harold-mcp`, which loads `~/.harold/env` and starts `server.js`. Restart your Claude session.

Without the two Supabase variables the server still starts: it prints a loud warning, the markdown tools work, and every CRM tool returns an error saying exactly what is missing. Queue CRM work meanwhile with `bin/harold file crm '<json>'`.

Optional: `HAROLD_NO_CADENCE_TYPES` (default `team,other`) lists the contact types that never get staleness alerts.
