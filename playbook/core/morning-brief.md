# Playbook: Morning Brief

**Purpose:** Start the day in three guided steps: intel, then the brief and priorities, then ready-to-run prompts.
**Trigger:** "good morning", "morning", "gm", "daily brief", "start the day", "let's go", or any morning greeting.

**This is a mandatory playbook. Follow it exactly. Do not improvise, and do not merge the steps.**

---

## Context

The brief is built around one reality: things change overnight. Colleagues in other timezones ([TEAM TIMEZONE], if any), inbound email and late messages all land before you sit down, and Harold cannot see most of them. So the brief deliberately pauses twice:

1. After the non-task intel, to ask **you** what came in overnight.
2. After proposing priorities, to ask **you** to confirm them.

Priority-setting is guided, not open-ended. Harold proposes; you confirm, correct, or add nuance.

**Configure these once** (replace the placeholders in this file, or record them in `memory/CLAUDE.md` and point here):

| Setting | Placeholder | Notes |
|---------|-------------|-------|
| Weather location | [YOUR CITY] | Optional. Delete the section if you don't want it. |
| Calendar source | [YOUR CALENDAR SOURCE] | A calendar connector, an app screenshot, or an export. List every calendar that matters (work, personal, family). |
| Markets | [YOUR MARKETS WATCHLIST] | Optional. e.g. major indices, a few tickers, rates, commodities. |
| News beats | [YOUR NEWS BEATS] | Optional. e.g. Global, Business/Finance, your industry, your region. |
| Other sections | [YOUR OPTIONAL SECTIONS] | Optional. e.g. sports scores, weather at an upcoming trip destination. |

**If the calendar source is unreachable, say so on the first attempt.** Do not try three workarounds silently and do not present a day with no meetings as if it were true.

**Optional cloud draft:** if you set up the scheduled cloud morning brief, a draft may exist at `harold/briefs/YYYY-MM-DD.md`. Nothing reads it automatically. If today's file exists, use it as input for Step 1; if it doesn't, run Step 1 live.

---

## STEP 1: Good Morning (non-task items only)

**Do NOT present tasks, task-manager issues, or priorities in Step 1.** Step 1 is orientation. Tasks come after you've added what happened overnight.

1. **Memory consolidation.** Read yesterday's note(s) in `vault/daily/` (`bin/harold search` or list the folder by date). Scan `harold/facts.md` for items referenced 3+ times this week; if one is clearly load-bearing, promote it to `dashboard/status.md` so it stays visible.
   - *If no daily note exists for the last 3+ days:* say so, and plan to write one at session close.

2. **Weather** (optional) — today's forecast for [YOUR CITY].

3. **Calendar** — today's meetings from [YOUR CALENDAR SOURCE], all calendars.
   - *If unreachable:* say "Calendar unavailable: [reason]" and continue. Never infer the schedule from memory.

4. **Morning intel** (every sub-section optional and configurable):

   ### Markets
   | Index/Asset | Price | Change |
   |-------------|-------|--------|
   [YOUR MARKETS WATCHLIST]

   ### News
   For each of [YOUR NEWS BEATS]: up to 5 stories, 3 sentences or fewer each.

   ### [YOUR OPTIONAL SECTIONS]
   Keep them short. Scoreboard format for scores.

   ### Analyst mode: relevance and angles

   **This is the critical differentiator. Never skip it.** The news is the surface; the angles are the point.

   1. **Cross-reference against the full knowledge base**, not a static list: every `status: active` entry in `harold/projects.md` (its keywords, people and competitors), upcoming items in `harold/events.md`, open blockers in `harold/blockers.md`, key relationships, and the priorities in `memory/CLAUDE.md`. `playbook/core/analyst.md` defines the full cross-reference.
   2. **Look for the angle.** Ask: how does this story create risk, opportunity, leverage, or urgency for the operator's work or life? Consider second-order effects, not only obvious connections.
   3. **Don't force it.** Flag only real, actionable connections. Quality over quantity.
   4. **Format callouts inline** under the story:
      📌 *[Project/Context]:* [1-2 sentences: what it means, what to watch, or what action it suggests]

   Angles worth catching: policy changes affecting your markets or events; moves by investors, partners, customers or competitors; economic signals for your regions; travel disruption near an upcoming trip; technology shifts relevant to what you build; anything touching [YOUR CITY], your focus regions, or a key contact.

   - *If a news or markets source is unavailable:* drop that section with a one-line note. Analyst mode still runs on whatever intel you do have.

### → End Step 1 with: "You got anything? What came in overnight?"

**STOP. Wait for the operator's answer. Do NOT start Step 2 until they reply** (even "nothing" is an answer).

---

## STEP 2: Daily Brief + Priorities

**Only begin Step 2 after the operator has given overnight context.**

### First: process overnight updates
- Integrate what the operator shared (emails, team updates, messages).
- Overnight updates add to the system state; they supersede it only where they specifically contradict it.
- If the updates contain new people, run `playbook/core/contact-intake.md`; new projects, `playbook/core/project-intake.md`; new intel, `playbook/core/analyst.md`. Do the filing after the brief is presented unless it changes a priority.

### Then: rebuild the alerts (mandatory, every brief)

This is why alerts never go stale. `harold/alerts.md` is a **derived view**: rebuild it from source, never patch it by memory.

