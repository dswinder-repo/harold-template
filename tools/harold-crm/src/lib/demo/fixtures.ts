/**
 * Invented data for demo mode (pnpm dev:demo).
 *
 * Every person, company, email address and conversation below is made up, and
 * every domain is a reserved .example domain. Nothing is read from or written to
 * a database while demo mode is on.
 *
 * The shape mirrors the real schema: one type per contact, any number of labels,
 * and pipeline entries that each carry a purpose and a stage.
 */

const now = Date.now()
const days = (n: number) => new Date(now - n * 86_400_000).toISOString()

export interface DemoTables {
  [table: string]: Record<string, unknown>[]
}

const contacts = [
  {
    id: 'd1', name: 'Maya Lindqvist', org: 'Northhaven Capital',
    category: 'investor', warmth: 'Hot', status: 'active', priority: 'high',
    location: 'Stockholm, Sweden', region: 'Europe', email: 'maya@northhaven.example',
    phone: '+46 8 555 0142', website: 'northhaven.example', investor_type: 'VC',
    focus_area: 'Climate infrastructure',
    notes: 'Led our last round. Wants the updated model before the partner meeting.',
    last_contacted_at: days(3), created_at: days(210), updated_at: days(3),
  },
  {
    id: 'd2', name: 'Tobias Renner', org: 'Meridian Freight',
    category: 'partner', warmth: 'Warm', status: 'active', priority: 'medium',
    location: 'Hamburg, Germany', region: 'Europe', email: 't.renner@meridianfreight.example',
    phone: '+49 40 555 0198', website: 'meridianfreight.example',
    focus_area: 'Logistics',
    notes: 'Distribution trial scoped for Q1. Legal review is the long pole.',
    last_contacted_at: days(9), created_at: days(160), updated_at: days(9),
  },
  {
    id: 'd3', name: 'Priya Raghunathan', org: 'Sundial Systems',
    category: 'founder', warmth: 'Warm', status: 'active', priority: 'medium',
    location: 'Bengaluru, India', region: 'Asia', email: 'priya@sundial.example',
    focus_area: 'Developer tooling',
    notes: 'Introduced by Maya. Raising a seed; asked for a warm intro to Northhaven.',
    last_contacted_at: days(16), created_at: days(95), updated_at: days(16),
  },
  {
    id: 'd4', name: 'Awa Diallo', org: 'Port City Trade Office',
    category: 'partner', warmth: 'Lukewarm', status: 'active', priority: 'medium',
    location: 'Dakar, Senegal', region: 'Africa', email: 'a.diallo@portcity.example',
    focus_area: 'Trade facilitation',
    notes: 'Met at the corridor summit. Offered introductions to local distributors on their February delegation.',
    last_contacted_at: days(34), created_at: days(70), updated_at: days(34),
  },
  {
    id: 'd5', name: 'Daniel Okonkwo', org: 'Brightwater Advisors',
    category: 'partner', warmth: 'Hot', status: 'active', priority: 'high',
    location: 'Toronto, Canada', region: 'North America', email: 'd.okonkwo@brightwater.example',
    focus_area: 'Corporate finance',
    notes: 'Co-hosting the March roundtable. Owes us the speaker list.',
    last_contacted_at: days(2), created_at: days(140), updated_at: days(2),
  },
  {
    id: 'd6', name: 'Elena Vasquez', org: 'Cardinal Ventures',
    category: 'investor', warmth: 'Warm', status: 'active', priority: 'medium',
    location: 'Austin, TX', region: 'North America', email: 'elena@cardinalvc.example',
    investor_type: 'VC', focus_area: 'B2B software',
    notes: 'Knows everyone in the Austin scene. Offered to host a dinner for the launch.',
    last_contacted_at: days(21), created_at: days(180), updated_at: days(21),
  },
  {
    id: 'd7', name: 'Hiroshi Nakamura', org: 'Kestrel Industrial',
    category: 'partner', warmth: 'Lukewarm', status: 'pending', priority: 'low',
    location: 'Osaka, Japan', region: 'Asia', email: 'h.nakamura@kestrel.example',
    focus_area: 'Manufacturing',
    notes: 'Could carry us through their dealer network. Waiting on their internal budget cycle.',
    last_contacted_at: days(41), created_at: days(60), updated_at: days(41),
  },
  {
    id: 'd8', name: 'Fiona Brennan', org: 'Lantern Group',
    category: 'other', warmth: 'Warm', status: 'active', priority: 'medium',
    location: 'Dublin, Ireland', region: 'Europe', email: 'fiona@lanterngroup.example',
    notes: 'Excellent connector. Has sent two head-of-sales candidates already.',
    last_contacted_at: days(12), created_at: days(120), updated_at: days(12),
  },
  {
    id: 'd9', name: 'Samuel Adeyemi', org: 'Harbour & Finch',
    category: 'other', warmth: 'Cold', status: 'active', priority: 'low',
    location: 'London, UK', region: 'Europe', email: 's.adeyemi@harbourfinch.example',
    notes: 'Recommended for cross-border work. No contact yet.',
    created_at: days(30), updated_at: days(30),
  },
  {
    id: 'd10', name: 'Clara Okafor', org: 'Vantage Analytics',
    category: 'founder', warmth: 'Hot', status: 'active', priority: 'high',
    location: 'Accra, Ghana', region: 'Africa', email: 'clara@vantage.example',
    focus_area: 'Data infrastructure',
    notes: 'Evaluating a pilot and open to reselling us. Two separate threads.',
    last_contacted_at: days(1), created_at: days(88), updated_at: days(1),
  },
  {
    id: 'd11', name: 'Marcus Webb', org: 'Independent',
    category: 'other', warmth: 'Warm', status: 'active', priority: 'medium',
    location: 'Denver, CO', region: 'North America', email: 'marcus.webb@example.com',
    notes: 'Quarterly cadence suits this one. Nothing is wrong when it is quiet.',
    last_contacted_at: days(47), created_at: days(300), updated_at: days(47),
  },
  {
    id: 'd12', name: 'Ines Moreau', org: 'Calder Foundation',
    category: 'partner', warmth: 'Warm', status: 'active', priority: 'medium',
    location: 'Geneva, Switzerland', region: 'Europe', email: 'i.moreau@calder.example',
    focus_area: 'Grant programs',
    notes: 'Weighing whether to sponsor the March roundtable. Decides at their April board.',
    last_contacted_at: days(18), created_at: days(75), updated_at: days(18),
  },
]

