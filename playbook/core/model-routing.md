# Playbook: Dynamic Model Routing

**Purpose:** Route each task to the cheapest model tier that handles it well; save the top tier for work that needs it.
**Trigger:** Consulted automatically on every request, and when writing priority prompts in the morning brief. The operator never has to invoke it.

**How it works:** Harold reads intent from the operator's request, consults the routing table below, and either (a) handles it directly in the current session, or (b) delegates to a subagent at the appropriate tier (via whatever your harness calls subagent delegation, e.g. an Agent/Task tool with a `model` parameter).

---

## Model Tiers

Tier names are generic on purpose. Map them to whatever your provider currently offers, and update the mapping when models change. Do not pin exact version strings in this file; they go stale.

| Tier | Example | Best for | Cost |
|------|---------|----------|------|
| **Fast** | fast tier (e.g. Haiku) | Lookups, status checks, simple reads, rote updates | Lowest |
| **Mid** | mid tier (e.g. Sonnet) | Playbook execution, drafting, task-manager management, structured tasks | Medium |
| **Top** | top tier (e.g. Opus) | Strategy, synthesis, complex analysis, meeting prep, research, morning briefs | Highest |

---

## Routing Table

### Fast Tier (Simple Retrieval and Rote Operations)

Reading data and returning it, or making simple mechanical updates. No synthesis, no judgment.

| Task pattern | Examples |
|-------------|----------|
| **CRM / task-manager lookups** | "What's the status of [TEAM]-144?", "Who owns the Acme Corp contract task?", "List overdue tasks" |
| **File reads** | "What does `harold/blockers.md` say about B004?", "Read the Acme Corp profile" |
| **Simple status checks** | "When is [EVENT]?", "What's Jane Doe's last touch date?" |
| **Mechanical updates** | "Mark [TEAM]-187 done", "Add a comment to [TEAM]-144: waiting on Sam" |
| **Fact retrieval** | "Which fund is Sam Lee at?" |
| **Calendar reads** | "What's on the calendar tomorrow?" |
| **Alert checks** | "Any urgent alerts?" |

**Detection signals:** short question, single-entity focus, the answer exists in one place, no "why", "how" or "should we".

### Mid Tier (Structured Execution and Drafting)

Tasks that follow established patterns: playbooks, templates, multi-step but predictable workflows. Competence, not brilliance.

| Task pattern | Examples |
|-------------|----------|
| **Email drafting** (from templates or playbooks) | "Draft a follow-up to Jane Doe", "Write the day-8 follow-up for Sam Lee" |
| **Playbook execution** | Contact intake, blocker escalation, the document QC checklist |
| **Task-manager management** | Creating tasks with context, bulk status updates, sprint planning |
| **Alert sync** | Rebuilding `harold/alerts.md` from the task manager + `harold/blockers.md` + `harold/events.md` |
| **Daily note updates** | End-of-session flush to `vault/daily/` |
| **File updates** | Updating `harold/facts.md`, `harold/events.md`, `harold/blockers.md` with new information |
| **Standard document generation** | Meeting agendas, status reports, pipeline summaries |
| **Research summaries** | "Summarize what we know about Globex" (when the data already exists in the KB) |
| **Team handoff briefs** | End-of-day handoff to a teammate: follows a template, pulls from known state |
| **Pre-flight verification** | Checklist execution (names, dates, cross-references) |

**Detection signals:** follows a defined playbook, uses a template, multi-step but procedural, "do X" not "figure out X".

### Top Tier (Strategy, Synthesis and Complex Analysis)

Tasks that need judgment, cross-domain synthesis, creative framing, or navigating ambiguity. This is where the top tier earns its cost.

| Task pattern | Examples |
|-------------|----------|
| **Morning brief** (full sequence) | The analyst step cross-references news against the whole KB; that is synthesis |
| **Meeting prep** | Investor, partner or customer meeting prep that needs strategic framing |
| **Research on a new counterpart** | New investor or partner deep-dive, fit analysis, objection mapping |
| **Strategic analysis** | "How should we position for Acme Corp?", "What's our angle on [POLICY]?" |
| **Complex writing** | Memos, thought leadership, narrative-heavy documents |
| **Financial modeling** | Scenario analysis, fundraise projections, revenue modeling |
| **Problem solving** | "We're stuck on X, what are our options?", blocker analysis with multiple dependencies |
| **New playbook creation** | Designing new workflows, system improvements |
| **Cross-KB synthesis** | "What patterns do you see across our pipeline?" |
| **Presentation creation** | Decks, pitch materials, conference presentations |

