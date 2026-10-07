'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import AuthGuard from '@/components/AuthGuard'
import Header from '@/components/Header'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/hooks/useToast'
import { createClient } from '@/lib/supabase/client'
import type { Organization, Contact } from '@/lib/types'
import { getStatusStyle } from '@/lib/types'
import { useEnumOptions } from '@/hooks/useEnumOptions'
import { useCategories } from '@/hooks/useCategories'
import { formatRelativeTime, ensureProtocol } from '@/lib/utils'
import { PIPELINE_EMBED, withPipelineSummary } from '@/lib/pipeline'

/* ─── Inline editable field (reused pattern from contact detail) ───── */

function EditableField({
  label,
  value,
  field,
  type = 'text',
  options,
  placeholder,
  onSave,
}: {
  label: string
  value: string
  field: string
  type?: 'text' | 'select' | 'textarea' | 'date' | 'number'
  options?: { value: string; label: string }[]
  placeholder?: string
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
              rows={2}
              autoFocus
            />
          ) : (
            <input
              type={type === 'date' ? 'date' : type === 'number' ? 'number' : 'text'}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={handleSave}
              onKeyDown={handleKeyDown}
              className="flex-1 rounded-md px-3 py-1.5 text-sm outline-none"
              style={inputStyle}
              placeholder={placeholder}
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
          {value || <span style={{ color: 'var(--text-faint)', fontStyle: 'italic' }}>{placeholder ?? '(click to edit)'}</span>}
        </div>
      )}
    </div>
  )
}

/* ─── Contact mini-card for the member list ────────────────────────── */

function ContactMiniCard({ contact, color }: { contact: Contact; color: string }) {
  const catColor = color
  const statusStyle = getStatusStyle(contact.status)

  return (
    <Link
      href={`/contacts/${contact.id}`}
      className="flex items-center gap-3 rounded-lg p-3 transition-colors"
      style={{
        background: 'var(--bg-primary)',
        border: '1px solid var(--border-subtle)',
        textDecoration: 'none',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--hover-subtle)'
        e.currentTarget.style.borderColor = 'var(--hover-strong)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'var(--bg-primary)'
        e.currentTarget.style.borderColor = 'var(--border-subtle)'
      }}
    >
      {/* Avatar circle */}
      <div
        className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold"
        style={{ background: `${catColor}30`, color: catColor }}
      >
        {contact.name.charAt(0).toUpperCase()}
      </div>

      {/* Name + role */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
          {contact.name}
        </p>
        {contact.pipeline_stage && (
          <p className="truncate text-xs" style={{ color: 'var(--text-faint)' }}>
            {`${contact.pipeline_stage}: ${contact.pipeline}`}
          </p>
        )}
      </div>

      {/* Status badge */}
      <span
        className="flex-shrink-0 rounded-full px-2 py-0.5 text-xs"
        style={{ background: statusStyle.bg, color: statusStyle.text }}
      >
        {contact.status}
      </span>

      {/* Warmth indicator */}
      {contact.warmth && (
        <span className="flex-shrink-0 text-xs" style={{ color: 'var(--text-faint)' }}>
          {contact.warmth}
        </span>
      )}
    </Link>
  )
}

/* ─── Skeleton loader ──────────────────────────────────────────────── */

function OrgDetailSkeleton() {
  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <div className="mb-6 animate-pulse">
        <div className="mb-2 h-7 w-48 rounded" style={{ background: 'var(--hover-light)' }} />
        <div className="h-4 w-32 rounded" style={{ background: 'var(--hover-faint)' }} />
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-4 rounded-lg p-6 lg:col-span-2" style={{ background: 'var(--bg-card)' }}>
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-10 rounded" style={{ background: 'var(--hover-faint)' }} />
          ))}
        </div>
        <div className="space-y-3 rounded-lg p-6" style={{ background: 'var(--bg-card)' }}>
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-14 rounded" style={{ background: 'var(--hover-faint)' }} />
          ))}
        </div>
      </div>
    </main>
  )
}

/* ─── Main page component ──────────────────────────────────────────── */

