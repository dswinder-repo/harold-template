# Playbook: Content Production

**Purpose:** Turn an idea or hook into a published post, thread or newsletter in your own voice, then log how it did.
**Trigger:** "Draft content on [topic]", "write a thread about [topic]", "newsletter draft on [topic]", or a news/intel sweep surfaces a hook worth writing about.

---

## Plugin / Skill Integration

If your harness has content skills or plugins installed, use them at these steps. They are optional; the workflow below stands on its own.

| Step | Skill type | What it adds |
|------|------------|--------------|
| Draft | Content-creation skill | Channel-specific formatting, SEO, headline options |
| Voice check | Brand-voice skill | Consistency against your positioning ("[YOUR POSITIONING LINE]") |
| Competitive | Competitive-analysis skill | Only when the piece references competitors or market positioning |

---

## Inputs Required

- Topic / hook
- Target format (quick post, thread, long post, newsletter)
- Target platform ([PLATFORM 1, e.g. X], [PLATFORM 2, e.g. LinkedIn], [NEWSLETTER])
- Relevant context from the knowledge base: `bin/harold search "<topic>"` across `vault/intel/`, `vault/meetings/`, `vault/decisions/`
- Your content pillars from `dashboard/strategy.md`

**If data is missing:**
- No topic or hook given: ask for one in a single sentence. Do not invent a take on the operator's behalf.
- No format or platform given: default to a quick post and say so.
- No content pillars in `dashboard/strategy.md`: draft anyway, then ask the operator for 3 to 5 pillars and add them to `dashboard/strategy.md`.

---

## Content Formats

### Quick Post
- **Length:** 1 to 3 sentences, optional image
- **Time to produce:** 5 to 10 minutes
- **Best for:** Hot takes, observations, reactions to news

### Thread
- **Length:** 5 to 12 posts
- **Time to produce:** 30 to 60 minutes
- **Best for:** Explainers, stories, frameworks, lists

### Long Post (professional network)
- **Length:** 150 to 300 words
- **Time to produce:** 15 to 30 minutes
- **Best for:** Professional insights, longer-form takes

### Newsletter
- **Length:** 800 to 1500 words
- **Time to produce:** 2 to 4 hours
- **Best for:** Deep dives, original analysis, stories

---

## Production Workflow

> **Visualizer, first action:** Update `harold/active-sessions/{session}.json`: set `writing` to `"working"`, task = "Content: [topic/format]", progress = 0. Stay on `writing` throughout.

### Step 1: Capture the Hook
What is the insight? Write it in one sentence. If you cannot, the piece is not ready; go back to the operator.

**Good hooks:**
- Contrarian take: "Everyone says X, but actually Y"
- Specific insight: "I learned X from doing Y"
- Pattern recognition: "I've seen this 3 times now..."
- Timely reaction: "[News] happened. Here's what it means..."

### Step 2: Check Voice Calibration
Read `vault/intel/voice-calibration.md`.

**If it does not exist yet:** create it the first time this playbook runs. Ask the operator for 3 to 5 pieces they have written and liked, extract the patterns, and write them as short rules. Starter rules to replace with your own:
- [VOICE RULE 1, e.g. "Specific beats general"]
- [VOICE RULE 2, e.g. "Stories beat opinions"]
- [VOICE RULE 3, e.g. "Contrarian but constructive"]
- [VOICE RULE 4, e.g. "Show your work"]

### Step 3: Draft
Write fast, edit slow. Get the ideas down first. Save the draft in the content folder resolved with `bin/harold where content`. If no content folder is registered in `harold/projects.md`, save it under `vault/intel/drafts/` and suggest registering a content project.

**For threads:**
1. Hook post (most important: it must stop the scroll)
2. Setup / context
3. Main points (one per post)
4. Payoff / conclusion
5. CTA (follow, subscribe, reply)

**For newsletters:**
1. Hook paragraph
2. Context / setup
3. Main argument with evidence
4. Implications / so what
5. CTA

