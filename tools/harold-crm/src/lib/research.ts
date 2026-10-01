import type { Contact } from './types'

// ── Types ──────────────────────────────────────────────────

export interface ResearchSection {
  title: string
  content: string
}

export interface SuggestedUpdate {
  field: string
  currentValue: string
  suggestedValue: string
  confidence: 'high' | 'medium' | 'low'
  source: string
}

export interface Citation {
  url: string
  title: string
}

export interface ResearchResult {
  summary: string
  sections: ResearchSection[]
  suggestedUpdates: SuggestedUpdate[]
  citations: Citation[]
  model: string
  searchedAt: string
}

export interface ResearchResponse {
  success: true
  research: ResearchResult
  interactionId: string
}

export interface ResearchError {
  success: false
  error: string
  code: 'RATE_LIMIT' | 'API_ERROR' | 'AUTH_ERROR' | 'CONTACT_NOT_FOUND' | 'UNKNOWN'
}

export type ResearchAPIResponse = ResearchResponse | ResearchError

// ── Enrichable fields ──────────────────────────────────────

export const ENRICHABLE_FIELDS: Record<string, string> = {
  name: 'Name',
  focus_area: 'Focus Area',
  website: 'Website',
  investor_type: 'Investor Type',
  region: 'Region',
  location: 'Location',
  email: 'Email',
  phone: 'Phone',
  notes: 'Notes',
}

// ── Prompt builders ────────────────────────────────────────

const CATEGORY_SECTIONS: Record<string, string> = {
  investor: 'Investment Thesis & Portfolio',
  founder: 'Company, Traction & Fundraising',
  government: 'Programs & Mandate',
  partner: 'Partnership Potential & Capabilities',
  team: 'Professional Background & Expertise',
  other: 'Professional Background & Expertise',
}

function buildSystemContext(): string {
  return `You are a senior intelligence analyst producing ACTIONABLE INTELLIGENCE BRIEFS. Your job is to research contacts and deliver specific, useful findings — not generic summaries.

ANALYSIS STANDARDS:
- Write like a senior analyst briefing a CEO before a meeting. Be direct, specific, and opinionated.
- Lead every section with the most important insight, not background filler.
- Include specific numbers, dates, names, and amounts wherever available (funding rounds, employee counts, founding year, deal sizes).
- When information is limited, say so honestly rather than padding with generic statements.
- If you find conflicting information, note it. If something is unverified, flag it.

OUTPUT STRUCTURE (use these exact ## headers):

## Summary
2-3 sentences of the most important takeaways. Lead with the strongest insight about this contact.

## Recent News & Activity
What has this person or their organization done in the last 6-12 months? Funding rounds, product launches, personnel changes, partnerships, press mentions. Include dates and specifics. If nothing recent is found, state that clearly.

## Organization Profile
Hard facts: founding year, headcount, funding stage/total raised, headquarters, key products or services, leadership team. For investors: AUM, fund size, vintage. For public bodies: budget, program scope.

## Person Background
Their current role and responsibilities, career trajectory (where they came from), education, board seats, advisory roles. LinkedIn presence. What drives this person professionally?

## [Type-Specific Section]
Deep analysis tailored to the contact type (provided in the request).

## Strategic Relevance
Analyze what makes this contact valuable and how to engage them:
- Their key interests, priorities, and strategic direction
- Notable portfolio companies, partners, programs, or initiatives — name specifics
- Potential entry points for a relationship or collaboration
- Any red flags or concerns
Be specific. "They invest in agritech" is too vague. "They led a $5M Series A for [Company] doing precision agriculture in Brazil" is actionable.

## Suggested CRM Field Updates
Format each on its own line:
- **field_name**: suggested_value | confidence: high/medium/low | source: URL or description

Valid field names: name, focus_area, website, investor_type, region, location, email, phone, notes
- For **name**: ONLY suggest if the current contact name is "TBD" or a placeholder. In that case, identify the best point of contact at the organization and suggest their full name.
- For **notes**: compile the 3-5 most actionable intelligence findings into a concise paragraph (2-4 sentences) that would help someone prepare for a conversation with this contact. Focus on talking points, mutual interests, and relationship angles.
- For **website**: prefer the organization's main website. If not found, a LinkedIn profile URL is acceptable.
- Only suggest updates where you have reasonable confidence.
- ALWAYS include a source URL or description after "source:". Never leave it empty.
- If no updates are warranted for a field, skip it.`
}

