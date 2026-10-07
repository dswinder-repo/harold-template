# Playbook: Morning Brief

> **CRM tools.** Where a step names two tools (`crm_upsert_contact` / `harold_upsert_contact`), the first is the hosted connector's and the second harold-mcp's. Use whichever your harness has: they write the same database. A write made through the connector on a computer without CRM credentials is recorded with `bin/harold file crm '{...,"applied":"connector"}'` (see `AGENTS.md`, CRM Filing Protocol).

**Purpose:** Start the day in three guided steps: intel, then the brief and priorities, then ready-to-run prompts.
**Trigger:** a start-of-day opener, at any hour: "good morning", "morning", "gm", "let's get started", "let's go", "start the day", "daily brief", or the same idea in other words. **Not a trigger:** a first message that is a request about a project; do the request and do not run or offer the brief. Once the brief has run today, do not re-run it unless asked.

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
| Calendars | [YOUR CALENDARS] | Read through a calendar connector (see Calendar Access below). List every calendar that matters: work, personal, family, shared. |
| Markets | [YOUR MARKETS WATCHLIST] | Optional. e.g. major indices, a few tickers, rates, commodities. |
| News beats | [YOUR NEWS BEATS] | Optional. e.g. Global, Business/Finance, your industry, your region. |
| Other sections | [YOUR OPTIONAL SECTIONS] | Optional. e.g. sports scores, weather at an upcoming trip destination. |

**Calendar Access:**
- Read today's and the coming week's events through a calendar connector available in the session (for example Google Calendar or Microsoft 365). Pull every calendar listed above.
- No screenshots of a calendar app and no scripts against one machine's calendar: the brief must work from any harness, including a scheduled cloud job with nobody at a computer.
- If no calendar connector is available, or it fails, say "Calendar unavailable: [reason]" on the first attempt and continue. Do not try three workarounds silently, and never present a day with no meetings as if it were true.
- If an employer's calendar cannot be connected (some organizations block connectors), any workaround belongs in that engagement's playbook (`playbook/engagements/<name>/`), not here. A workaround is a known flaw to retire, not part of the design.

---

## STEP 0: Is today's draft already written? (check FIRST, every time)

If you turned on the scheduled morning brief (`.github/workflows/morning-brief.yml`, or a Claude Code routine running `harold/brief-prompt.md`), Steps 1 and 2 may already be written for today, at `harold/briefs/YYYY-MM-DD.md`. It is due on weekdays at `HAROLD_BRIEF_TIME` (default 06:30) in `HAROLD_TZ`. Re-running Steps 1 and 2 when that draft exists wastes the operator's morning and the work already done.

1. **Find it.** `bin/harold boot` prints a section **"Today's morning brief draft"**; `bin/harold brief status` prints the same thing on demand. It says one of:
   - **READY** (in this checkout) → read that file.
   - **READY on origin, not in this checkout** → run `git -C <root> pull --ff-only`, then read the file. If the pull refuses (local changes in the way), do not force it: read the draft with the `git show origin/<branch>:harold/briefs/<date>.md` command boot printed, and say the checkout is behind.
   - **NONE yet** (before the brief time) or **NONE** on a weekend → run Steps 1 and 2 live below.
   - **NONE** on a weekday after the brief time → if the operator runs the scheduled brief, say so in one line ("No draft this morning: the scheduled brief did not write one"), then run Steps 1 and 2 live.
   - **UNKNOWN** (origin could not be reached) → retry once; if it still fails, run live and say why.
2. **Put it on screen.** Present the draft's Step 1 and Step 2 content as written, headed by one line: when the job fired and finished (frontmatter `fired`, `generated`) and the ages of any data the draft itself states. Do not re-run the web searches or rebuild alerts; the job already did. Only refresh something if the operator asks, or if an item is plainly overtaken (for example a meeting that has already happened).
   Also check `harold/briefs/housekeeping-notes.md`: anything still under `## New` (left by unattended jobs after the draft was made) goes in one short **Housekeeping** line at the end; then move those lines under `## Shown`. Nothing there means say nothing.
3. **Still ask the overnight question.** End with: "You got anything? What came in overnight?" and STOP, exactly as in Step 1. The scheduled job could not ask it.
4. **Then Step 2's "First: process overnight updates".** Integrate what the operator says into the draft's picture, adjust the TOP 3 PRIORITIES if the overnight input changes them (say what changed and why), and ask "Does this look right?"
5. **Then Step 3** as written below.

Everything below is the live procedure, used when there is no draft and as the specification the scheduled job follows.

---

## STEP 1: Good Morning (non-task items only)

