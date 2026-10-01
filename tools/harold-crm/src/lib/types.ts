// All enum types are strings to support user-defined values via enum_options table
export type CategoryType = string
export type StatusType = string
export type PriorityType = string
export type WarmthType = string
export type InvestorType = string
export type RegionType = string
export type ActionType = 'create' | 'update' | 'delete' | 'status_change' | 'note_added' | 'stage_change'

export interface Contact {
  id: string
  name: string
  org: string
  organization_id: string | null
  /** The contact's ONE type, from the owner's list (the `categories` table). */
  category: string
  status: StatusType
  priority: PriorityType
  location: string
  email: string
  phone: string
  website: string
  notes: string
  /** Hot, Warm, Lukewarm, Cold, or '' (not rated). */
  warmth: WarmthType
  investor_type: InvestorType
  region: RegionType
  focus_area: string
  /** Latest call, email, meeting or message. Kept current by a database trigger. */
  last_contacted_at: string | null
  created_by: string | null
  updated_by: string | null
  created_at: string
  updated_at: string

  // Not columns. Filled in on the client from the contact's open pipeline
  // entries (see lib/pipeline.ts): the furthest-advanced entry's purpose, stage
  // and when it entered that stage. Write pipeline changes to contact_pipelines.
  pipeline?: string | null
  pipeline_stage?: string | null
  stage_entered_at?: string | null
  pipeline_entry_id?: string | null
}

export interface Organization {
  id: string
  name: string
  name_normalized: string
  category: string
  industry: string
  investor_type: InvestorType
  region: RegionType
  notes: string
  website: string
  location: string
  created_by: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
}

// Dynamic category from database
export interface Category {
  id: string
  name: string
  label: string
  color: string
  sort_order: number
  is_default: boolean
  created_by: string | null
  created_at: string
}

// Dynamic enum option from database
export interface EnumOption {
  id: string
  group_name: string
  value: string
  label: string
  sort_order: number
  is_default: boolean
  created_by: string | null
  created_at: string
}

export interface Profile {
  id: string
  email: string
  full_name: string
  avatar_url: string | null
  role: 'admin' | 'member'
  created_at: string
  updated_at: string
}

export interface AuditLogEntry {
  id: string
  contact_id: string | null
  user_id: string | null
  action: ActionType
  field_changed: string | null
  old_value: string | null
  new_value: string | null
  metadata: Record<string, unknown>
  created_at: string
  // Joined relations
  profiles?: Pick<Profile, 'id' | 'full_name' | 'email' | 'avatar_url'>
  contacts?: Pick<Contact, 'id' | 'name' | 'org'>
}

// Default category colors — used as fallback when categories haven't loaded from DB
export const DEFAULT_CATEGORY_COLORS: Record<string, string> = {
  investor: '#DD8452',
  partner: '#F5D623',
  founder: '#55A868',
  team: '#8172B3',
  other: '#937860',
}
// Backwards-compatible alias
export const CATEGORY_COLORS = DEFAULT_CATEGORY_COLORS

export const STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  active: { bg: 'rgba(40,167,69,0.3)', text: '#28a745' },
  pending: { bg: 'rgba(255,193,7,0.3)', text: '#ffc107' },
  cold: { bg: 'rgba(160,160,160,0.3)', text: '#a0a0a0' },
  archived: { bg: 'rgba(100,100,100,0.3)', text: '#666666' },
}

// Safe accessor — returns fallback style for user-defined values not in the map
export function getStatusStyle(status: string) {
  return STATUS_STYLES[status] ?? { bg: 'rgba(160,160,160,0.3)', text: '#a0a0a0' }
}

export const DEFAULT_CATEGORY_LABELS: Record<string, string> = {
  investor: 'Investors',
  partner: 'Partners',
  founder: 'Founders',
  team: 'Team',
  other: 'Other',
}
export const CATEGORY_LABELS = DEFAULT_CATEGORY_LABELS

export const WARMTH_OPTIONS: WarmthType[] = ['', 'Hot', 'Warm', 'Lukewarm', 'Cold']
// Defaults until enum_options loads (seeded by migration 002, editable in Settings).
export const INVESTOR_TYPE_OPTIONS: InvestorType[] = ['', 'VC', 'Angel', 'Family Office', 'PE', 'Corporate', 'Syndicate', 'Impact', 'Other']
export const REGION_OPTIONS: RegionType[] = [
  '', 'North America', 'Latin America', 'Europe', 'Africa', 'Middle East', 'Asia', 'Oceania', 'Global',
]

/** The seven stages of the one pipeline, in order (seeded by migration 001). */
export const PIPELINE_STAGE_ORDER = [
  'Identified', 'Reached Out', 'In Conversation', 'Advancing', 'Committed', 'Active', 'Dormant',
] as const
// Default options — will be overridden by dynamic categories from DB
export const DEFAULT_CATEGORY_OPTIONS: string[] = ['investor', 'partner', 'founder', 'team', 'other']
export const CATEGORY_OPTIONS = DEFAULT_CATEGORY_OPTIONS
export const STATUS_OPTIONS: StatusType[] = ['active', 'pending', 'cold', 'archived']
export const PRIORITY_OPTIONS: PriorityType[] = ['high', 'medium', 'low']

// Custom fields (EAV pattern)
export type CustomFieldType = 'text' | 'number' | 'date' | 'select' | 'textarea'

export const CUSTOM_FIELD_TYPE_OPTIONS: { value: CustomFieldType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'select', label: 'Dropdown' },
  { value: 'textarea', label: 'Long Text' },
]

