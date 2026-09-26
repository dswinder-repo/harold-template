# Engagement playbooks: `playbook/engagements/<name>/`

Core playbooks (`playbook/core/`) are how you operate anywhere, and nothing in them names an employer or client. An **engagement** folder holds the procedures that belong to one job or one client: that company's fundraising cadence, its data room, its reporting to a particular boss, its outreach sequence to a particular kind of partner.

**How to use this folder**

1. Copy it to `playbook/engagements/<employer-or-client>/` (e.g. `playbook/engagements/acme/`). Delete this `example/` folder when you do.
2. Add a project for the engagement to `harold/projects.md` with `type: employer` or `type: client` and `status: active`.
3. Write one playbook per recurring workflow, in the same format as the core ones (`# Playbook: ...`, `**Purpose:**`, `**Trigger:**`, steps that name the files they write, a completion checklist). A workflow earns a playbook after you have done it by hand three times.
4. Add a row for each to `playbook/README.md` (e.g. `` `engagements/acme/investor-outreach.md` ``) and a trigger row to the Context Engine in `dashboard/processes.md`. `bin/harold boot` loads every playbook under `playbook/`, warns when one is missing from the index, and refuses to start when the index lists one that is gone.

**Ending an engagement** = set its project to `status: archived` in `harold/projects.md`. Its playbooks stay where they are, for the record, and stop firing because the Context Engine only routes to active engagements. Nothing in `core/` needs editing, and the contacts you met there stay in your CRM: the CRM is yours, not the engagement's.

**Typical engagement playbooks** (examples, not included): investor outreach cadence, investor meeting prep, data room management, a daily end-of-day brief for your manager, partner outreach sequence, CRM sync with the employer's own system.

This README is not a playbook; boot ignores README files.
