'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { createClient } from '@/lib/supabase/client'
import type { Contact, StatusType, PriorityType, WarmthType, InvestorType, RegionType, Category } from '@/lib/types'
import { DEFAULT_CATEGORY_OPTIONS, WARMTH_OPTIONS } from '@/lib/types'
import { useEnumOptions } from '@/hooks/useEnumOptions'
import OrgAutocomplete from '@/components/OrgAutocomplete'

interface ContactFormProps {
  initialData?: Partial<Contact>
  mode?: 'create' | 'edit'
  categories?: Category[]
}

const inputStyle = {
  background: 'var(--bg-input)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-input)',
}

const labelStyle = { color: 'var(--text-secondary)' }

export default function ContactForm({ initialData, mode = 'create', categories }: ContactFormProps) {
  const router = useRouter()
  const { user } = useAuth()
  const supabase = createClient()
  const { getOptions } = useEnumOptions()

  const defaultCategory = initialData?.category ?? 'other'

  const [form, setForm] = useState({
    name: initialData?.name ?? '',
    org: initialData?.org ?? '',
    organization_id: initialData?.organization_id ?? null as string | null,
    category: defaultCategory,
    status: (initialData?.status ?? 'pending') as StatusType,
    priority: (initialData?.priority ?? 'medium') as PriorityType,
    location: initialData?.location ?? '',
    email: initialData?.email ?? '',
    phone: initialData?.phone ?? '',
    website: initialData?.website ?? '',
    notes: initialData?.notes ?? '',
    warmth: (initialData?.warmth ?? '') as WarmthType,
    investor_type: (initialData?.investor_type ?? '') as InvestorType,
    region: (initialData?.region ?? '') as RegionType,
  })

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleChange = (field: string, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) {
      setError('Name is required')
      return
    }

    setSaving(true)
    setError(null)

    if (mode === 'create') {
      const { error: insertError } = await supabase
        .from('contacts')
        .insert({
          ...form,
          created_by: user?.id ?? null,
        })

      if (insertError) {
        setError(insertError.message)
        setSaving(false)
        return
      }
    } else if (initialData?.id) {
      const { error: updateError } = await supabase
        .from('contacts')
        .update({
          ...form,
          updated_by: user?.id ?? null,
        })
        .eq('id', initialData.id)

      if (updateError) {
        setError(updateError.message)
        setSaving(false)
        return
      }
    }

    setSaving(false)
    router.push('/dashboard')
  }

  const showInvestorFields = form.category === 'investor'

  return (
    <form onSubmit={handleSubmit} className="mx-auto max-w-2xl">
      {error && (
        <div className="mb-4 rounded-md p-3 text-sm" style={{ background: 'rgba(196,78,82,0.2)', color: 'var(--danger)' }}>
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* Name */}
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-medium" style={labelStyle}>Name *</label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => handleChange('name', e.target.value)}
            className="w-full rounded-md px-3 py-2 text-sm outline-none"
            style={inputStyle}
            required
          />
        </div>

        {/* Org — autocomplete against organizations table */}
        <OrgAutocomplete
          value={form.org}
          organizationId={form.organization_id}
          onChange={(name, orgId) => setForm(prev => ({ ...prev, org: name, organization_id: orgId }))}
          inputStyle={inputStyle}
          labelStyle={labelStyle}
        />

        {/* Type: exactly one per contact. Labels are added on the contact page. */}
        <div>
          <label className="mb-1 block text-xs font-medium" style={labelStyle}>Type</label>
          <select
            value={form.category}
            onChange={(e) => handleChange('category', e.target.value)}
            className="w-full rounded-md px-3 py-2 text-sm outline-none"
            style={inputStyle}
          >
            {(categories && categories.length > 0
              ? categories.map((cat) => ({ value: cat.name, label: cat.label }))
              : DEFAULT_CATEGORY_OPTIONS.map((c) => ({ value: c, label: c.charAt(0).toUpperCase() + c.slice(1) }))
            ).map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>

        {/* Status */}
        <div>
          <label className="mb-1 block text-xs font-medium" style={labelStyle}>Status</label>
          <select
            value={form.status}
            onChange={(e) => handleChange('status', e.target.value)}
            className="w-full rounded-md px-3 py-2 text-sm outline-none"
            style={inputStyle}
          >
            {getOptions('status').map((s) => (
              <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
            ))}
          </select>
        </div>

        {/* Priority */}
        <div>
          <label className="mb-1 block text-xs font-medium" style={labelStyle}>Priority</label>
          <select
            value={form.priority}
            onChange={(e) => handleChange('priority', e.target.value)}
            className="w-full rounded-md px-3 py-2 text-sm outline-none"
            style={inputStyle}
          >
            {getOptions('priority').map((p) => (
              <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
            ))}
          </select>
        </div>

        {/* Location */}
        <div>
          <label className="mb-1 block text-xs font-medium" style={labelStyle}>Location</label>
          <input
            type="text"
            value={form.location}
            onChange={(e) => handleChange('location', e.target.value)}
            className="w-full rounded-md px-3 py-2 text-sm outline-none"
            style={inputStyle}
          />
        </div>

        {/* Email */}
        <div>
          <label className="mb-1 block text-xs font-medium" style={labelStyle}>Email</label>
          <input
            type="email"
            value={form.email}
            onChange={(e) => handleChange('email', e.target.value)}
            className="w-full rounded-md px-3 py-2 text-sm outline-none"
            style={inputStyle}
          />
        </div>

        {/* Phone */}
        <div>
          <label className="mb-1 block text-xs font-medium" style={labelStyle}>Phone</label>
          <input
            type="text"
            value={form.phone}
            onChange={(e) => handleChange('phone', e.target.value)}
            className="w-full rounded-md px-3 py-2 text-sm outline-none"
            style={inputStyle}
          />
        </div>

        {/* Website */}
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-medium" style={labelStyle}>Website</label>
          <input
            type="text"
            value={form.website}
            onChange={(e) => handleChange('website', e.target.value)}
            className="w-full rounded-md px-3 py-2 text-sm outline-none"
            style={inputStyle}
            placeholder="https://..."
          />
        </div>

        {/* Warmth: your judgment of the relationship, for any type */}
        <div>
          <label className="mb-1 block text-xs font-medium" style={labelStyle}>Warmth</label>
          <select
            value={form.warmth}
            onChange={(e) => handleChange('warmth', e.target.value)}
            className="w-full rounded-md px-3 py-2 text-sm outline-none"
            style={inputStyle}
          >
            {WARMTH_OPTIONS.map((w) => (
              <option key={w} value={w}>{w || '(not rated)'}</option>
            ))}
          </select>
        </div>

        {showInvestorFields && (
          <div>
            <label className="mb-1 block text-xs font-medium" style={labelStyle}>Investor Type</label>
            <select
              value={form.investor_type}
              onChange={(e) => handleChange('investor_type', e.target.value)}
              className="w-full rounded-md px-3 py-2 text-sm outline-none"
              style={inputStyle}
            >
              {getOptions('investor_type').map((t) => (
                <option key={t} value={t}>{t || '(none)'}</option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="mb-1 block text-xs font-medium" style={labelStyle}>Region</label>
          <select
            value={form.region}
            onChange={(e) => handleChange('region', e.target.value)}
            className="w-full rounded-md px-3 py-2 text-sm outline-none"
            style={inputStyle}
          >
            {getOptions('region').map((r) => (
              <option key={r} value={r}>{r || '(none)'}</option>
            ))}
          </select>
        </div>

        {/* Notes */}
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-medium" style={labelStyle}>Notes</label>
          <textarea
            value={form.notes}
            onChange={(e) => handleChange('notes', e.target.value)}
            rows={4}
            className="w-full rounded-md px-3 py-2 text-sm outline-none"
            style={inputStyle}
          />
        </div>
      </div>

      {/* Submit */}
      <div className="mt-6 flex gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md px-6 py-2 text-sm font-medium transition-colors"
          style={{
            background: saving ? 'var(--hover-medium)' : 'var(--accent)',
            color: '#ffffff',
            border: 'none',
            cursor: saving ? 'not-allowed' : 'pointer',
          }}
        >
          {saving ? 'Saving...' : mode === 'create' ? 'Create Contact' : 'Save Changes'}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-md px-6 py-2 text-sm transition-colors"
          style={{
            background: 'var(--hover-light)',
            color: 'var(--text-primary)',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
