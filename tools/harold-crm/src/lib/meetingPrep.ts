import type { Contact } from './types'

// ── Types ──────────────────────────────────────────────────

export interface PrepSection {
  title: string
  content: string
}

export interface PrepResult {
  summary: string
  sections: PrepSection[]
  model: string
  preparedAt: string
}

export interface PrepResponse {
  success: true
  prep: PrepResult
  interactionId: string
}

export interface PrepError {
  success: false
  error: string
  code: 'RATE_LIMIT' | 'API_ERROR' | 'AUTH_ERROR' | 'CONTACT_NOT_FOUND' | 'UNKNOWN'
}

export type PrepAPIResponse = PrepResponse | PrepError

// ── Prompt builders ────────────────────────────────────────

// ── Sender context (injected into system prompt) ───────────

/**
 * Who the sender is, injected into the prompt so the brief knows what "we" means.
 *
 * Nothing about a company is assumed in code. The sender profile is data, held in
 * crm_settings under the key `sender_profile` (Settings > Sender Profile) and
 * passed in by the caller.
 *
 * When no profile is configured the brief still works; it simply reasons from the
 * contact and the interaction history alone rather than inventing an organization.
 */
const NO_SENDER_PROFILE = `
ABOUT THE SENDER:
No sender profile has been configured, so you do not know what organization the
reader represents. Do not invent one, and do not assume an industry, a product or
a fundraise. Base the brief solely on the contact and the interaction history, and
where a talking point would depend on knowing the sender's business, say plainly
what the reader needs to fill in.
`

/**
 * What kind of talking points each type of contact needs.
 *
 * These say how to think, not what to claim. The specifics come from the
 * configured sender profile and the interaction history, which is where facts
 * that change belong.
 */
const CATEGORY_TALKING_POINT_GUIDANCE: Record<string, string> = {
  investor: `INVESTOR TALKING POINT GUIDANCE:
Talking points should be about traction and thesis fit, drawn from the sender profile
and the interaction history:
- Where the numbers stand now versus when this investor last heard them
- What has actually changed since the previous conversation
- Whatever this investor asked for and has not yet received
- Any terms, commitments or objections already on the record with them
- Why the timing suits their stated focus
Do NOT generate a generic "discuss investment opportunity" point, and do NOT invent
metrics. If a number would strengthen a point and you do not have it, say which number
the reader should bring.`,

  founder: `FOUNDER TALKING POINT GUIDANCE:
Founders are building something and are short on time. Talking points should be about
what each side can do for the other:
- What they are building, and what has changed since you last spoke
- What they most need right now (capital, customers, hires, introductions)
- What the sender can offer, concretely, and what the sender wants in return
- Anything promised in the last exchange that is still outstanding
Do NOT invent traction figures. If a number matters and you do not have it, say so.`,

  government: `GOVERNMENT AND PUBLIC PROGRAM TALKING POINT GUIDANCE:
These are institutions with long memories and calendar-driven workflows. Talking points
should be about mutual mandate:
- What this agency is measured on, and which part of it the sender can move
- The specific program, event or funding cycle that creates a reason to talk now
- What the sender can offer that the agency cannot easily get elsewhere
- Who else in their network is already involved
Do NOT generate a generic "explore collaboration" point. Name their region and the
concrete thing being proposed.`,

  partner: `PARTNER TALKING POINT GUIDANCE:
Partnerships are bilateral, so every point needs a both-sides answer:
- What each side brings that the other cannot easily build
- The first joint activity that would prove it, small enough to actually happen
- How referrals or revenue would work between the two organizations
- Who owns it on each side
Do NOT generate a generic "discuss synergies" point. Identify the specific angle from
what their organization actually does.`,

  team: `TEAM TALKING POINT GUIDANCE:
Internal alignment. Keep it operational:
- Current priorities and where this person owns a piece
- Decisions waiting on them, and decisions they are waiting on
- Upcoming deliverables and events needing coordination
Reference specific context from the interaction history.`,

  other: `GENERAL TALKING POINT GUIDANCE:
Work out why this conversation is happening at all, then:
- What the sender wants from it, stated plainly
- What this contact is likely to want in return
- Anything outstanding from the last exchange
Be specific to their organization and the interaction history.`,
}

function buildPrepSystemContext(category: string, senderProfile?: string): string {
  const categoryGuidance = CATEGORY_TALKING_POINT_GUIDANCE[category] ?? CATEGORY_TALKING_POINT_GUIDANCE.other

  return `You are a senior CRM analyst preparing a concise, actionable meeting brief. Your job is to synthesize everything we know about this contact — their profile, the interaction history, open tasks, and the sender's own current priorities — into a brief that helps our team walk into a call or meeting fully prepared with specific, substantive talking points.

${senderProfile?.trim() || NO_SENDER_PROFILE}

ANALYSIS STANDARDS:
- Write like a chief of staff prepping the CEO for a call. Be direct, specific, and practical.
- Lead with the most important context for the upcoming conversation.
- Reference specific past interactions by date and type when relevant.
- Flag any open items, promises, or follow-ups that need addressing.
- Include external context (recent news, company updates) when it adds value.
- CRITICAL: Talking points must be SPECIFIC and reference real data, metrics, programs, or commitments — never generic.

${categoryGuidance}

OUTPUT STRUCTURE (use these exact ## headers):

## Summary
2-3 sentences of the key context for this meeting. What's the relationship status and what matters most right now?

## Relationship Context
Our history with this contact: how long, how active, trajectory (warming/cooling), key milestones in the relationship. Reference specific interactions.

## Key Talking Points
Bulleted list of 4-6 specific, actionable talking points. Each MUST reference concrete information — our metrics, their org's context, past commitments, or specific programs/proposals we should raise. No generic themes.

## Open Items & Action Items
Any promises we've made, tasks we owe them, requests they've made, or follow-ups pending. Include dates. If nothing is open, say so.

## Recent Activity
Brief summary of last 3-5 interactions — date, type, and key takeaway from each.

## Strategic Notes
Broader context: their organization's recent moves, industry dynamics, or relationship angles that could be leveraged. Search for recent news about them and their organization.`
}