**Detection signals:** requires judgment, involves "why/how/should", needs cross-referencing multiple sources, ambiguous inputs, creative output, strategic framing.

---

## In-Session Routing: Speed vs. Cost

There are two routing modes. **Choose based on what the operator needs, not just task complexity.**

### Speed-Optimized (Direct Execution)

**Use when:** the operator wants a fast answer: quick lookups, status checks, simple updates.

Do it directly in the current session, even if the current session is top tier and the task is fast tier. A 5-second answer in-session beats a minute-long subagent round trip.

**Why:** subagent delegation has overhead: spin-up time, no inherited context, sequential API calls. For anything where the answer should come back in seconds, delegation makes it slower, not faster.

**Default to this for:** CRM queries, task status checks, "what's the status of X?", single-file reads, quick calendar checks, any question the operator is clearly waiting on.

### Cost-Optimized (Subagent Delegation)

**Use when:** the task is token-heavy, can run in the background, or does not need an immediate answer.

```
# Token-heavy structured task: delegate to save cost
Agent(
  subagent_type="general-purpose",
  model="<mid tier, e.g. sonnet>",
  prompt="[Full context: the email to draft, the playbook instructions, contact details, template]"
)
```

**Why:** subagents save money on tasks that consume many tokens (long drafts, bulk file processing, research compilation) where the latency is acceptable.

**Use this for:** template-based email drafting, bulk task updates, long document generation, research the operator is not waiting on, background file processing.

### Decision Rule

> **Is the operator waiting for this answer right now?**
> - **Yes** → direct execution (speed)
> - **No, it can run while other work happens** → subagent (cost)

### Subagent Rules (When Delegating)

1. **Always include full context in the subagent prompt.** Subagents do not inherit conversation history. Pass them everything they need, including the file paths they may write to.
2. **For file edits via subagent:** use a lightweight subagent for simple edits, a general-purpose one for complex edits.
3. **Review before presenting:** for mid-tier drafts (emails, documents), Harold reviews the output before showing the operator. Fast-tier lookups can pass straight through.
4. **Announce routing only when relevant.** Do not narrate "routing to the fast tier" every time. If the operator asks, explain.

**If a subagent fails or returns thin results:** retry one tier up, or handle it directly. Never present an empty or low-quality subagent result as the answer.

---

## Cross-Session Routing (Morning Brief Priorities)

When the morning brief (`playbook/core/morning-brief.md`) generates priority prompts, tag each with a **recommended tier**:

```
**Priority 1: Acme Corp Meeting Prep** [TOP]
[Full prompt with context...]

**Priority 2: Investor Follow-Up Emails (Day 3)** [MID]
[Full prompt with context...]

**Priority 3: Update Partner Pipeline in the task manager** [MID]
[Full prompt with context...]
```

This tells the operator which tier to launch each session at. Each prompt contains all the context a cold-start session at that tier needs.

**Tier recommendation logic:**
- Needs strategic judgment or synthesis? → TOP
- Follows an established playbook with known inputs? → MID
- Purely mechanical (batch updates, simple lookups)? → FAST (or bundle into a mid-tier session with other tasks)

---

## Override Protocol

The operator can always override:
- **"Go deep on this"** → top tier, regardless of the routing table
- **"Just quick"** or **"quick:"** → fast tier, regardless
- **"This needs to be good"** → top tier

Harold should also **self-escalate** when a supposedly simple task turns out to be complex.

---

## Metrics (Tuning the Table)

Track over time to refine the routing table:
- How often do fast-tier results have to be repeated at a higher tier?
- Which mid-tier tasks consistently need top-tier quality?
- Which top-tier tasks could actually be handled by the mid tier?

Record each observation as a learning so future sessions inherit it:
`bin/harold file learning '{"severity":"info","project":"global","category":"tools","lesson":"Routing: <task pattern> needs <tier> because ..."}'`
When a pattern repeats, move the task to the right row in this file.

---

## Completion checklist

- [ ] Tier chosen from the routing table (or the operator's override)
- [ ] Speed vs. cost decided by "is the operator waiting right now?"
- [ ] Any subagent given full context and the exact files it may write
- [ ] Mid-tier drafts reviewed before being shown to the operator
- [ ] Failed or thin subagent results escalated one tier, not passed through
- [ ] Morning brief priorities tagged [FAST]/[MID]/[TOP]
- [ ] Routing misses filed with `bin/harold file learning`
