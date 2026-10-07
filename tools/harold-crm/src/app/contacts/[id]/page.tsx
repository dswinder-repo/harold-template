'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import AuthGuard from '@/components/AuthGuard'
import Header from '@/components/Header'
import ActivityFeed from '@/components/ActivityFeed'
import AddFieldModal from '@/components/AddFieldModal'
import MergeContactModal from '@/components/MergeContactModal'
import { useAuth } from '@/hooks/useAuth'
import { useAuditLog } from '@/hooks/useAuditLog'
import { useInteractions } from '@/hooks/useInteractions'
import { useTasks } from '@/hooks/useTasks'
import { useCustomFields } from '@/hooks/useCustomFields'
import { useCategories } from '@/hooks/useCategories'
import { useContactCategories } from '@/hooks/useContactCategories'
import { useResearch } from '@/hooks/useResearch'
import { useMeetingPrep } from '@/hooks/useMeetingPrep'
import { createClient } from '@/lib/supabase/client'
import InteractionTimeline from '@/components/InteractionTimeline'
import UnifiedTimeline from '@/components/UnifiedTimeline'
import TaskList from '@/components/TaskList'
import ResearchButton from '@/components/ResearchButton'
import ResearchPanel from '@/components/ResearchPanel'
import PrepButton from '@/components/PrepButton'
import PrepPanel from '@/components/PrepPanel'
import OutreachButton from '@/components/OutreachButton'
import OutreachEmailPanel from '@/components/OutreachEmailPanel'
import ContactDetailSkeleton from '@/components/ContactDetailSkeleton'
import SmartSuggestions from '@/components/SmartSuggestions'
import LabelPicker from '@/components/LabelPicker'
import ContactPipelineEntries from '@/components/ContactPipelineEntries'
import { useToast } from '@/hooks/useToast'
import type { Contact, CustomFieldType } from '@/lib/types'
import { getStatusStyle, WARMTH_OPTIONS } from '@/lib/types'
import { useEnumOptions } from '@/hooks/useEnumOptions'
import { PIPELINE_EMBED, withPipelineSummary } from '@/lib/pipeline'
import { formatRelativeTime, ensureProtocol } from '@/lib/utils'

// Inline editable field component
function EditableField({
  label,
  value,
  field,
  type = 'text',
  options,
  onSave,
}: {
  label: string
  value: string
  field: string
  type?: 'text' | 'select' | 'textarea'
  options?: { value: string; label: string }[]
  onSave: (field: string, value: string) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState(value)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setEditValue(value)
  }, [value])

  const handleSave = async () => {
    if (editValue === value) {
      setEditing(false)
      return
    }
    setSaving(true)
    await onSave(field, editValue)
    setSaving(false)
    setEditing(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && type !== 'textarea') {
      e.preventDefault()
      handleSave()
    }
    if (e.key === 'Escape') {
      setEditValue(value)
      setEditing(false)
    }
  }

  const inputStyle = {
    background: 'var(--bg-input)',
    color: 'var(--text-primary)',
    border: '1px solid var(--border-input)',
  }

  return (
    <div className="mb-4">
      <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
        {label}
      </label>

      {editing ? (
        <div className="flex gap-2">
          {type === 'select' && options ? (
            <select
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={handleSave}
              onKeyDown={handleKeyDown}
              className="flex-1 rounded-md px-3 py-1.5 text-sm outline-none"
              style={inputStyle}
              autoFocus
            >
              {options.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          ) : type === 'textarea' ? (
            <textarea
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={handleSave}
              onKeyDown={handleKeyDown}
              className="flex-1 rounded-md px-3 py-1.5 text-sm outline-none"
              style={inputStyle}
              rows={4}
              autoFocus
            />
          ) : (
            <input
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={handleSave}
              onKeyDown={handleKeyDown}
              className="flex-1 rounded-md px-3 py-1.5 text-sm outline-none"
              style={inputStyle}
              autoFocus
            />
          )}
          {saving && (
            <span className="self-center text-xs" style={{ color: 'var(--text-secondary)' }}>Saving...</span>
          )}
        </div>
      ) : (
        <div
          onClick={() => setEditing(true)}
          className="cursor-pointer rounded-md px-3 py-1.5 text-sm transition-colors"
          style={{
            color: value ? 'var(--text-primary)' : 'var(--text-faint)',
            background: 'transparent',
            minHeight: '32px',
            borderBottom: '1px dashed transparent',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--hover-subtle)'
            e.currentTarget.style.borderBottom = '1px dashed var(--hover-strong)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.borderBottom = '1px dashed transparent'
          }}
        >
          {value || '(click to edit)'}
        </div>
      )}
    </div>
  )
}