function buildUserContext(contact: Contact, category: string): string {
  const categorySection = CATEGORY_SECTIONS[category] ?? CATEGORY_SECTIONS.other

  const existingData = [
    contact.location && `- Location: ${contact.location}`,
    contact.investor_type && `- Investor Type: ${contact.investor_type}`,
    contact.focus_area && `- Focus Area: ${contact.focus_area}`,
    contact.website && `- Website: ${contact.website}`,
    contact.region && `- Region: ${contact.region}`,
    contact.email && `- Email: ${contact.email}`,
    contact.phone && `- Phone: ${contact.phone}`,
    contact.pipeline_stage && `- Pipeline: ${contact.pipeline_stage} (purpose: ${contact.pipeline ?? 'not stated'})`,
    contact.warmth && `- Warmth: ${contact.warmth}`,
    contact.notes && `- Notes: ${contact.notes.slice(0, 500)}`,
  ]
    .filter(Boolean)
    .join('\n')

  // Detect TBD / placeholder contacts — no specific person, just an org
  const isTBD = /^tbd$/i.test(contact.name?.trim() ?? '') || /^(unknown|n\/a|placeholder|—|-)$/i.test(contact.name?.trim() ?? '')

  const tbdRequest = isTBD
    ? `\n\nCRITICAL — CONTACT IDENTIFICATION: The contact name is currently "${contact.name}" which is a placeholder. This CRM entry represents the organization "${contact.org}" but we haven't identified the right person yet. Your PRIMARY task is to find the best point of contact at this organization — the most relevant decision-maker or relationship owner for a "${category}" contact. Suggest their full name as a **name** field update, along with their email, phone, title, and LinkedIn if findable. Focus the "Person Background" section on this recommended contact.`
    : ''

  // Identify which contact info fields are missing so the AI knows what to look for
  const missingFields: string[] = []
  if (!contact.email) missingFields.push('email address')
  if (!contact.phone) missingFields.push('phone number')
  if (!contact.website) missingFields.push('website or LinkedIn profile URL')

  const contactInfoRequest = missingFields.length > 0
    ? `\n\nCONTACT INFO SEARCH: We are missing: ${missingFields.join(', ')}. Search their public profiles, company team/about pages, professional directories (LinkedIn, Crunchbase, PitchBook), and conference speaker bios. Suggest any discovered contact info as CRM field updates.`
    : ''

  const categoryPrompts: Record<string, string> = {
    investor: `For the "${categorySection}" section, research deeply:
- Investment thesis and sector focus — what exactly do they invest in and why?
- Fund details: AUM, fund size, check size range, stage preference (seed, Series A, growth, etc.)
- Recent deals in the last 12 months — specific company names, amounts, and sectors
- Notable portfolio companies — name specific companies, especially any in related sectors
- Co-investors they frequently partner with
- Geographic focus and any emerging market activity
- LP base or fund structure if publicly known`,

    founder: `For the "${categorySection}" section, research deeply:
- What the company does, for whom, and what makes it different
- Stage and traction: funding raised, investors, revenue or user signals if public
- Recent milestones: launches, hires, partnerships, press in the last 12 months
- The founder's background and prior companies
- What they are likely to need next (capital, customers, hires, partners)`,

    government: `For the "${categorySection}" section, research deeply:
- Specific programs they run: names, budgets, timelines, eligibility criteria
- Geographic engagement: which countries, which sectors, what type of support (grants, TA, trade missions)
- Programs relevant to this contact — specific program names and details
- Recent announcements about new programs, funding allocations, or strategic priorities
- Key people who manage relevant programs
- Success stories or companies they've supported
- Application deadlines or upcoming opportunities`,

    partner: `For the "${categorySection}" section, research deeply:
- Core capabilities: what exactly do they do and for whom?
- Scale: revenue range, employee count, geographic footprint
- Notable projects, clients, or partnerships — name specifics
- Technology stack or methodology if relevant
- Strategic direction: where are they expanding or investing?
- What would make them a strong collaboration partner?`,

    team: `For the "${categorySection}" section, research deeply:
- Deep dive on career trajectory — where did they come from and what did they build?
- Technical expertise and domain knowledge
- Publications, patents, speaking engagements, awards
- Advisory roles, board seats, or side projects
- Professional network — who are they connected to that matters?
- What makes this person uniquely valuable?`,

    other: `For the "${categorySection}" section, research deeply:
- Professional focus, expertise, and current priorities
- Organization details: size, sector, recent activity
- Notable projects, partnerships, or initiatives
- Professional network and industry connections
- What makes this person a valuable contact?`,
  }

  return `Produce an intelligence brief on this contact. Be thorough but prioritize quality over quantity — every paragraph should contain specific, useful information.

**Target Contact:**
- Name: ${contact.name}
- Organization: ${contact.org}
- Contact Type: ${category.charAt(0).toUpperCase() + category.slice(1)}
${existingData ? `\n**Existing CRM Data:**\n${existingData}` : ''}

**Research Directives:**

1. Search comprehensively: check the organization's website, recent press/news, Crunchbase, LinkedIn, industry publications, conference appearances, and any relevant databases.

2. For each section, lead with the strongest finding. Don't pad with generic statements.

3. In the "Organization Profile" section: include founding year, headcount estimate, funding history with amounts, headquarters location, and key leadership beyond the target contact.

4. ${categoryPrompts[category] ?? categoryPrompts.other}

5. In "Strategic Relevance": be SPECIFIC. Name portfolio companies, programs, partnerships, or initiatives. Explain exactly why each is noteworthy and how it could create an entry point for engagement.

6. For "Suggested CRM Field Updates":
   - Always suggest a **notes** update with a 2-4 sentence intelligence summary capturing the key talking points and relationship angles.
   - Update **focus_area** if you can be more specific than what we currently have.
   - Update **location** and **region** if we're missing them.${contactInfoRequest}${tbdRequest}

7. If information is sparse, say so directly. "Limited public information available for this individual" is better than fabricated filler.`
}