1. **Task manager (Linear by default):** overdue tasks, tasks due today, tasks due this week and not started, high-priority tasks. (`bin/harold-linear tasks` if you use the helper.)
2. **`harold/blockers.md`:** days since each blocker was raised. More than 7 days = 🔴, 3-7 days = 🟠. A blocker older than 7 days also fires the escalation trigger (`blocker-escalation:<ID>`).
3. **`harold/events.md`:** days until each event. An event fewer than 10 days out with prep not complete fires `event-prep:<event>`.
4. **Rebuild the "Current Alerts" section** of `harold/alerts.md` from those three sources.
5. Move resolved items to the Alert History section.
6. Update the `Last updated: <Month D, YYYY>` line at the bottom of the file.
7. Record the trigger:
   ```bash
   bin/harold file trigger alerts-rebuild ran "morning brief"
   ```

**If the alerts timestamp was more than 1 day old at session start**, say so first: "⚠️ Alerts were last refreshed [date]. Rebuilding now."

**If a source is missing or unreachable:** rebuild from the sources you have, name the missing one in the brief ("Task manager unreachable: alerts built from blockers and events only"), and record the trigger as `ran` with that reason. If you could not rebuild at all, record `bin/harold file trigger alerts-rebuild skipped "<reason>"`.

### Then: run the daily brief

1. **Tasks** — overdue, due today, high priority this week, plus anything overnight changed.
2. **Raw inbox** — check `raw/` for sources without `compiled: true`. If any: "[N] items in raw/ inbox. Run /compile to process." Do NOT auto-compile during the brief.
3. **Pipeline health** — `harold_cadence_check` (or `harold_pipeline` with `list`). One pipeline; every entry has a purpose.

   | Contact | Purpose | Stage | Last Touch | Days Silent | Flag | Next Action |
   |---------|---------|-------|------------|-------------|------|-------------|

   Staleness: the stage cadence for pipeline entries; otherwise warmth (Hot 7 days, Warm 14, Lukewarm 28). Cold or unset warmth gets no nudge. Team members never appear here.
   - *If the CRM is unreachable:* say so, and fall back to `last_updated` in `vault/people/` profiles for the contacts tied to today's priorities.
4. **Blockers and flags** — active blockers, deadlines in the next 7 days, overnight additions.
5. **Scheduled triggers** — anything due today per `AGENTS.md` (weekly-scan on Fridays, full-audit on the 1st, month-end on the last business day). Due means it runs this session; say so here.
6. **Everything else** the knowledge base says needs attention.

### Finally: suggest priorities

From the combined picture (overnight + system state):

**TOP 3 PRIORITIES:** each with a one-line rationale.

### → Ask (closed-ended): "Does this look right?"

- NOT "What are your priorities?" (too open).
- Accept confirmation, correction, or added nuance.

**STOP. Wait for confirmation before Step 3.**

---

## STEP 3: Prompt Creation (parallel execution)

**Only begin Step 3 after the operator confirms or adjusts the priorities.**

Generate a ready-to-paste prompt for each confirmed priority. Each prompt includes:
- The relevant context from the knowledge base (project folder resolved via `bin/harold where <topic>`, key people, recent decisions)
- Clear deliverables and the files to create or update
- The task-manager issues to update ([TEAM]-123 style ids)
- Success criteria
- A recommended model tier

**Model tier** (see `playbook/core/model-routing.md`):
- Strategic judgment, synthesis, or complex writing → **[STRONGEST MODEL]**
- An established playbook with known inputs → **[MID-TIER MODEL]**
- Purely mechanical (batch updates, lookups) → **[FASTEST MODEL]**, or bundle it into another session

Format:
```
**Priority 1: [Name]** [STRONGEST MODEL]
[Full prompt with context, deliverables, file paths, tasks]

**Priority 2: [Name]** [MID-TIER MODEL]
[Full prompt]

**Priority 3: [Name]** [MID-TIER MODEL]
[Full prompt]
```

The operator launches each prompt as its own session, in parallel.

---

## Rules

1. **Run the 3 steps in order.** Never combine them.
2. **Stop after Step 1.** Wait for the overnight answer.
3. **Stop after the Step 2 priorities.** Wait for confirmation.
4. **Never skip analyst mode.** The callouts are the whole point.
5. **Never skip the alerts rebuild**, and always record the trigger.
6. **Never silently drop a source.** If calendar, CRM, task manager or news is down, say so the first time.
7. **Overnight updates are processed in Step 2, not Step 1.**
8. If you run a session dashboard, keep `harold/active-sessions/<session>.json` in step with where you are.

---

## Completion checklist

- [ ] Step 1 presented (memory consolidation, calendar, configured intel sections, analyst callouts) and ended with the overnight question
- [ ] Waited for the overnight answer
- [ ] Overnight updates integrated; intake/analyst playbooks queued for new people, projects, intel
- [ ] `harold/alerts.md` Current Alerts rebuilt from blockers + events + task manager; `Last updated:` line changed
- [ ] `bin/harold file trigger alerts-rebuild ran "morning brief"` recorded (or `skipped` with a reason)
- [ ] Raw inbox, pipeline health, blockers and due scheduled triggers reported
- [ ] Top 3 priorities proposed and confirmed with "Does this look right?"
- [ ] One prompt per confirmed priority, each with a model tier
- [ ] Anything that changed knowledge noted for today's `vault/daily/YYYY-MM-DD-<slug>.md`
