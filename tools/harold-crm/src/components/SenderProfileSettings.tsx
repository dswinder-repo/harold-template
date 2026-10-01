'use client'

import { useEffect, useState } from 'react'
import { useCrmSettings } from '@/hooks/useCrmSettings'
import { useToast } from '@/hooks/useToast'
import { SENDER_PROFILE_KEY, type SenderProfile } from '@/lib/senderProfile'

const inputStyle = {
  background: 'var(--bg-input)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-input)',
}

export default function SenderProfileSettings() {
  const { getSetting, updateSetting, loading } = useCrmSettings()
  const { toast } = useToast()
  const [form, setForm] = useState<SenderProfile>({ org: '', one_liner: '', text: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (loading) return
    const stored = getSetting<SenderProfile | null>(SENDER_PROFILE_KEY, null)
    if (stored) setForm({ org: stored.org ?? '', one_liner: stored.one_liner ?? '', text: stored.text ?? '' })
  }, [loading, getSetting])

  const save = async () => {
    setSaving(true)
    const { error } = await updateSetting(SENDER_PROFILE_KEY, form)
    setSaving(false)
    toast(error ? { title: `Failed to save: ${error}`, type: 'error' } : { title: 'Sender profile saved', type: 'success' })
  }

  return (
    <div className="rounded-lg p-5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>
      <h2 className="mb-1 text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Sender Profile</h2>
      <p className="mb-4 text-sm" style={{ color: 'var(--text-secondary)' }}>
        Who you are when the CRM drafts outreach or prepares a meeting brief. Everything here is optional:
        leave it empty and drafts show [blanks] for you to fill in, and briefs reason from the contact alone.
      </p>

      <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Organization</label>
      <input
        value={form.org}
        onChange={(e) => setForm((f) => ({ ...f, org: e.target.value }))}
        placeholder="The company or project you write on behalf of"
        className="mb-4 w-full rounded-md px-3 py-2 text-sm outline-none"
        style={inputStyle}
      />

      <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>One-liner</label>
      <input
        value={form.one_liner}
        onChange={(e) => setForm((f) => ({ ...f, one_liner: e.target.value }))}
        placeholder="One sentence on what it does"
        className="mb-4 w-full rounded-md px-3 py-2 text-sm outline-none"
        style={inputStyle}
      />

      <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Context for meeting briefs</label>
      <textarea
        value={form.text}
        onChange={(e) => setForm((f) => ({ ...f, text: e.target.value }))}
        rows={6}
        placeholder="What you do, current priorities, what you are asking people for. Shared with the AI provider when you generate a brief."
        className="mb-4 w-full rounded-md px-3 py-2 text-sm outline-none"
        style={inputStyle}
      />

      <button
        onClick={save}
        disabled={saving}
        className="rounded-md px-4 py-2 text-sm font-medium"
        style={{ background: 'var(--accent)', color: '#fff', border: 'none', cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.7 : 1 }}
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  )
}
