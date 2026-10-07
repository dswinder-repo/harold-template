# Playbook: Blocker Escalation

> **CRM tools.** Where a step names two tools (`crm_upsert_contact` / `harold_upsert_contact`), the first is the hosted connector's and the second harold-mcp's. Use whichever your harness has: they write the same database. A write made through the connector on a computer without CRM credentials is recorded with `bin/harold file crm '{...,"applied":"connector"}'` (see `AGENTS.md`, CRM Filing Protocol).

**Purpose:** Move blockers that aren't resolving: flag, escalate by age, and force a decision before they rot.
**Trigger:** Boot lists a blocker in `harold/blockers.md` older than 7 days (trigger id `blocker-escalation:<ID>`); "escalate [blocker]"; the same blocker mentioned repeatedly without progress.

---

## Where blockers live

`harold/blockers.md` is the only list. Active blockers sit in a table:

```
| ID | Project | Blocker | Waiting On | Raised | Last Update |
|----|---------|---------|------------|--------|-------------|
| B004 | [PROJECT] | Signed agreement from Acme Corp | Jane Doe (Acme Corp) | YYYY-MM-DD | YYYY-MM-DD: chased by email |
```

IDs run B001, B002, ... and are never reused. Resolved blockers move under a `## Resolved` heading with the resolution date and one line on how they resolved. Age is measured from **Raised** against today's system date (`bin/harold boot` prints it), not from Last Update: a blocker that gets chased every day but never moves is still old.

**If data is missing:** a row with no Raised date cannot be aged. Ask the operator when it started, or use the earliest mention found with `bin/harold search "<blocker keywords>"`, and fill it in.

---

## Escalation thresholds

| Blocker age | Action |
|-------------|--------|
| 0-3 days | Normal. Mention in briefs and standups. |
| 4-7 days | Warning. Flag it explicitly; ask the owner for a timeline. |
| 8-14 days | Escalate. Flag for a direct conversation with the owner; offer to help unblock. |
| 15+ days | Decision point. The operator decides: **resolve** (a concrete step with a date), **re-scope** (workaround or reduced scope), or **accept** (the delay is acknowledged and downstream work is replanned). |

The scheduled trigger fires from day 8. A blocker older than 15 days with no recorded decision is the failure this playbook exists to prevent.

---

## Escalation steps

### Step 1: Assess the blocker

Answer, in writing, in the daily note:
- Is it truly blocking, or can work route around it?
- Who owns it (the **Waiting On** column)?
- What is preventing resolution, as far as we know?
- What is the cost of continued delay? What downstream work is waiting?

Search for context first: `bin/harold search "<blocker keywords>"`, the owner's vault profile in `vault/people/`, and any related task in the task manager (Linear by default).

### Step 2: Choose the escalation level

**Level 1: Gentle reminder** (4-7 days)
- Re-surface it in the next brief.
- Ask the owner for an updated timeline.
- Offer help if there is something concrete to do.

**Level 2: Direct conversation** (8-14 days)
- Suggest the operator raise it directly, in dedicated time, not buried in a list.
- Bring proposed solutions, not just the problem.
- Ask "What do you need to unblock this?"

**Level 3: Workaround / re-scope** (15+ days, or earlier if the cost is high)
- Find an alternative path.
- Accept reduced scope or quality if that is the price.
- Document the workaround and why it was chosen.

**Level 4: Escalate further** (15+ days, when neither resolve nor re-scope works)
- Bring it to whoever can change priorities or resources.
- Frame it as impact on the work, not frustration with a person.
- Propose a decision: accept the delay, add resources, or change scope.

Harold drafts and recommends. The operator decides and sends; Harold never sends a message on the operator's behalf without an explicit yes.

---

## Communication templates

### Gentle reminder (for a brief)

```
BLOCKER UPDATE: [ID]

[Blocker] has been open for [X] days (raised [YYYY-MM-DD]).

Current status: [what we know]
Impact: [what is waiting on this]
Ask: [specific action needed, from whom]
```

### Direct conversation opener

```
Hi [Name], checking in on [blocker].

I know there is a lot on your plate, but this is starting to hold up [downstream work].

Where does it stand? Is there anything I can do to help move it forward?
```

### Workaround proposal

```
Given [blocker] has been open for [X] days, I think we should [workaround].

That means [tradeoff], but it lets us keep moving on [downstream work].

Does that work, or is there a firmer timeline for the original path?
```

---

## Guidance by type of owner

### Waiting on your own team
- Use the team's normal channel first (brief, standup, sync).
- Past 7 days: name the downstream impact plainly ("this is holding up [downstream work]; can we prioritize it?").
- Record the chase in the daily note. Whether to log it in the CRM follows the CRM filing protocol (types listed in the optional `HAROLD_NO_LOG_TYPES` are never logged).

### Waiting on an external contact
- Day 7: follow-up message.
- Day 14: try a different channel (email → phone or another platform).
- Day 21: find an alternate path or accept the delay.
- Each touch is an external interaction: file it with the CRM filing protocol (`crm_log_interaction` / `harold_log_interaction` + `crm_upsert_contact` / `harold_upsert_contact` + the vault profile). If the CRM is unreachable, queue it: `bin/harold file crm '{"contact":"Jane Doe","action":"log_interaction","payload":{...}}'`.

### Waiting on board, legal or a regulator
- These legitimately take time.
- Check in monthly; record the expected timeline in the Last Update column.
- Don't escalate unless something is genuinely urgent. The 15-day decision can be "accept, expected by [date]".

### Waiting on data or documents
- Offer to help gather it.
- Propose a partial answer with the data available.
- Set a clear line: "If we don't have this by [date], we'll [alternative]."

---

## Documentation

Every escalation updates, in the same session:
1. `harold/blockers.md`: append the escalation step and date to the **Last Update** column. If resolved, move the row under `## Resolved` with date and resolution.
2. `vault/daily/YYYY-MM-DD-<slug>.md`: the assessment, what was done, and the outcome (`bin/harold file daily <slug> "<text>"`).
3. The related task in the task manager (Linear by default): a comment with the escalation status. If there is no task and follow-up is needed, create one ([TEAM]-123).
4. `harold/alerts.md`: if the blocker is 8+ days old it should appear there; if resolved, remove it.
5. The trigger record:
   ```bash
   bin/harold file trigger blocker-escalation:B004 ran "Level 2: flagged for direct conversation"
   # or
   bin/harold file trigger blocker-escalation:B004 deferred "Owner on leave until YYYY-MM-DD"
   ```

---

## Output

One of:
- blocker resolved;
- workaround or re-scope implemented;
- an explicit decision to accept the delay, with a date to revisit.

---

## Success criteria

- No blocker sits past 14 days without an explicit decision.
- Downstream work is never silently waiting.
- Relationships preserved: escalation is not blame.

---

## Completion checklist

- [ ] Blocker aged from its Raised date against the system date
- [ ] Assessment written (blocking? owner? cause? cost?)
- [ ] Escalation level chosen to match age and cost
- [ ] Draft message prepared for the operator (not sent without a yes)
- [ ] 15+ days: operator's decision recorded (resolve / re-scope / accept)
- [ ] `harold/blockers.md` Last Update column updated (or row moved to `## Resolved`)
- [ ] Daily note updated
- [ ] Task manager comment added
- [ ] Touches filed in the CRM (or queued), except types listed in `HAROLD_NO_LOG_TYPES`
- [ ] `bin/harold file trigger blocker-escalation:<ID> ran|skipped|deferred "<reason>"` recorded