**Do NOT present tasks, task-manager issues, or priorities in Step 1.** Step 1 is orientation. Tasks come after you've added what happened overnight.

1. **Memory consolidation.** Read yesterday's note(s) in `vault/daily/` (`bin/harold search` or list the folder by date). Scan `harold/facts.md` for items referenced 3+ times this week; if one is clearly load-bearing, promote it to `dashboard/status.md` so it stays visible.
   - *If no daily note exists for the last 3+ days:* say so, and plan to write one at session close.

2. **Weather** (optional) — today's forecast for [YOUR CITY].

3. **Calendar** — today's meetings, all calendars (see Calendar Access above).
   - *If unavailable:* say "Calendar unavailable: [reason]" and continue. Never infer the schedule from memory.

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
4. **Stale relationships, when a CRM tool is available:** `crm_stale` on the connector, `harold_cadence_check` on harold-mcp. List each contact it returns under 🟡 WATCH (name, days since the last touch, its cadence). The scheduled draft job has no CRM tool, so the alerts it rebuilds do not include stale relationships; with no CRM tool here either, say so in one line.
5. **Rebuild the "Current Alerts" section** of `harold/alerts.md` from those sources.
6. Move resolved items to the Alert History section.
7. Update the `Last updated: <Month D, YYYY>` line at the bottom of the file.
8. Record the trigger:
   ```bash
   bin/harold file trigger alerts-rebuild ran "morning brief"
   ```

**If the alerts timestamp was more than 1 day old at session start**, say so first: "⚠️ Alerts were last refreshed [date]. Rebuilding now."

**If a source is missing or unreachable:** rebuild from the sources you have, name the missing one in the brief ("Task manager unreachable: alerts built from blockers and events only"), and record the trigger as `ran` with that reason. If you could not rebuild at all, record `bin/harold file trigger alerts-rebuild skipped "<reason>"`.

### Then: run the daily brief

1. **Tasks** — overdue, due today, high priority this week, plus anything overnight changed.
2. **Raw inbox** — check `raw/` for sources without `compiled: true`. If any: "[N] items in raw/ inbox. Run /compile to process." Do NOT auto-compile during the brief.
3. **Pipeline health** — `harold_cadence_check` on harold-mcp (on the connector: `crm_pipeline` with `list`, and `crm_stale` for who has gone quiet). One pipeline; every entry has a purpose.

   | Contact | Purpose | Stage | Last Touch | Days Silent | Flag | Next Action |
   |---------|---------|-------|------------|-------------|------|-------------|

   Staleness: the stage cadence for pipeline entries; otherwise warmth (Hot 7 days, Warm 14, Lukewarm 28). Cold or unset warmth gets no nudge, and neither do the types in `HAROLD_NO_CADENCE_TYPES` (default `other`) or the optional `HAROLD_NO_LOG_TYPES`.
   - *If the CRM is unreachable:* say so, and fall back to `last_updated` in `vault/people/` profiles for the contacts tied to today's priorities.
4. **Blockers and flags** — active blockers, deadlines in the next 7 days, overnight additions.
5. **Scheduled triggers** — anything due today per `AGENTS.md` (weekly-scan on Fridays, full-audit on the 1st, month-end on the last business day). Due means it runs this session; say so here. With cloud housekeeping on (`harold/housekeeping.json`), those three run as scheduled jobs and boot lists them only as notes: do not run them here.
   **Housekeeping notes:** anything under `## New` in `harold/briefs/housekeeping-notes.md` (left by unattended jobs) goes in one short **Housekeeping** line here, one item each as written; then move those lines under `## Shown`. Nothing there means say nothing.
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

- [ ] Step 0: today's draft checked (boot's "Today's morning brief draft"); if READY, shown instead of re-running Steps 1-2
- [ ] Step 1 presented (memory consolidation, calendar, configured intel sections, analyst callouts) and ended with the overnight question
- [ ] Waited for the overnight answer
- [ ] Overnight updates integrated; intake/analyst playbooks queued for new people, projects, intel
- [ ] `harold/alerts.md` Current Alerts rebuilt from blockers + events + task manager; `Last updated:` line changed
- [ ] `bin/harold file trigger alerts-rebuild ran "morning brief"` recorded (or `skipped` with a reason)
- [ ] Raw inbox, pipeline health, blockers and due scheduled triggers reported
- [ ] Top 3 priorities proposed and confirmed with "Does this look right?"
- [ ] One prompt per confirmed priority, each with a model tier
- [ ] Anything that changed knowledge noted for today's `vault/daily/YYYY-MM-DD-<slug>.md`
