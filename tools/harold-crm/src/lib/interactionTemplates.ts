import type { InteractionType } from '@/lib/types'

export interface InteractionTemplate {
  id: string
  name: string
  category: 'investor' | 'partner' | 'founder' | 'general'
  type: InteractionType
  subject: string
  body: string
}

/**
 * Built-in interaction templates organized by contact category.
 * Placeholders: {{contact_name}}, {{org}}, {{user_name}}
 */
export const INTERACTION_TEMPLATES: InteractionTemplate[] = [
  // ── Investor Templates ──────────────────────────────────────
  {
    id: 'inv-update',
    name: 'Investor Update',
    category: 'investor',
    type: 'email',
    subject: 'Monthly Update — {{org}}',
    body: `Hi {{contact_name}},

Hope you're well. Here's a quick update on where things stand:

**Key Metrics:**
- Revenue:
- Users:
- Burn rate:

**Wins:**
-

**Challenges:**
-

**Asks:**
-

Happy to jump on a call if you'd like to discuss. Thanks for the continued support.

Best,
{{user_name}}`,
  },
  {
    id: 'inv-followup',
    name: 'Post-Meeting Follow-Up',
    category: 'investor',
    type: 'email',
    subject: 'Great connecting — next steps',
    body: `Hi {{contact_name}},

Thanks for taking the time to meet today. Really enjoyed the conversation about {{org}}'s thesis and how it aligns with what we're building.

As discussed, I'll send over:
-
-

Looking forward to continuing the dialogue. Let me know if any questions come up in the meantime.

Best,
{{user_name}}`,
  },
  {
    id: 'inv-call-notes',
    name: 'Investor Call Notes',
    category: 'investor',
    type: 'call',
    subject: 'Call with {{contact_name}}',
    body: `**Call with {{contact_name}} ({{org}})**

**Topics discussed:**
-

**Their questions/concerns:**
-

**Action items:**
- [ ]
- [ ]

**Next step:** `,
  },

  // ── Partner templates: public bodies and programs ──────────
  {
    id: 'program-intro',
    name: 'Program / Agency Introduction',
    category: 'partner',
    type: 'email',
    subject: 'Introduction — exploring {{org}} partnership',
    body: `Hi {{contact_name}},

I'm reaching out to explore potential partnership opportunities with {{org}}. We're building in the [sector] space and are actively looking at [region] as a key market.

Would love to learn more about:
- Programs or incentives available for companies like ours
- Upcoming events or delegations we should know about
- How {{org}} typically works with growing companies

Would you have 20 minutes this week or next for a quick intro call?

Best,
{{user_name}}`,
  },
  {
    id: 'event-debrief',
    name: 'Event/Trade Mission Debrief',
    category: 'general',
    type: 'note',
    subject: 'Debrief: [Event Name]',
    body: `**Event:** [Name]
**Date:**
**Contacts met through {{org}}:**
-

**Key takeaways:**
-

**Follow-ups needed:**
- [ ]
- [ ]

**Quality of connections:** ⭐⭐⭐☆☆`,
  },

  // ── Partner Templates ───────────────────────────────────────
  {
    id: 'partner-check-in',
    name: 'Partner Check-In',
    category: 'partner',
    type: 'call',
    subject: 'Quarterly check-in with {{contact_name}}',
    body: `**Check-in: {{contact_name}} @ {{org}}**

**Partnership status:**
- Current engagement:
- Revenue/value:

**Discussion points:**
-

**Their updates:**
-

**Our updates to share:**
-

**Action items:**
- [ ]
- [ ] `,
  },
  {
    id: 'partner-proposal',
    name: 'Partnership Proposal',
    category: 'partner',
    type: 'email',
    subject: 'Partnership opportunity — {{org}}',
    body: `Hi {{contact_name}},

I wanted to follow up on our recent conversation about working together. After thinking through the alignment between our teams, here's a rough proposal:

**What we bring:**
-

**What we'd love from {{org}}:**
-

**Proposed structure:**
-

**Timeline:**
-

Would love to get your thoughts. Happy to refine this together.

Best,
{{user_name}}`,
  },

  // ── General Templates ───────────────────────────────────────
  {
    id: 'gen-intro-email',
    name: 'Warm Introduction',
    category: 'general',
    type: 'email',
    subject: 'Introduction — {{user_name}} ↔ {{contact_name}}',
    body: `Hi {{contact_name}},

[Mutual connection] suggested I reach out. I'm {{user_name}}, and I'm working on [brief description].

I'd love to connect because:
-

Would you have 15-20 minutes for a quick chat? Happy to work around your schedule.

Best,
{{user_name}}`,
  },
  {
    id: 'gen-followup',
    name: 'General Follow-Up',
    category: 'general',
    type: 'email',
    subject: 'Following up',
    body: `Hi {{contact_name}},

Wanted to follow up on our conversation from [date/event].

A few things I mentioned I'd share:
-

Let me know if you have any questions or if there's anything else I can help with.

Best,
{{user_name}}`,
  },
  {
    id: 'gen-meeting-notes',
    name: 'Meeting Notes',
    category: 'general',
    type: 'meeting',
    subject: 'Meeting with {{contact_name}}',
    body: `**Meeting: {{contact_name}} ({{org}})**
**Date:**
**Location/Format:**

**Agenda:**
-

**Discussion notes:**
-

**Decisions made:**
-

**Action items:**
- [ ]
- [ ]

**Next meeting:** `,
  },
  {
    id: 'gen-linkedin',
    name: 'LinkedIn Outreach',
    category: 'general',
    type: 'linkedin',
    subject: 'LinkedIn message to {{contact_name}}',
    body: `Connected with {{contact_name}} on LinkedIn.

**Context:**
**Message sent:**

**Response:** [pending]`,
  },
]

/** Get templates filtered by category, with 'general' always included */
export function getTemplatesForCategory(category?: string): InteractionTemplate[] {
  if (!category) return INTERACTION_TEMPLATES
  return INTERACTION_TEMPLATES.filter(
    (t) => t.category === category || t.category === 'general'
  )
}

/** Replace placeholders in template text */
export function fillTemplate(
  text: string,
  vars: { contact_name?: string; org?: string; user_name?: string }
): string {
  let result = text
  if (vars.contact_name) result = result.replace(/\{\{contact_name\}\}/g, vars.contact_name)
  if (vars.org) result = result.replace(/\{\{org\}\}/g, vars.org)
  if (vars.user_name) result = result.replace(/\{\{user_name\}\}/g, vars.user_name)
  return result
}

/** Category display info */
export const TEMPLATE_CATEGORY_META: Record<string, { label: string; icon: string }> = {
  investor: { label: 'Investor', icon: '💰' },
  partner: { label: 'Partner', icon: '🤝' },
  founder: { label: 'Founder', icon: '🚀' },
  general: { label: 'General', icon: '📋' },
}