/** Labels are independent of type, and most contacts have none. */
const contact_categories = [
  { id: 'l1', contact_id: 'd4', category_name: 'government', created_at: days(70) },
  { id: 'l2', contact_id: 'd5', category_name: 'advisor', created_at: days(140) },
  { id: 'l3', contact_id: 'd10', category_name: 'customer-prospect', created_at: days(40) },
  { id: 'l4', contact_id: 'd12', category_name: 'government', created_at: days(75) },
  { id: 'l5', contact_id: 'd8', category_name: 'advisor', created_at: days(120) },
  { id: 'l6', contact_id: 'd1', category_name: 'board', created_at: days(200) },
]

const categories = [
  { id: 'c1', name: 'investor', label: 'Investors', color: '#DD8452', sort_order: 1, is_default: true },
  { id: 'c2', name: 'partner', label: 'Partners', color: '#F5D623', sort_order: 2, is_default: true },
  { id: 'c3', name: 'founder', label: 'Founders', color: '#55A868', sort_order: 3, is_default: true },
  { id: 'c4', name: 'team', label: 'Team', color: '#8172B3', sort_order: 4, is_default: true },
  { id: 'c5', name: 'other', label: 'Other', color: '#937860', sort_order: 5, is_default: true },
]

/** One pipeline. A contact may hold more than one entry, each with its own purpose. */
const contact_pipelines = [
  { id: 'p1', contact_id: 'd4', purpose: 'finding a distribution partner', stage: 'Identified', entered_at: days(34) },
  { id: 'p2', contact_id: 'd7', purpose: 'finding a distribution partner', stage: 'Reached Out', entered_at: days(41) },
  { id: 'p3', contact_id: 'd10', purpose: 'finding a distribution partner', stage: 'In Conversation', entered_at: days(9) },
  { id: 'p4', contact_id: 'd2', purpose: 'finding a distribution partner', stage: 'Advancing', entered_at: days(30) },
  { id: 'p5', contact_id: 'd5', purpose: 'co-hosting the March roundtable', stage: 'Committed', entered_at: days(14) },
  { id: 'p6', contact_id: 'd12', purpose: 'co-hosting the March roundtable', stage: 'In Conversation', entered_at: days(18) },
  { id: 'p7', contact_id: 'd6', purpose: 'launching in Austin', stage: 'In Conversation', entered_at: days(21) },
  { id: 'p8', contact_id: 'd8', purpose: 'hiring a head of sales', stage: 'In Conversation', entered_at: days(12) },
  { id: 'p9', contact_id: 'd10', purpose: 'closing a data pilot', stage: 'In Conversation', entered_at: days(9) },
  { id: 'p10', contact_id: 'd1', purpose: 'raising the Series A', stage: 'Advancing', entered_at: days(22) },
]

const pipeline_stages = [
  { id: 's1', stage_name: 'Identified', stage_order: 1, default_cadence: 'monthly' },
  { id: 's2', stage_name: 'Reached Out', stage_order: 2, default_cadence: 'weekly' },
  { id: 's3', stage_name: 'In Conversation', stage_order: 3, default_cadence: 'weekly' },
  { id: 's4', stage_name: 'Advancing', stage_order: 4, default_cadence: 'weekly' },
  { id: 's5', stage_name: 'Committed', stage_order: 5, default_cadence: 'biweekly' },
  { id: 's6', stage_name: 'Active', stage_order: 6, default_cadence: 'monthly' },
  { id: 's7', stage_name: 'Dormant', stage_order: 7, default_cadence: 'quarterly' },
]

