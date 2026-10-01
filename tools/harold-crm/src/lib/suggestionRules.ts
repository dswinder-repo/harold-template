import type { Contact, Interaction, Task } from '@/lib/types'

export interface SuggestionRule {
  id: string
  condition: (ctx: SuggestionContext) => boolean
  suggestion: string
  /** Optional: action description for the CTA button */
  action?: string
  /** Icon emoji */
  icon: string
  /** Priority: lower number = higher priority */
  priority: number
}

export interface SuggestionContext {
  contact: Contact
  interactions: Interaction[]
  tasks: Task[]
  categories: string[]
}

function daysSince(dateStr: string | null | undefined): number {
  if (!dateStr) return Infinity
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return Infinity
  return Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24))
}

function latestInteractionDate(interactions: Interaction[]): string | null {
  if (interactions.length === 0) return null
  return interactions.reduce((latest, i) =>
    i.occurred_at > latest ? i.occurred_at : latest,
    interactions[0].occurred_at
  )
}

export const SUGGESTION_RULES: SuggestionRule[] = [
  // ── Overdue tasks ──
  {
    id: 'overdue-task',
    priority: 1,
    icon: '⏰',
    condition: ({ tasks }) =>
      tasks.some((t) => t.status !== 'completed' && t.status !== 'cancelled' && t.due_date && daysSince(t.due_date) > 0),
    suggestion: 'You have overdue tasks for this contact.',
    action: 'Review tasks',
  },

  // ── No interaction in 14+ days ──
  {
    id: 'stale-contact',
    priority: 2,
    icon: '📅',
    condition: ({ interactions }) => {
      const latest = latestInteractionDate(interactions)
      return daysSince(latest) >= 14
    },
    suggestion: 'No interaction logged in over 2 weeks. Schedule a follow-up.',
    action: 'Log interaction',
  },

  // ── Investor: no interaction in 7 days ──
  {
    id: 'investor-stale',
    priority: 3,
    icon: '💰',
    condition: ({ categories, interactions }) => {
      if (!categories.includes('investor')) return false
      const latest = latestInteractionDate(interactions)
      return daysSince(latest) >= 7 && daysSince(latest) < 14
    },
    suggestion: 'Investor contacts need frequent touches. It\'s been over a week.',
    action: 'Send update',
  },

  // ── Hot warmth but no recent meeting ──
  {
    id: 'hot-no-meeting',
    priority: 4,
    icon: '🔥',
    condition: ({ contact, interactions }) => {
      if (contact.warmth !== 'Hot') return false
      const recentMeetings = interactions.filter(
        (i) => i.type === 'meeting' && daysSince(i.occurred_at) <= 30
      )
      return recentMeetings.length === 0
    },
    suggestion: 'This is a hot contact with no meeting in the last 30 days. Book one.',
    action: 'Schedule meeting',
  },

  // ── Pipeline stage stuck 30+ days ──
  {
    id: 'stuck-pipeline',
    priority: 5,
    icon: '🚧',
    condition: ({ contact }) => {
      if (!contact.pipeline_stage || !contact.stage_entered_at) return false
      return daysSince(contact.stage_entered_at) >= 30
    },
    suggestion: 'Pipeline stage hasn\'t changed in 30+ days. Move it forward or add a note.',
    action: 'Update pipeline',
  },

  // ── No email on file ──
  {
    id: 'missing-email',
    priority: 6,
    icon: '✉️',
    condition: ({ contact }) => !contact.email || contact.email.trim() === '',
    suggestion: 'No email address on file. Add one to enable outreach.',
    action: 'Add email',
  },

  // ── No phone on file (active contacts only) ──
  {
    id: 'missing-phone',
    priority: 8,
    icon: '📞',
    condition: ({ contact }) =>
      contact.status === 'active' && (!contact.phone || contact.phone.trim() === ''),
    suggestion: 'Active contact without a phone number. Consider adding one.',
    action: 'Add phone',
  },

  // ── Cold warmth on active contact ──
  {
    id: 'cold-active',
    priority: 7,
    icon: '🧊',
    condition: ({ contact }) =>
      contact.warmth === 'Cold' && contact.status === 'active',
    suggestion: 'This contact is marked Cold but still Active. Consider re-engaging or archiving.',
    action: 'Update status',
  },

  // ── No interactions at all ──
  {
    id: 'no-interactions',
    priority: 9,
    icon: '👋',
    condition: ({ interactions }) => interactions.length === 0,
    suggestion: 'No interactions logged yet. Start building the relationship.',
    action: 'Log first interaction',
  },

  // ── Notes are empty (active/pending contacts) ──
  {
    id: 'empty-notes',
    priority: 10,
    icon: '📝',
    condition: ({ contact }) =>
      (contact.status === 'active' || contact.status === 'pending') &&
      (!contact.notes || contact.notes.trim() === ''),
    suggestion: 'Add notes to capture key context about this contact.',
    action: 'Add notes',
  },
]

/**
 * Evaluate all rules and return the top N matching suggestions, sorted by priority.
 */
export function getSuggestions(
  ctx: SuggestionContext,
  maxResults = 3
): SuggestionRule[] {
  return SUGGESTION_RULES
    .filter((rule) => rule.condition(ctx))
    .sort((a, b) => a.priority - b.priority)
    .slice(0, maxResults)
}