/**
 * Build a single combined prompt for Gemini (which prefers a unified prompt
 * over separate system/user messages when using grounding tools).
 */
export function buildResearchPrompt(contact: Contact, category: string): string {
  return `${buildSystemContext()}\n\n---\n\n${buildUserContext(contact, category)}`
}

// ── Response parser ────────────────────────────────────────

export function parseResearchResponse(
  content: string
): { sections: ResearchSection[]; summary: string; suggestedUpdates: SuggestedUpdate[] } {
  // Split on ## headers
  const sectionRegex = /^## (.+)$/gm
  const sections: ResearchSection[] = []
  let summary = ''
  const suggestedUpdates: SuggestedUpdate[] = []

  const parts = content.split(sectionRegex)
  // parts[0] is text before first ##, then alternating: header, content, header, content...

  for (let i = 1; i < parts.length; i += 2) {
    const title = parts[i].trim()
    const sectionContent = (parts[i + 1] ?? '').trim()

    if (title === 'Summary') {
      summary = sectionContent
    } else if (title === 'Suggested CRM Field Updates') {
      // Parse field suggestions
      const lines = sectionContent.split('\n')
      for (const line of lines) {
        // Primary format: **field**: value | confidence: X | source: Y
        // Source may be empty (Gemini sometimes omits it)
        const match = line.match(
          /\*\*(\w+)\*\*:\s*(.+?)\s*\|\s*confidence:\s*(high|medium|low)\s*\|\s*source:\s*(.*)/i
        )
        if (match) {
          const field = match[1]
          // Only allow known enrichable fields
          if (field in ENRICHABLE_FIELDS) {
            suggestedUpdates.push({
              field,
              currentValue: '',
              suggestedValue: match[2].trim(),
              confidence: match[3].toLowerCase() as 'high' | 'medium' | 'low',
              source: match[4].trim() || 'AI research',
            })
          }
        }
      }
    } else {
      sections.push({ title, content: sectionContent })
    }
  }

  return { sections, summary, suggestedUpdates }
}

// ── Interaction body formatter ─────────────────────────────

export function formatResearchBody(
  result: ResearchResult,
  contactName: string
): string {
  const lines = [
    `# AI Research Report: ${contactName}`,
    `**Searched**: ${new Date(result.searchedAt).toLocaleString()}`,
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

  if (result.citations.length > 0) {
    lines.push('---', '', '### Sources')
    result.citations.forEach((c, i) => {
      lines.push(`${i + 1}. [${c.title}](${c.url})`)
    })
  }

  return lines.join('\n')
}