### Step 4: Edit
- Cut 20%. It is always too long.
- Check for jargon.
- Read aloud: does it sound like the operator (per `vault/intel/voice-calibration.md`)?
- Verify every fact and number against `harold/facts.md`. Anything that is not there, or that makes a claim about a named person or company, goes through `playbook/core/document-qc.md` before publishing.

### Step 5: Format for Platform
- Short-form platforms: respect the character limit, no markdown, use line breaks.
- Professional networks: basic formatting only, used sparingly.
- Newsletter: full formatting, images, links.

### Step 6: Schedule or Publish
Publishing is the operator's call. Present the final text; do not post on their behalf without an explicit yes.
- Best window: [YOUR AUDIENCE'S BEST HOURS] in [YOUR AUDIENCE'S TIMEZONE], [BEST DAYS].
- Short-form: engagement in the first 2 hours matters most.
- Newsletter: a consistent day and time builds the habit.

### Step 7: Engage
- Respond to comments within the first 2 hours.
- Quote or reshare interesting replies.
- Thank people who share.

### Step 8: Log
- Add the piece (date, platform, hook, link) to the content calendar in the content folder (`bin/harold where content`). If none exists, record it in today's daily note with `bin/harold file daily <slug> "Published: ..."`.
- After 24 to 48 hours, note performance next to the calendar entry.
- If a pattern emerges (a hook type that consistently works or flops), record it: `bin/harold file learning '{"severity":"info","project":"content","category":"process","lesson":"..."}'`.

> **Visualizer, last action (before responding):** Update the session file: set all activities to `"sleeping"`. Keep `"session": true`.

---

## Templates

### Thread Hook Formulas

```
I spent [time] doing [thing]. Here's what I learned:

[Contrarian statement]. But here's the thing most people miss:

Everyone's talking about [trend]. But no one's talking about [overlooked aspect]:

[Number] [things] I learned from [experience]. A thread:

"[Quote or common belief]" This is wrong. Here's why:
```

### Newsletter Structure

```
# [Headline]

[Hook paragraph: grab attention, state the insight]

---

## The Setup

[Context: why this matters now, what prompted this]

## The Insight

[Main argument: 2 to 4 paragraphs with evidence]

## What This Means

[Implications: so what? why should the reader care?]

## The Bottom Line

[1 to 2 sentence summary]

---

[CTA: reply, share, subscribe]
```

---

## Content Pillars (from `dashboard/strategy.md`)

1. **[PILLAR 1]** — [one-line description]
2. **[PILLAR 2]** — [one-line description]
3. **[PILLAR 3]** — [one-line description]
4. **[PILLAR 4]** — [one-line description]
5. **[PILLAR 5]** — [one-line description]

Every piece should map to at least one pillar. If it maps to none, ask whether it is worth publishing.

---

## Quality Checklist (before publishing)

- [ ] Does this sound like the operator? (Checked against `vault/intel/voice-calibration.md`)
- [ ] Is there a specific insight, not just an observation?
- [ ] Would the operator find this interesting if someone else posted it?
- [ ] Is it too long? (Cut 20%)
- [ ] Are facts and numbers verified (`harold/facts.md`, or `document-qc.md` for anything external)?
- [ ] Is there a clear CTA?

---

## Output

- Published content (by the operator)
- Content calendar updated
- Performance logged after 24 to 48 hours

## Success Criteria

- Content published consistently (target: [N]x/week short-form, [N]x/week long-form, [N]x/week newsletter)
- Engagement growing over time
- Inbound conversations generated

---

## Completion checklist

- [ ] Session file set to `writing` at start and `sleeping` at end
- [ ] Hook written in one sentence
- [ ] Voice checked against `vault/intel/voice-calibration.md` (created if it was missing)
- [ ] Draft saved to the content folder (`bin/harold where content`) or `vault/intel/drafts/`
- [ ] Facts verified; external claims passed through `document-qc.md`
- [ ] Operator approved before anything was published
- [ ] Content calendar or daily note updated
- [ ] Any pattern worth keeping filed with `bin/harold file learning`