export interface CustomField {
  id: string
  field_name: string
  field_type: CustomFieldType
  options: string[] | null
  created_by: string
  created_at: string
}

export interface CustomFieldValue {
  id: string
  contact_id: string
  field_id: string
  value: string | null
  updated_by: string
  updated_at: string
}

// Interaction Timeline / Communication Log
export type InteractionType = 'call' | 'email' | 'meeting' | 'note' | 'linkedin' | 'other'

export const INTERACTION_TYPES: { value: InteractionType; label: string; icon: string }[] = [
  { value: 'call',     label: 'Call',     icon: '\u{1F4DE}' },
  { value: 'email',    label: 'Email',    icon: '\u2709\uFE0F' },
  { value: 'meeting',  label: 'Meeting',  icon: '\u{1F91D}' },
  { value: 'note',     label: 'Note',     icon: '\u{1F4DD}' },
  { value: 'linkedin', label: 'LinkedIn', icon: '\u{1F517}' },
  { value: 'other',    label: 'Other',    icon: '\u{1F4AC}' },
]

export interface InteractionAttachment {
  name: string
  url: string
  type: string
  size: number
}

export interface Interaction {
  id: string
  contact_id: string
  user_id: string | null
  type: InteractionType
  subject: string
  body: string
  occurred_at: string
  created_at: string
  updated_at: string
  attachments?: InteractionAttachment[]
  // Joined relations
  profiles?: Pick<Profile, 'id' | 'full_name' | 'email' | 'avatar_url'>
}

// Tasks & Follow-up Reminders
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled'
export type TaskPriority = 'high' | 'medium' | 'low'

export const TASK_STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: 'pending',     label: 'Pending' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed',   label: 'Completed' },
  { value: 'cancelled',   label: 'Cancelled' },
]

export const TASK_PRIORITY_STYLES: Record<string, { color: string; bg: string }> = {
  high:   { color: '#C44E52', bg: 'rgba(196,78,82,0.2)' },
  medium: { color: '#ffc107', bg: 'rgba(255,193,7,0.2)' },
  low:    { color: '#a0a0a0', bg: 'rgba(160,160,160,0.2)' },
}

// Safe accessor — returns fallback style for user-defined priority values
export function getTaskPriorityStyle(priority: string) {
  return TASK_PRIORITY_STYLES[priority] ?? { color: '#a0a0a0', bg: 'rgba(160,160,160,0.2)' }
}

export interface Task {
  id: string
  contact_id: string | null
  assigned_to: string | null
  created_by: string | null
  title: string
  description: string
  status: TaskStatus
  priority: TaskPriority
  due_date: string | null
  completed_at: string | null
  archived_at: string | null
  created_at: string
  updated_at: string
  // Joined relations
  profiles?: Pick<Profile, 'id' | 'full_name' | 'email' | 'avatar_url'>
  contacts?: Pick<Contact, 'id' | 'name' | 'org'>
}

// Notifications
export type NotificationType = 'overdue_task' | 'due_today' | 'due_tomorrow' | 'stale_contact' | 'stuck_pipeline' | 'follow_up_storm' | 'warmth_decay'
export type NotificationSeverity = 'critical' | 'warning' | 'info'

export const NOTIFICATION_TYPE_META: Record<NotificationType, { label: string; icon: string }> = {
  overdue_task:    { label: 'Overdue Task',    icon: '\u23F0' },
  due_today:       { label: 'Due Today',       icon: '\u{1F4C5}' },
  due_tomorrow:    { label: 'Due Tomorrow',    icon: '\u{1F4C5}' },
  stale_contact:   { label: 'Stale Contact',   icon: '\u{1F4A4}' },
  stuck_pipeline:  { label: 'Stuck Pipeline',  icon: '\u{1F6A7}' },
  follow_up_storm: { label: 'Follow-up Storm', icon: '\u26A1' },
  warmth_decay:    { label: 'Warmth Decay',    icon: '\u{1F4C9}' },
}

// ── Relationship Decay ─────────────────────────────────────

export interface WarmthDecayThreshold {
  alertDays: number
  decayDays: number
  decaysTo: WarmthType
}

export const WARMTH_DECAY_THRESHOLDS: Record<string, WarmthDecayThreshold> = {
  Hot:       { alertDays: 14, decayDays: 30, decaysTo: 'Warm' },
  Warm:      { alertDays: 21, decayDays: 45, decaysTo: 'Lukewarm' },
  Lukewarm:  { alertDays: 30, decayDays: 60, decaysTo: 'Cold' },
}

export const REENGAGEMENT_SUGGESTIONS: Record<string, string> = {
  investor: 'Share an update or recent traction',
  partner: 'Propose a sync call or share a relevant opportunity',
  founder: 'Ask what they are heads-down on and offer something useful',
  team: 'Catch up on what they are working on',
  default: 'Send a brief check-in message',
}

export interface Notification {
  id: string
  user_id: string
  type: NotificationType
  title: string
  body: string
  contact_id: string | null
  task_id: string | null
  severity: NotificationSeverity
  read: boolean
  dismissed: boolean
  created_at: string
  // Joined relations
  contacts?: Pick<Contact, 'id' | 'name' | 'org'>
}

// Toast notifications
export type ToastType = 'success' | 'error' | 'warning' | 'info'

export interface Toast {
  id: string
  title: string
  type: ToastType
  duration?: number
  undo?: () => void
  progress?: number      // 0–100; renders SVG progress ring when set
  showSpinner?: boolean  // indeterminate spinning ring (used when no progress value)
}

// Multi-category junction
export interface ContactCategoryRow {
  id: string
  contact_id: string
  category_name: string
  created_at: string
}