const RIGHT_TABS = ['timeline', 'interactions', 'tasks', 'activity'] as const

export default function ContactDetailPage() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const contactId = params.id as string
  const { user, profile } = useAuth()
  const { toast } = useToast()
  const { entries: auditEntries, loading: auditLoading } = useAuditLog({ contactId })
  const {
    interactions,
    loading: interactionsLoading,
    createInteraction,
    updateInteraction,
    deleteInteraction,
  } = useInteractions({ contactId })
  const {
    tasks,
    loading: tasksLoading,
    createTask,
    updateTask,
    updateTaskStatus,
    deleteTask,
  } = useTasks({ contactId })
  const supabase = createClient()
  const { getOptions } = useEnumOptions()

  const { fields: customFields, values: customValues, createField, updateValue, loading: customFieldsLoading } = useCustomFields({ contactId })
  const { categories, getColor, getLabel } = useCategories()
  const {
    getCategoriesForContact,
    toggleCategory,
    setPrimaryCategory,
  } = useContactCategories(contactId)

  const [contact, setContact] = useState<Contact | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [showAddFieldModal, setShowAddFieldModal] = useState(false)
  const [showMergeModal, setShowMergeModal] = useState(false)
  const [showResearchPanel, setShowResearchPanel] = useState(false)
  const [showPrepPanel, setShowPrepPanel] = useState(false)
  const [showOutreachPanel, setShowOutreachPanel] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [lastEditor, setLastEditor] = useState<string | null>(null)
  const [rightTab, setRightTab] = useState<'interactions' | 'tasks' | 'activity' | 'timeline'>('timeline')
  const rightTabRefs = useRef<(HTMLButtonElement | null)[]>([])
  const rightTabContainerRef = useRef<HTMLDivElement>(null)
  const [tabIndicator, setTabIndicator] = useState({ left: 0, width: 0 })

  // Responsive: switch AI buttons to icon-only on mobile
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)')
    setIsMobile(mq.matches)
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  // Auto-switch tab when navigating with ?action=create-task or ?action=log-interaction
  useEffect(() => {
    const action = searchParams.get('action')
    if (action === 'create-task') setRightTab('tasks')
    else if (action === 'log-interaction') setRightTab('interactions')
  }, [searchParams])

  useEffect(() => {
    const idx = RIGHT_TABS.indexOf(rightTab)
    const btn = rightTabRefs.current[idx]
    const container = rightTabContainerRef.current
    if (btn && container) {
      const containerRect = container.getBoundingClientRect()
      const btnRect = btn.getBoundingClientRect()
      setTabIndicator({ left: btnRect.left - containerRect.left, width: btnRect.width })
    }
  }, [rightTab])
  const { research, loading: researchLoading, error: researchError, startResearch, clearResearch } = useResearch()
  const { prep, loading: prepLoading, error: prepError, startPrep, clearPrep } = useMeetingPrep()

  const fetchContact = useCallback(async () => {
    const { data, error } = await supabase
      .from('contacts')
      .select(`*, ${PIPELINE_EMBED}`)
      .eq('id', contactId)
      .single()

    if (error) {
      setError(error.message)
    } else {
      setContact(withPipelineSummary(data as Contact))
      // Fetch last editor
      if (data.updated_by) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('full_name')
          .eq('id', data.updated_by)
          .single()
        if (profile) setLastEditor(profile.full_name)
      }
    }
    setLoading(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- supabase is a module-level singleton
  }, [contactId])

  useEffect(() => {
    fetchContact()
  }, [fetchContact])

  // Realtime subscription for this contact
  useEffect(() => {
    const channel = supabase
      .channel(`contact-${contactId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'contacts', filter: `id=eq.${contactId}` },
        (payload: { new: Record<string, unknown> }) => {
          setContact((prev) => ({ ...(prev ?? {}), ...(payload.new as unknown as Contact) }))
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- supabase is a module-level singleton
  }, [contactId])

  const handleSave = async (field: string, value: string) => {
    if (!contact) return
    // Optimistic: apply immediately, rollback on error
    const snapshot = contact
    setContact((prev) => prev ? { ...prev, [field]: value } : prev)

    const { error } = await supabase
      .from('contacts')
      .update({ [field]: value, updated_by: user?.id })
      .eq('id', contact.id)

    if (error) {
      setContact(snapshot)
      toast({ title: `Failed to update ${field}`, type: 'error' })
    }
  }

  const handleDelete = async () => {
    if (!contact) return
    const { error } = await supabase
      .from('contacts')
      .delete()
      .eq('id', contact.id)

    if (!error) {
      router.push('/dashboard')
    }
  }

  if (loading) {
    return (
      <AuthGuard>
        <div className="min-h-screen">
          <Header />
          <ContactDetailSkeleton />
        </div>
      </AuthGuard>
    )
  }

  if (error || !contact) {
    return (
      <AuthGuard>
        <div className="min-h-screen">
          <Header />
          <div className="flex flex-col items-center justify-center py-20">
            <p style={{ color: 'var(--danger)' }}>{error ?? 'Contact not found'}</p>
            <button
              onClick={() => router.push('/dashboard')}
              className="mt-4 rounded-md px-4 py-2 text-sm"
              style={{ background: 'var(--hover-light)', color: 'var(--text-primary)', border: 'none', cursor: 'pointer' }}
            >
              Back to Dashboard
            </button>
          </div>
        </div>
      </AuthGuard>
    )
  }

  // contactCats are the contact's labels; the type is contact.category
  const contactCats = getCategoriesForContact(contactId).filter((c) => c !== contact.category)
  const statusStyle = getStatusStyle(contact.status)
  const typeColor = getColor(contact.category)

  return (
    <AuthGuard>
      <div className="min-h-screen">
        <Header />

        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
          {/* Header area */}
          <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                <h1 className="text-lg font-bold sm:text-xl" style={{ color: 'var(--text-primary)' }}>
                  {contact.name}
                </h1>
                <span
                  className="rounded-full px-2 py-0.5 text-xs font-medium"
                  style={{ background: typeColor, color: '#ffffff' }}
                  title="Type"
                >
                  {getLabel(contact.category).toUpperCase()}
                </span>
                {contactCats.map((label) => (
                  <span
                    key={label}
                    className="rounded-full px-2 py-0.5 text-xs font-medium"
                    style={{ border: `1px solid ${getColor(label)}80`, color: getColor(label) }}
                    title="Label"
                  >
                    {label}
                  </span>
                ))}
                <span
                  className="rounded-full px-2 py-0.5 text-xs font-medium"
                  style={{ background: statusStyle.bg, color: statusStyle.text }}
                >
                  {contact.status}
                </span>
                {contact.priority === 'high' && (
                  <span className="text-sm font-bold" style={{ color: 'var(--danger)' }}>{'\u2605'} HIGH</span>
                )}
              </div>
              {contact.org && (
                contact.organization_id ? (
                  <Link
                    href={`/org/${contact.organization_id}`}
                    className="mt-1 block text-sm hover:underline"
                    style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}
                  >
                    {contact.org} {'\u2192'}
                  </Link>
                ) : (
                  <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>{contact.org}</p>
                )
              )}
              {lastEditor && (
                <p className="mt-1 text-xs" style={{ color: 'var(--text-faint)' }}>
                  Last edited by {lastEditor} at {formatRelativeTime(contact.updated_at)}
                </p>
              )}
            </div>

            <div className="flex flex-wrap gap-2 sm:flex-nowrap">
              <PrepButton
                loading={prepLoading}
                onClick={() => {
                  setShowPrepPanel(true)
                  startPrep(contact.id)
                }}
                variant={isMobile ? 'icon' : 'full'}
              />
              <OutreachButton
                onClick={() => setShowOutreachPanel(true)}
                variant={isMobile ? 'icon' : 'full'}
              />
              <ResearchButton
                contact={contact}
                category={contact.category}
                loading={researchLoading}
                onClick={() => {
                  setShowResearchPanel(true)
                  startResearch(contact, contact.category)
                }}
                variant={isMobile ? 'icon' : 'full'}
              />
              <button
                onClick={() => setShowMergeModal(true)}
                className="rounded-md px-2.5 py-1 text-xs sm:px-3 sm:py-1.5 sm:text-sm"
                style={{ background: 'rgba(76,114,176,0.2)', color: 'var(--accent)', border: 'none', cursor: 'pointer' }}
              >
                Merge
              </button>
              <button
                onClick={() => setShowDeleteModal(true)}
                className="rounded-md px-2.5 py-1 text-xs sm:px-3 sm:py-1.5 sm:text-sm"
                style={{ background: 'rgba(196,78,82,0.2)', color: 'var(--danger)', border: 'none', cursor: 'pointer' }}
              >
                Delete
              </button>
              <button
                onClick={() => router.push('/dashboard')}
                className="rounded-md px-2.5 py-1 text-xs sm:px-3 sm:py-1.5 sm:text-sm"
                style={{ background: 'var(--hover-light)', color: 'var(--text-primary)', border: 'none', cursor: 'pointer' }}
              >
                Back
              </button>
            </div>
          </div>

          {/* Two-column layout */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            {/* Contact fields — 2/3 */}
            <div
              className="rounded-lg p-6 lg:col-span-2"
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}
            >
              <div className="mb-4 flex items-baseline justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                  Contact Details
                </h2>
                <span className="text-xs italic" style={{ color: 'var(--text-faint)' }}>click any field to edit</span>
              </div>

              <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
                <EditableField label="Name" value={contact.name} field="name" onSave={handleSave} />
                <EditableField label="Organization" value={contact.org} field="org" onSave={handleSave} />
                {/* Type: exactly one, and it is always one of them. */}
                <div className="mb-4">
                  <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                    Type
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {categories.map(({ name: cat, label: catLabel }) => {
                      const isActive = contact.category === cat
                      const color = getColor(cat)
                      return (
                        <button
                          key={cat}
                          onClick={async () => {
                            setContact((prev) => (prev ? { ...prev, category: cat } : prev))
                            await setPrimaryCategory(contactId, cat)
                          }}
                          className="rounded-full px-2.5 py-1 text-xs font-medium transition-all"
                          style={{
                            background: isActive ? `${color}40` : 'var(--hover-faint)',
                            color: isActive ? color : 'var(--text-faint)',
                            border: `1px solid ${isActive ? color : 'var(--hover-light)'}`,
                            cursor: 'pointer',
                          }}
                        >
                          {isActive ? '\u2713 ' : ''}{catLabel}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Labels: any number, independent of the type */}
                <div className="mb-4">
                  <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                    Labels
                  </label>
                  <LabelPicker
                    labels={contactCats}
                    type={contact.category}
                    onToggle={(label) => toggleCategory(contactId, label)}
                    colorFor={getColor}
                  />
                </div>
                <EditableField
                  label="Status"
                  value={contact.status}
                  field="status"
                  type="select"
                  options={getOptions('status').map((s) => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) }))}
                  onSave={handleSave}
                />
                <EditableField
                  label="Priority"
                  value={contact.priority}
                  field="priority"
                  type="select"
                  options={getOptions('priority').map((p) => ({ value: p, label: p.charAt(0).toUpperCase() + p.slice(1) }))}
                  onSave={handleSave}
                />
                <EditableField label="Location" value={contact.location} field="location" onSave={handleSave} />
                <EditableField label="Email" value={contact.email} field="email" onSave={handleSave} />
                <EditableField label="Phone" value={contact.phone} field="phone" onSave={handleSave} />

                <div className="sm:col-span-2">
                  <EditableField label="Website" value={contact.website} field="website" onSave={handleSave} />
                </div>

                {/* Warmth applies to every relationship, whatever the type */}
                <div key={contact.warmth} className="animate-micro-pulse">
                  <EditableField
                    label="Warmth"
                    value={contact.warmth}
                    field="warmth"
                    type="select"
                    options={WARMTH_OPTIONS.map((w) => ({ value: w, label: w || '(not rated)' }))}
                    onSave={handleSave}
                  />
                </div>
                {contact.category === 'investor' && (
                  <EditableField
                    label="Investor Type"
                    value={contact.investor_type}
                    field="investor_type"
                    type="select"
                    options={getOptions('investor_type').map((t) => ({ value: t, label: t || '(none)' }))}
                    onSave={handleSave}
                  />
                )}
                <EditableField
                  label="Region"
                  value={contact.region}
                  field="region"
                  type="select"
                  options={getOptions('region').map((r) => ({ value: r, label: r || '(none)' }))}
                  onSave={handleSave}
                />

                <div className="sm:col-span-2">
                  <EditableField label="Notes" value={contact.notes} field="notes" type="textarea" onSave={handleSave} />
                </div>
              </div>

              {/* Pipeline entries: each with a stated purpose */}
              <ContactPipelineEntries contactId={contactId} userId={user?.id} />

              {/* Custom fields section */}
              <div className="mt-6 border-t pt-4" style={{ borderColor: 'var(--border-subtle)' }}>
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                    Custom Fields
                  </h2>
                  <button
                    onClick={() => setShowAddFieldModal(true)}
                    className="rounded-md px-3 py-1 text-xs transition-colors"
                    style={{ background: 'var(--hover-light)', color: 'var(--text-primary)', border: 'none', cursor: 'pointer' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--hover-strong)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--hover-light)')}
                  >
                    + Add Field
                  </button>
                </div>
                {customFields.length === 0 && !customFieldsLoading && (
                  <p className="text-xs italic" style={{ color: 'var(--text-faint)' }}>
                    No custom fields yet. Click &quot;+ Add Field&quot; to create one.
                  </p>
                )}
                <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
                  {customFields.map((cf) => (
                    <EditableField
                      key={cf.id}
                      label={cf.field_name}
                      value={customValues[cf.id] ?? ''}
                      field={cf.id}
                      type={cf.field_type === 'select' ? 'select' : cf.field_type === 'textarea' ? 'textarea' : 'text'}
                      options={cf.field_type === 'select' && cf.options
                        ? [{ value: '', label: '(none)' }, ...cf.options.map((o) => ({ value: o, label: o }))]
                        : undefined}
                      onSave={async (_field, value) => {
                        if (user) await updateValue(contactId, cf.id, value, user.id)
                      }}
                    />
                  ))}
                </div>
              </div>

              {/* Quick links */}
              <div className="mt-4 flex gap-3 border-t pt-4" style={{ borderColor: 'var(--border-subtle)' }}>
                {contact.email && (
                  <a
                    href={`mailto:${contact.email}`}
                    className="rounded-md px-4 py-2 text-sm transition-colors"
                    style={{ background: 'var(--hover-light)', color: 'var(--text-primary)' }}
                  >
                    {'\u2709'} Send Email
                  </a>
                )}
                {contact.website && (
                  <a
                    href={ensureProtocol(contact.website)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-md px-4 py-2 text-sm transition-colors"
                    style={{ background: 'var(--hover-light)', color: 'var(--text-primary)' }}
                  >
                    {'\u{1F310}'} Visit Website
                  </a>
                )}
              </div>

              {/* Smart Suggestions */}
              <SmartSuggestions
                contact={contact}
                interactions={interactions}
                tasks={tasks}
                categories={[contact.category, ...contactCats].filter(Boolean)}
              />
            </div>

            {/* Right column — Interactions + Activity tabs — 1/3 */}
            <div
              className="rounded-lg p-6"
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}
            >
              {/* Tab switcher */}
              <div
                ref={rightTabContainerRef}
                className="relative mb-4 flex gap-1 rounded-lg p-1"
                style={{ background: 'var(--bg-primary)' }}
              >
                {/* Sliding indicator */}
                <div
                  style={{
                    position: 'absolute',
                    bottom: 2,
                    left: tabIndicator.left,
                    width: tabIndicator.width,
                    height: '2px',
                    borderRadius: '1px',
                    background: 'var(--accent)',
                    boxShadow: '0 0 8px rgba(76,114,176,0.4)',
                    transition: 'left 250ms ease, width 250ms ease',
                    pointerEvents: 'none',
                  }}
                />
                {RIGHT_TABS.map((tab, idx) => {
                  const labels: Record<string, string> = {
                    timeline: 'Timeline',
                    interactions: `Interactions (${interactions.length})`,
                    tasks: `Tasks (${tasks.length})`,
                    activity: `Activity (${auditEntries.length})`,
                  }
                  return (
                    <button
                      key={tab}
                      ref={(el) => { rightTabRefs.current[idx] = el }}
                      onClick={() => setRightTab(tab)}
                      className="flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
                      style={{
                        background: rightTab === tab ? 'rgba(76,114,176,0.3)' : 'transparent',
                        color: rightTab === tab ? 'var(--accent)' : 'var(--text-secondary)',
                        border: 'none',
                        cursor: 'pointer',
                      }}
                    >
                      {labels[tab]}
                    </button>
                  )
                })}
              </div>

              {/* Tab content */}
              {rightTab === 'interactions' ? (
                <InteractionTimeline
                  interactions={interactions}
                  loading={interactionsLoading}
                  contactId={contactId}
                  onAdd={async (input) => {
                    if (!user) return { error: 'Not authenticated' }
                    return createInteraction({ ...input, userId: user.id })
                  }}
                  onUpdate={async (id, updates) => {
                    return updateInteraction(id, updates)
                  }}
                  onDelete={deleteInteraction}
                  contactName={contact.name}
                  contactOrg={contact.org}
                  contactCategory={contact.category}
                  userName={user?.email?.split('@')[0]}
                />
              ) : rightTab === 'tasks' ? (
                <TaskList
                  tasks={tasks}
                  loading={tasksLoading}
                  onAdd={async (input) => {
                    if (!user) return { error: 'Not authenticated' }
                    return createTask({ ...input, userId: user.id })
                  }}
                  onUpdate={async (taskId, updates) => {
                    return updateTask(taskId, updates)
                  }}
                  onToggleComplete={async (taskId, completed) => {
                    return updateTaskStatus(taskId, completed ? 'completed' : 'pending')
                  }}
                  onDelete={deleteTask}
                />
              ) : rightTab === 'activity' ? (
                <>
                  <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                    Activity
                  </h2>
                  <ActivityFeed entries={auditEntries} loading={auditLoading} showContactLink={false} />
                </>
              ) : (
                <UnifiedTimeline
                  interactions={interactions}
                  tasks={tasks}
                  auditEntries={auditEntries}
                  onToggleTaskComplete={async (taskId, completed) => {
                    return updateTaskStatus(taskId, completed ? 'completed' : 'pending')
                  }}
                  onDeleteTask={deleteTask}
                  onDeleteInteraction={deleteInteraction}
                />
              )}
            </div>
          </div>
        </main>

        {/* Delete confirmation modal */}
        {showDeleteModal && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center"
            style={{ background: 'var(--bg-overlay-heavy)' }}
            onClick={() => setShowDeleteModal(false)}
          >
            <div
              className="mx-4 w-full max-w-sm rounded-lg p-6"
              style={{ background: 'var(--bg-card)', border: '1px solid var(--hover-light)' }}
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="mb-2 text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                Delete Contact
              </h3>
              <p className="mb-6 text-sm" style={{ color: 'var(--text-secondary)' }}>
                Are you sure you want to delete <strong>{contact.name}</strong>? This action cannot be undone.
              </p>
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => setShowDeleteModal(false)}
                  className="rounded-md px-4 py-2 text-sm"
                  style={{ background: 'var(--hover-light)', color: 'var(--text-primary)', border: 'none', cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleDelete}
                  className="rounded-md px-4 py-2 text-sm font-medium"
                  style={{ background: 'var(--danger)', color: '#fff', border: 'none', cursor: 'pointer' }}
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Add custom field modal */}
        {showAddFieldModal && (
          <AddFieldModal
            onClose={() => setShowAddFieldModal(false)}
            onCreate={async (name: string, type: CustomFieldType, options: string[] | null) => {
              if (!user) return { error: 'Not authenticated' }
              return createField(name, type, options, user.id)
            }}
          />
        )}

        {/* Merge contact modal */}
        {showMergeModal && contact && user && (
          <MergeContactModal
            primaryContact={contact}
            userId={user.id}
            onClose={() => setShowMergeModal(false)}
            onMerged={() => {
              setShowMergeModal(false)
              fetchContact()
            }}
          />
        )}

        {/* Meeting Prep panel */}
        {showPrepPanel && (
          <PrepPanel
            prep={prep}
            loading={prepLoading}
            error={prepError}
            onClose={() => {
              setShowPrepPanel(false)
              clearPrep()
            }}
            onRetry={() => { startPrep(contact.id) }}
          />
        )}

        {/* Outreach email panel */}
        {showOutreachPanel && contact && (
          <OutreachEmailPanel
            contact={contact}
            category={contact.category}
            senderName={profile?.full_name ?? ''}
            senderEmail={user?.email ?? ''}
            onClose={() => setShowOutreachPanel(false)}
          />
        )}

        {/* Research panel */}
        {showResearchPanel && (
          <ResearchPanel
            research={research}
            loading={researchLoading}
            error={researchError}
            contactId={contact.id}
            onClose={() => {
              setShowResearchPanel(false)
              clearResearch()
            }}
            onRetry={() => { startResearch(contact, contact.category) }}
          />
        )}
      </div>
    </AuthGuard>
  )
}