export default function OrgDetailPage() {
  const params = useParams()
  const router = useRouter()
  const orgId = params.id as string
  const { user } = useAuth()
  const { toast } = useToast()
  const supabase = createClient()
  const { getOptions } = useEnumOptions()
  const { categories, getColor } = useCategories()

  const [org, setOrg] = useState<Organization | null>(null)
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)
  const [contactsLoading, setContactsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  /* ── Fetch org ────────────────────────────────────────────────────── */
  const fetchOrg = useCallback(async () => {
    const { data, error } = await supabase
      .from('organizations')
      .select('*')
      .eq('id', orgId)
      .single()

    if (error) {
      setError(error.message)
    } else {
      setOrg(data as Organization)
    }
    setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- supabase is a module-level singleton
  }, [orgId])

  /* ── Fetch contacts belonging to this org ─────────────────────────── */
  const fetchContacts = useCallback(async () => {
    setContactsLoading(true)
    const { data, error } = await supabase
      .from('contacts')
      .select(`*, ${PIPELINE_EMBED}`)
      .eq('organization_id', orgId)
      .order('name', { ascending: true })

    if (!error && data) {
      setContacts((data as Contact[]).map(withPipelineSummary))
    }
    setContactsLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- supabase is a module-level singleton
  }, [orgId])

  useEffect(() => {
    fetchOrg()
    fetchContacts()
  }, [fetchOrg, fetchContacts])

  /* ── Realtime subscription ────────────────────────────────────────── */
  useEffect(() => {
    const channel = supabase
      .channel(`org-${orgId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'organizations', filter: `id=eq.${orgId}` },
        (payload: { new: Record<string, unknown> }) => {
          setOrg(payload.new as unknown as Organization)
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'contacts', filter: `organization_id=eq.${orgId}` },
        () => {
          fetchContacts()
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- supabase is a module-level singleton
  }, [orgId, fetchContacts])

  /* ── Save handler ─────────────────────────────────────────────────── */
  const handleSave = async (field: string, value: string) => {
    if (!org) return
    const snapshot = org
    setOrg((prev) => prev ? { ...prev, [field]: value } : prev)

    const { error } = await supabase
      .from('organizations')
      .update({ [field]: value, updated_by: user?.id ?? null })
      .eq('id', org.id)

    if (error) {
      setOrg(snapshot)
      toast({ title: `Failed to update ${field}`, type: 'error' })
    }
  }

  /* ── Loading state ────────────────────────────────────────────────── */
  if (loading) {
    return (
      <AuthGuard>
        <div className="min-h-screen">
          <Header />
          <OrgDetailSkeleton />
        </div>
      </AuthGuard>
    )
  }

  /* ── Error state ──────────────────────────────────────────────────── */
  if (error || !org) {
    return (
      <AuthGuard>
        <div className="min-h-screen">
          <Header />
          <div className="flex flex-col items-center justify-center py-20">
            <p style={{ color: 'var(--danger)' }}>{error ?? 'Organization not found'}</p>
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

  const catColor = getColor(org.category)

  return (
    <AuthGuard>
      <div className="min-h-screen">
        <Header />

        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
          {/* ── Header area ────────────────────────────────────────── */}
          <div className="mb-6 flex items-start justify-between">
            <div>
              <div className="flex items-center gap-3">
                {/* Org avatar */}
                <div
                  className="flex h-10 w-10 items-center justify-center rounded-lg text-base font-bold"
                  style={{ background: `${catColor}30`, color: catColor }}
                >
                  {org.name.charAt(0).toUpperCase()}
                </div>
                <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
                  {org.name}
                </h1>
                {org.category && (
                  <span
                    className="rounded-full px-2 py-0.5 text-xs font-medium"
                    style={{ background: catColor, color: '#ffffff' }}
                  >
                    {org.category.toUpperCase()}
                  </span>
                )}
              </div>
              {org.location && (
                <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
                  {'\uD83D\uDCCD'} {org.location}
                </p>
              )}
              <p className="mt-1 text-xs" style={{ color: 'var(--text-faint)' }}>
                Created {formatRelativeTime(org.created_at)}
                {org.updated_at !== org.created_at && ` \u00B7 Updated ${formatRelativeTime(org.updated_at)}`}
              </p>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => router.back()}
                className="rounded-md px-3 py-1.5 text-sm"
                style={{ background: 'var(--hover-light)', color: 'var(--text-primary)', border: 'none', cursor: 'pointer' }}
              >
                Back
              </button>
            </div>
          </div>

          {/* ── Two-column layout ──────────────────────────────────── */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            {/* Left: Org fields (2/3) */}
            <div
              className="rounded-lg p-6 lg:col-span-2"
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}
            >
              <div className="mb-4 flex items-baseline justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                  Organization Details
                </h2>
                <span className="text-xs italic" style={{ color: 'var(--text-faint)' }}>click any field to edit</span>
              </div>

              <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
                <EditableField label="Name" value={org.name} field="name" onSave={handleSave} />
                <EditableField
                  label="Type"
                  value={org.category}
                  field="category"
                  type="select"
                  options={[{ value: '', label: '(none)' }, ...categories.map((c) => ({ value: c.name, label: c.label }))]}
                  onSave={handleSave}
                />
                <EditableField label="Industry" value={org.industry} field="industry" onSave={handleSave} />
                <EditableField label="Location" value={org.location} field="location" onSave={handleSave} />
                <EditableField
                  label="Investor Type"
                  value={org.investor_type}
                  field="investor_type"
                  type="select"
                  options={getOptions('investor_type').map((t) => ({ value: t, label: t || '(none)' }))}
                  onSave={handleSave}
                />
                <EditableField
                  label="Region"
                  value={org.region}
                  field="region"
                  type="select"
                  options={getOptions('region').map((r) => ({ value: r, label: r || '(none)' }))}
                  onSave={handleSave}
                />
                <div className="sm:col-span-2">
                  <EditableField label="Website" value={org.website} field="website" onSave={handleSave} />
                </div>
                <div className="sm:col-span-2">
                  <EditableField label="Notes" value={org.notes} field="notes" type="textarea" onSave={handleSave} />
                </div>
              </div>

              {/* Quick links */}
              {org.website && (
                <div className="mt-4 flex gap-3 border-t pt-4" style={{ borderColor: 'var(--border-subtle)' }}>
                  <a
                    href={ensureProtocol(org.website)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-md px-4 py-2 text-sm transition-colors"
                    style={{ background: 'var(--hover-light)', color: 'var(--text-primary)' }}
                  >
                    {'\uD83C\uDF10'} Visit Website
                  </a>
                </div>
              )}

            </div>

            {/* Right column: Members */}
            <div className="flex flex-col gap-6">

            {/* Members */}
            <div
              className="rounded-lg p-6"
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}
            >
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                  Members ({contacts.length})
                </h2>
                <Link
                  href={`/contacts/new?org_id=${orgId}&org_name=${encodeURIComponent(org.name)}`}
                  className="rounded-md px-3 py-1 text-xs transition-colors"
                  style={{
                    background: 'var(--hover-light)',
                    color: 'var(--text-primary)',
                    textDecoration: 'none',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--hover-strong)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--hover-light)')}
                >
                  + Add Contact
                </Link>
              </div>

              {contactsLoading ? (
                <div className="space-y-3">
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="h-14 animate-pulse rounded-lg" style={{ background: 'var(--hover-faint)' }} />
                  ))}
                </div>
              ) : contacts.length === 0 ? (
                <p className="py-8 text-center text-sm" style={{ color: 'var(--text-faint)' }}>
                  No contacts linked to this organization yet.
                </p>
              ) : (
                <div className="space-y-2">
                  {contacts.map((c) => (
                    <ContactMiniCard key={c.id} contact={c} color={getColor(c.category)} />
                  ))}
                </div>
              )}
            </div>
            </div> {/* end right column flex wrapper */}
          </div>

        </main>
      </div>
    </AuthGuard>
  )
}
