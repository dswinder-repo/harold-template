'use client'

import { useState, useEffect } from 'react'
import { useCrmSettings } from '@/hooks/useCrmSettings'
import { useToast } from '@/hooks/useToast'
import type { WarmthDecayThreshold } from '@/lib/types'

const WARMTH_LEVELS = [
  { key: 'Hot', icon: '\u{1F525}', label: 'Hot \u2192 Warm' },
  { key: 'Warm', icon: '\u{1F321}\uFE0F', label: 'Warm \u2192 Lukewarm' },
  { key: 'Lukewarm', icon: '\u2744\uFE0F', label: 'Lukewarm \u2192 Cold' },
] as const

export default function WarmthRulesEditor() {
  const { getWarmthThresholds, updateSetting, loading } = useCrmSettings()
  const { toast } = useToast()
  const [saving, setSaving] = useState(false)
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({})

  // Local draft state for editing
  const [draft, setDraft] = useState<Record<string, { alertDays: number; decayDays: number }>>({})

  // Sync from settings once loaded
  useEffect(() => {
    if (!loading) {
      const thresholds = getWarmthThresholds()
      setDraft({
        Hot: { alertDays: thresholds.Hot.alertDays, decayDays: thresholds.Hot.decayDays },
        Warm: { alertDays: thresholds.Warm.alertDays, decayDays: thresholds.Warm.decayDays },
        Lukewarm: { alertDays: thresholds.Lukewarm.alertDays, decayDays: thresholds.Lukewarm.decayDays },
      })
    }
  }, [loading, getWarmthThresholds])

  if (loading || Object.keys(draft).length === 0) {
    return (
      <p className="py-8 text-center text-sm" style={{ color: 'var(--text-faint)' }}>
        Loading warmth rules...
      </p>
    )
  }

  const handleFieldChange = (level: string, field: 'alertDays' | 'decayDays', raw: string) => {
    const value = parseInt(raw, 10)
    if (isNaN(value)) return

    setDraft((prev) => ({
      ...prev,
      [level]: { ...prev[level], [field]: value },
    }))

    // Clear validation error for this level
    setValidationErrors((prev) => {
      const next = { ...prev }
      delete next[level]
      return next
    })
  }

  const validate = (): boolean => {
    const errors: Record<string, string> = {}

    for (const { key } of WARMTH_LEVELS) {
      const d = draft[key]
      if (!d) continue
      if (d.alertDays < 1) errors[key] = 'Alert days must be at least 1'
      else if (d.decayDays < 1) errors[key] = 'Decay days must be at least 1'
      else if (d.alertDays >= d.decayDays) errors[key] = 'Alert days must be less than decay days'
    }

    setValidationErrors(errors)
    return Object.keys(errors).length === 0
  }

  const handleSave = async () => {
    if (!validate()) return

    setSaving(true)

    // Build the value matching WarmthDecayThreshold shape
    const thresholds = getWarmthThresholds()
    const value: Record<string, WarmthDecayThreshold> = {
      Hot: { ...thresholds.Hot, alertDays: draft.Hot.alertDays, decayDays: draft.Hot.decayDays },
      Warm: { ...thresholds.Warm, alertDays: draft.Warm.alertDays, decayDays: draft.Warm.decayDays },
      Lukewarm: { ...thresholds.Lukewarm, alertDays: draft.Lukewarm.alertDays, decayDays: draft.Lukewarm.decayDays },
    }

    const { error } = await updateSetting('warmth_decay_thresholds', value)

    if (error) {
      toast({ title: `Failed to save: ${error}`, type: 'error' })
    } else {
      toast({ title: 'Warmth rules updated', type: 'success' })
    }
    setSaving(false)
  }

  // Check if draft differs from saved values
  const thresholds = getWarmthThresholds()
  const hasChanges = WARMTH_LEVELS.some(({ key }) => {
    const d = draft[key]
    const t = thresholds[key]
    return d && t && (d.alertDays !== t.alertDays || d.decayDays !== t.decayDays)
  })

  return (
    <div
      className="rounded-lg p-5"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}
    >
      <h2 className="mb-1 text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
        Warmth Decay Rules
      </h2>
      <p className="mb-5 text-xs" style={{ color: 'var(--text-faint)' }}>
        Configure how long before contacts decay from one warmth level to the next.
        Alert triggers a notification; decay auto-downgrades the contact.
      </p>

      <div className="flex flex-col gap-4">
        {WARMTH_LEVELS.map(({ key, icon, label }) => {
          const d = draft[key]
          if (!d) return null
          const error = validationErrors[key]

          return (
            <div key={key}>
              <div
                className="rounded-md p-4"
                style={{
                  background: 'var(--bg-primary)',
                  border: error ? '1px solid var(--danger)' : '1px solid transparent',
                }}
              >
                <div className="mb-3 flex items-center gap-2">
                  <span className="text-base">{icon}</span>
                  <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {label}
                  </span>
                </div>

                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                      Alert after
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={365}
                      value={d.alertDays}
                      onChange={(e) => handleFieldChange(key, 'alertDays', e.target.value)}
                      className="w-16 rounded-md px-2 py-1.5 text-center text-sm outline-none"
                      style={{
                        background: 'var(--bg-secondary)',
                        color: 'var(--text-primary)',
                        border: '1px solid var(--border-input)',
                      }}
                    />
                    <span className="text-xs" style={{ color: 'var(--text-faint)' }}>days</span>
                  </div>

                  <span className="text-xs" style={{ color: 'var(--text-faint)' }}>&middot;</span>

                  <div className="flex items-center gap-2">
                    <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                      Decay after
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={365}
                      value={d.decayDays}
                      onChange={(e) => handleFieldChange(key, 'decayDays', e.target.value)}
                      className="w-16 rounded-md px-2 py-1.5 text-center text-sm outline-none"
                      style={{
                        background: 'var(--bg-secondary)',
                        color: 'var(--text-primary)',
                        border: '1px solid var(--border-input)',
                      }}
                    />
                    <span className="text-xs" style={{ color: 'var(--text-faint)' }}>days</span>
                  </div>
                </div>
              </div>

              {error && (
                <p className="mt-1 text-xs" style={{ color: 'var(--danger)' }}>
                  {error}
                </p>
              )}
            </div>
          )
        })}
      </div>

      {/* Save button */}
      <div className="flex justify-end pt-4">
        <button
          onClick={handleSave}
          disabled={saving || !hasChanges}
          className="rounded-md px-5 py-2 text-sm font-medium transition-colors"
          style={{
            background: saving || !hasChanges ? 'var(--hover-medium)' : 'var(--accent)',
            color: '#ffffff',
            border: 'none',
            cursor: saving || !hasChanges ? 'not-allowed' : 'pointer',
            opacity: saving || !hasChanges ? 0.6 : 1,
          }}
        >
          {saving ? 'Saving...' : 'Save Warmth Rules'}
        </button>
      </div>
    </div>
  )
}