interface InteractionSummary {
  type: string
  subject: string
  body?: string
  occurred_at: string
}

interface TaskSummary {
  title: string
  status: string
  priority: string
  due_date?: string
}

function buildPrepUserContext(
  contact: Contact,
  category: string,
  interactions: InteractionSummary[],
  tasks: TaskSummary[]
): string {
  const existingData = [
    contact.location && `- Location: ${contact.location}`,
    contact.investor_type && `- Investor Type: ${contact.investor_type}`,
    contact.website && `- Website: ${contact.website}`,
    contact.region && `- Region: ${contact.region}`,
    contact.warmth && `- Warmth: ${contact.warmth}`,
    contact.pipeline_stage && `- Pipeline: ${contact.pipeline_stage} (purpose: ${contact.pipeline ?? 'not stated'})`,
    contact.notes && `- Notes: ${contact.notes.slice(0, 500)}`,
  ]
    .filter(Boolean)
    .join('\n')

  // Format interaction history
  let interactionContext = 'No interaction history recorded.'
  if (interactions.length > 0) {
    interactionContext = interactions
      .map((i) => {
        const date = new Date(i.occurred_at).toLocaleDateString()
        const bodyPreview = i.body ? ` — ${i.body.slice(0, 150)}` : ''
        return `- [${date}] ${i.type}: ${i.subject}${bodyPreview}`
      })
      .join('\n')
  }

  // Format open tasks
  let taskContext = 'No open tasks.'
  if (tasks.length > 0) {
    taskContext = tasks
      .map((t) => {
        const due = t.due_date ? ` (due: ${new Date(t.due_date).toLocaleDateString()})` : ''
        return `- [${t.status}] ${t.title}${due} — priority: ${t.priority}`
      })
      .join('\n')
  }

  return `Prepare a meeting brief for this contact. Use our interaction history and task context to make it specific and actionable.

**Target Contact:**
- Name: ${contact.name}
- Organization: ${contact.org}
- Contact Type: ${category.charAt(0).toUpperCase() + category.slice(1)}
${existingData ? `\n**Existing CRM Data:**\n${existingData}` : ''}

**Interaction History (most recent first, up to 20):**
${interactionContext}

**Open Tasks:**
${taskContext}

**Type-Specific Direction:**
This is a ${category} contact. Use the sender context and type-specific guidance from the system prompt to generate SPECIFIC talking points. Do NOT produce generic talking points like "discuss partnership opportunities" — instead reference concrete facts from the sender profile and the interaction history that are relevant to this contact and their organization. Do not invent metrics.

**Research Directive:**
Search for recent news about ${contact.name} and ${contact.org} to include in the Strategic Notes section. Mention anything from the last 3-6 months that would be relevant context for a meeting.`
}

/**
 * Build a single combined prompt for Gemini.
 */
export function buildPrepPrompt(
  contact: Contact,
  category: string,
  interactions: InteractionSummary[],
  tasks: TaskSummary[],
  /** From crm_settings.sender_profile. Omitted means the brief assumes no organization. */
  senderProfile?: string
): string {
  return `${buildPrepSystemContext(category, senderProfile)}\n\n---\n\n${buildPrepUserContext(contact, category, interactions, tasks)}`
}

// ── Response parser ────────────────────────────────────────

export function parsePrepResponse(
  content: string
): { sections: PrepSection[]; summary: string } {
  const sectionRegex = /^## (.+)$/gm
  const sections: PrepSection[] = []
  let summary = ''

  const parts = content.split(sectionRegex)

  for (let i = 1; i < parts.length; i += 2) {
    const title = parts[i].trim()
    const sectionContent = (parts[i + 1] ?? '').trim()

    if (title === 'Summary') {
      summary = sectionContent
    } else {
      sections.push({ title, content: sectionContent })
    }
  }

  return { sections, summary }
}

// ── Interaction body formatter ─────────────────────────────

export function formatPrepBody(
  result: PrepResult,
  contactName: string
): string {
  const lines = [
    `# Meeting Prep: ${contactName}`,
    `**Prepared**: ${new Date(result.preparedAt).toLocaleString()}`,
    `**Model**: ${result.model}`,
    '',
    '---',
    '',
  ]

  if (result.summary) {
    lines.push('## Summary', result.summary, '')
  }

  for (const section of result.sections) {
    lines.push(`## ${section.title}`, section.content, '')
  }

  return lines.join('\n')
}