const interactions = [
  { id: 'i1', contact_id: 'd1', type: 'meeting', subject: 'Partner meeting prep',
    body: 'Walked through the revised model. Maya wants the cohort retention slide split out before she takes it to the partnership. Asked what changed in the pipeline since August.',
    occurred_at: days(3), created_at: days(3) },
  { id: 'i2', contact_id: 'd1', type: 'email', subject: 'Updated model sent',
    body: 'Sent the model with the new cohort tab. Flagged the two assumptions we are least sure about rather than burying them.',
    occurred_at: days(8), created_at: days(8) },
  { id: 'i3', contact_id: 'd1', type: 'call', subject: 'Intro call',
    body: 'First substantive conversation. Thesis fit is on infrastructure rather than the application layer, which is the angle to lead with.',
    occurred_at: days(26), created_at: days(26) },
  { id: 'i4', contact_id: 'd1', type: 'note', subject: 'Introduced by Fiona Brennan',
    body: 'Fiona offered the introduction unprompted after the Dublin event.',
    occurred_at: days(40), created_at: days(40) },
  { id: 'i5', contact_id: 'd2', type: 'meeting', subject: 'Distribution terms',
    body: 'Agreed a three-month distribution trial on the Hamburg route. Legal review is the long pole; Tobias is chasing internally.',
    occurred_at: days(9), created_at: days(9) },
  { id: 'i6', contact_id: 'd10', type: 'call', subject: 'Two threads, kept separate',
    body: 'Clara wants to pilot and is also open to reselling us. Agreed to keep the conversations apart so neither holds up the other.',
    occurred_at: days(1), created_at: days(1) },
  { id: 'i7', contact_id: 'd5', type: 'email', subject: 'Roundtable logistics',
    body: 'Venue confirmed. Still waiting on the speaker list from Daniel.',
    occurred_at: days(2), created_at: days(2) },
]

const tasks = [
  { id: 't1', contact_id: 'd1', title: 'Send cohort retention breakdown', status: 'pending',
    priority: 'high', due_date: new Date(now + 2 * 86_400_000).toISOString().slice(0, 10), created_at: days(3) },
  { id: 't2', contact_id: 'd2', title: 'Chase legal review on distribution terms', status: 'in_progress',
    priority: 'medium', due_date: new Date(now + 5 * 86_400_000).toISOString().slice(0, 10), created_at: days(9) },
  { id: 't3', contact_id: 'd5', title: 'Collect speaker list for roundtable', status: 'pending',
    priority: 'high', due_date: new Date(now - 1 * 86_400_000).toISOString().slice(0, 10), created_at: days(6) },
  { id: 't4', contact_id: 'd1', title: 'Book follow-up for after partner meeting', status: 'completed',
    priority: 'medium', due_date: new Date(now - 4 * 86_400_000).toISOString().slice(0, 10), created_at: days(12) },
]

const audit_log = [
  { id: 'a1', user_id: 'u1', contact_id: 'd10', action: 'update', field_name: 'warmth',
    old_value: 'Warm', new_value: 'Hot', created_at: days(1) },
  { id: 'a2', user_id: 'u1', contact_id: 'd5', action: 'create', field_name: null,
    old_value: null, new_value: null, created_at: days(2) },
  { id: 'a3', user_id: 'u1', contact_id: 'd1', action: 'update', field_name: 'status',
    old_value: 'pending', new_value: 'active', created_at: days(3) },
  { id: 'a4', user_id: 'u1', contact_id: 'd2', action: 'update', field_name: 'notes',
    old_value: null, new_value: 'Distribution trial scoped', created_at: days(9) },
  { id: 'a5', user_id: 'u1', contact_id: 'd12', action: 'create', field_name: null,
    old_value: null, new_value: null, created_at: days(18) },
]

export const DEMO_TABLES: DemoTables = {
  contacts,
  contact_categories,
  categories,
  contact_pipelines,
  pipeline_stages,
  interactions,
  tasks,
  enum_options: [
    { id: 'e1', group_name: 'label', value: 'board', label: 'board', sort_order: 1, is_default: false },
    { id: 'e2', group_name: 'label', value: 'customer-prospect', label: 'customer-prospect', sort_order: 2, is_default: false },
    { id: 'e3', group_name: 'label', value: 'advisor', label: 'advisor', sort_order: 3, is_default: false },
    { id: 'e4', group_name: 'label', value: 'government', label: 'government', sort_order: 4, is_default: false },
    { id: 'e5', group_name: 'label', value: 'press', label: 'press', sort_order: 5, is_default: false },
  ],
  custom_fields: [],
  contact_custom_values: [],
  audit_log: audit_log,
  notifications: [],
  crm_settings: [],
  user_preferences: [],
  profiles: [{ id: 'u1', email: 'demo@example.com', full_name: 'Demo User', role: 'admin' }],
}

export const DEMO_USER = {
  id: 'u1',
  email: 'demo@example.com',
  user_metadata: { full_name: 'Demo User' },
  app_metadata: {},
  aud: 'authenticated',
  created_at: days(365),
}
