# Playbook: CRM Filing

> **CRM tools.** Where a step names two tools (`crm_upsert_contact` / `harold_upsert_contact`), the first is the hosted connector's and the second harold-mcp's. Use whichever your harness has: they write the same database.

**Purpose:** File every contact interaction into the CRM and the vault, all three places together.
**Trigger:** Any interaction with a contact: a meeting, call, email or message; any correction to a contact's details; the CRM sweep at session close.

`AGENTS.md` keeps the short form of this rule (all three, every time). This playbook is the full procedure. It is mandatory.

---

## What the CRM is

*The CRM is the operator's own, spanning their whole working life, not an employer's. Each contact has exactly one type, from the operator's own short list (for example: investor, partner, founder, team, other; see `dashboard/people.md`), any number of labels, and a warmth (Hot, Warm, Lukewarm, Cold, or unset). There is one pipeline; every entry in it states its purpose and sits at one of seven stages: Identified, Reached Out, In Conversation, Advancing, Committed, Active, Dormant. Nothing is placed in the pipeline automatically.*

---

## Step 1: Check the profile first

Before logging anything, open the contact's vault profile (`vault/people/<Name>.md`). If there is none, run `playbook/core/contact-intake.md` for them first.

A card with `crm: none` is deliberately kept out of the CRM: update the vault profile only, and make no CRM calls for that person. Every other contact is filed the same way, whatever its type, as Step 2 describes.

---

## Step 2: All three, together

For every other contact touched, all three happen in the same turn. No exceptions. No "I'll do it next."

1. **Log the interaction:** `crm_log_interaction` on the connector, `harold_log_interaction` on harold-mcp.
2. **Update the contact record** (warmth, status, notes): `crm_upsert_contact` on the connector, `harold_upsert_contact` on harold-mcp.
3. **Update the vault people profile:** warmth, `last_updated`, context.

Use whichever of the two tools your harness has; they write the same database.

---

## Step 3: A write made through the connector

`bin/harold close` can see CRM writes only when this computer holds the CRM credentials (`~/.harold/env`). Without them, record each connector write so close counts the contact as filed (it is never replayed):

```bash
bin/harold file crm '{"contact":"Jane Doe","action":"upsert_contact","applied":"connector"}'
```

That is the normal way to work with the connector and no local credentials. The queue below is only for when the CRM cannot be reached at all.

---

## Step 4: If the CRM is unreachable

If no CRM tool works and there is no connector, queue the work instead of dropping it, and say that you did:

```bash
bin/harold file crm '{"contact":"Jane Doe","action":"log_interaction","payload":{"type":"call","subject":"Intro call"}}'
```

The queue is a fallback for outages, not a workflow: `bin/harold boot` and `bin/harold close` apply it automatically the next time they run on a computer that holds the CRM credentials and can reach it (scheduled jobs, which hold no CRM credentials, and the connector never replay it), skipping anything already applied. `bin/harold replay --dry-run` shows what would happen.

---

## Corrections

When a contact detail is corrected (warmth, a name, a title, any field), the CRM contact record is the most important update. Never correct the vault or the task manager and skip the CRM. A correction is not an interaction: do not log one for it.

---

## Completion checklist

- [ ] Vault profile opened before any CRM action; `crm: none` respected
- [ ] Every other contact: interaction logged, contact record updated, vault people profile updated (`last_updated` today)
- [ ] Connector write recorded with `bin/harold file crm '{...,"applied":"connector"}'`, or an outage queued with `bin/harold file crm`, and said so
- [ ] Corrections made in the CRM record first
