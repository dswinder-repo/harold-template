/**
 * Type-aware outreach email templates.
 *
 * Pure functions — no side-effects, no API calls.
 * Takes contact metadata + sender info and returns { subject, body }.
 *
 * These are scaffolding, not finished emails. Nothing about the sender is assumed:
 * anything the caller does not supply comes out as a visible blank in [square
 * brackets], which is deliberate. A draft that is obviously unfinished gets
 * finished, whereas a draft that is confidently wrong gets sent. Supply senderOrg
 * and oneLiner to fill them in.
 */

export interface OutreachTemplateInput {
  /** Contact name (generic). Aliases: investorName */
  contactName: string
  /** Organization name (generic). Aliases: fundName, orgName */
  orgName: string
  region?: string
  investorType?: string
  senderName: string
  senderEmail: string

  /** Who the sender is writing on behalf of. Left blank rather than guessed. */
  senderOrg?: string
  /** One sentence on what the sender does, used as the body's opening context. */
  oneLiner?: string
  /** Up to four short proof points. Omitted entirely when not supplied. */
  highlights?: string[]
  /** What the sender wants from this contact, e.g. "raising a seed round". */
  ask?: string

  // Backward-compat aliases (used by existing callers)
  investorName?: string
  fundName?: string
}

export interface OutreachEmail {
  subject: string
  body: string
}

/** Resolve name/org from generic or aliased fields */
function resolveName(input: OutreachTemplateInput): string {
  return input.contactName || input.investorName || ''
}
function resolveOrg(input: OutreachTemplateInput): string {
  return input.orgName || input.fundName || ''
}

/** A blank the writer has to fill in, and can see they have to fill in. */
function blank(value: string | undefined, placeholder: string): string {
  const v = (value ?? '').trim()
  return v || `[${placeholder}]`
}

function senderOrg(input: OutreachTemplateInput): string {
  return blank(input.senderOrg, 'your company')
}

function firstNameOf(input: OutreachTemplateInput): string {
  return resolveName(input)?.split(' ')[0] || 'there'
}

/** The "what we do" paragraph. One sentence, supplied or blank. */
function context(input: OutreachTemplateInput): string {
  return input.oneLiner?.trim() || `[One sentence on what ${senderOrg(input)} does.]`
}

/** Proof points. Nothing invented: if none are supplied, the section is left out. */
function highlights(input: OutreachTemplateInput): string {
  const items = (input.highlights ?? []).map((h) => h.trim()).filter(Boolean)
  if (!items.length) return ''
  return '\n\n' + items.slice(0, 4).map((h) => `• ${h}`).join('\n')
}

function signoff(input: OutreachTemplateInput): string {
  return `Best,\n${blank(input.senderName, 'your name')}\n${senderOrg(input)}`
}

// ===========================================================================
// INVESTOR
// ===========================================================================

function pickInvestorHook(input: OutreachTemplateInput): string {
  const fund = resolveOrg(input)
  const rg = (input.region ?? '').toLowerCase()

  if (fund && rg) {
    return `Given ${fund}’s focus on ${input.region}, I wanted to share what we’re building.`
  }
  if (fund) {
    return `I came across ${fund} and thought there could be strong alignment with what we’re building.`
  }
  return 'I wanted to reach out because I believe there may be strong alignment with your investment focus.'
}

export function generateInvestorOutreach(input: OutreachTemplateInput): OutreachEmail {
  const ask = input.ask?.trim() || '[what you are raising, and why now]'
  return {
    subject: `${senderOrg(input)} — introduction`,
    body: `Hi ${firstNameOf(input)},

${pickInvestorHook(input)}

${context(input)}${highlights(input)}

We’re currently ${ask}. I’d welcome the chance to share more. Would you have 30 minutes for a conversation?

${signoff(input)}`,
  }
}

// ===========================================================================
// GOVERNMENT AND PUBLIC PROGRAMS
// ===========================================================================

function pickAgencyHook(input: OutreachTemplateInput): string {
  const org = resolveOrg(input)
  if (org) {
    return `I wanted to reach out to explore potential areas of collaboration with ${org}.`
  }
  return 'I’m reaching out to explore how our work might support your programs.'
}

export function generateAgencyOutreach(input: OutreachTemplateInput): OutreachEmail {
  return {
    subject: `${senderOrg(input)} — potential collaboration`,
    body: `Hi ${firstNameOf(input)},

${pickAgencyHook(input)}

${context(input)}${highlights(input)}

I’d love to explore how we might support ${resolveOrg(input) || 'your'} programs, or connect you with others doing related work. Would you have 30 minutes?

${signoff(input)}`,
  }
}

// ===========================================================================
// PARTNERS
// ===========================================================================

function pickPartnerHook(input: OutreachTemplateInput): string {
  const org = resolveOrg(input)
  if (org) {
    return `I wanted to reach out to explore potential synergies between ${org} and what we’re building.`
  }
  return 'I’m reaching out to explore a potential partnership.'
}

export function generatePartnerOutreach(input: OutreachTemplateInput): OutreachEmail {
  return {
    subject: `${senderOrg(input)} — partnership opportunity`,
    body: `Hi ${firstNameOf(input)},

${pickPartnerHook(input)}

${context(input)}${highlights(input)}

I’d like to discuss how a partnership could create value on both sides. Would you have 30 minutes for a conversation?

${signoff(input)}`,
  }
}

// ===========================================================================
// GENERIC (fallback for any other type)
// ===========================================================================

export function generateGenericOutreach(input: OutreachTemplateInput): OutreachEmail {
  const org = resolveOrg(input)
  const hook = org
    ? `I wanted to reach out to introduce what we’re building and explore whether there might be an opportunity to connect with ${org}.`
    : 'I wanted to introduce what we’re building and explore whether there might be an opportunity to connect.'

  return {
    subject: `${senderOrg(input)} — introduction`,
    body: `Hi ${firstNameOf(input)},

${hook}

${context(input)}${highlights(input)}

I’d welcome the chance to share more. Would you have a few minutes for a conversation?

${signoff(input)}`,
  }
}

// ===========================================================================
// ROUTER — dispatches to the right template based on contact type
// ===========================================================================

export function generateOutreach(input: OutreachTemplateInput, category?: string): OutreachEmail {
  switch (category?.toLowerCase()) {
    case 'investor':
      return generateInvestorOutreach(input)
    case 'government':
      return generateAgencyOutreach(input)
    case 'partner':
      return generatePartnerOutreach(input)
    default:
      return generateGenericOutreach(input)
  }
}
