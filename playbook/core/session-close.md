# Playbook: Session Close

> **CRM tools.** Where a step names two tools (`crm_upsert_contact` / `harold_upsert_contact`), the first is the hosted connector's and the second harold-mcp's. Use whichever your harness has: they write the same database. A write made through the connector on a computer without CRM credentials is recorded with `bin/harold file crm '{...,"applied":"connector"}'` (see `playbook/core/crm-filing.md`).

**Purpose:** Close a session properly: CRM sweep, vault daily note, task check, scheduled work recorded, then `bin/harold close --final`.
**Trigger:** "done", "wrap", "wrap up", "end session", "that's it", "close out", "/done".

---

**Sequence (execute ALL steps, no skipping):**

1. **Session summary** — 3-5 bullets of what was accomplished.
2. **CRM sweep** — for EVERY contact mentioned or touched this session (`playbook/core/crm-filing.md`):
   - If the contact's vault card says `crm: none`, update the vault profile only.
   - For every other contact, whatever its type: verify the interaction is logged, the contact record is updated (warmth, status, notes), and the vault profile is current (`last_updated` today). If any of the three is missing, fix it before proceeding. Written through the connector with no local credentials → `bin/harold file crm '{…,"applied":"connector"}'`; CRM down → `bin/harold file crm` (queued).
3. **Vault daily note** — create or append to `vault/daily/YYYY-MM-DD-<session-slug>.md` (template: `vault/templates/daily.md`): what was done, contacts touched, files created or modified, CRM actions, pending items for next session.
4. **Task check** — update the task manager for anything discussed; create tasks for new action items (every task gets a due date and a project).
5. **Record scheduled work** — every DUE item from boot: `bin/harold file trigger <id> ran|skipped "<reason>"`.
6. **Close** — run `bin/harold close --final`. It sets the session file to `"session": false`, verifies the filing above, appends the maintenance line (what was due and whether it ran) to today's daily note, and commits and pushes. If it lists problems, fix them and run it again.
7. **Report** — concise summary: what was done, what was filed, any loose ends.

**If data is missing:** if the CRM or the task manager cannot be reached, queue or note what could not be filed, say so in the report, and still run `bin/harold close --final`.

---

## Completion checklist

- [ ] Summary written; CRM sweep done (`crm: none` respected)
- [ ] Vault daily note written; task manager checked
- [ ] Every DUE item from boot recorded with `bin/harold file trigger`
- [ ] `bin/harold close --final` ran clean; the operator told what was done, filed and left open
