/**
 * Who "we" are when the app drafts outreach or prepares a meeting brief.
 *
 * Stored in crm_settings under the key `sender_profile` and edited in
 * Settings > Sender Profile. Every field is optional: with nothing set, drafts
 * leave visible [blanks] and briefs reason from the contact alone.
 */
export interface SenderProfile {
  /** The organization you write on behalf of. */
  org?: string
  /** One sentence on what it does; opens outreach drafts. */
  one_liner?: string
  /** Longer context for meeting briefs: what you do, current priorities, what you are asking for. */
  text?: string
}

export const SENDER_PROFILE_KEY = 'sender_profile'

/** The profile as prompt text for meeting prep, or undefined when nothing is set. */
export function senderProfileAsPrompt(p: SenderProfile | null | undefined): string | undefined {
  if (!p) return undefined
  const parts = [
    p.org?.trim() && `Organization: ${p.org.trim()}`,
    p.one_liner?.trim() && `What it does: ${p.one_liner.trim()}`,
    p.text?.trim(),
  ].filter(Boolean)
  return parts.length ? `ABOUT THE SENDER:\n${parts.join('\n')}` : undefined
}
