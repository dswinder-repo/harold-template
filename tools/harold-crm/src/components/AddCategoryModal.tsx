'use client'

import { useState } from 'react'

// Preset color palette
const PRESET_COLORS = [
  '#DD8452', '#55A868', '#8172B3', '#C44E52', '#937860',
  '#4C72B0', '#CCB974', '#64B5CD', '#E08DAC', '#6B8E23',
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8',
]

interface AddCategoryModalProps {
  onClose: () => void
  onCreate: (name: string, label: string, color: string) => Promise<{ error?: unknown }>
}

export default function AddCategoryModal({ onClose, onCreate }: AddCategoryModalProps) {
  const [label, setLabel] = useState('')
  const [color, setColor] = useState('#4C72B0')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleCreate = async () => {
    const trimmed = label.trim()
    if (!trimmed) {
      setError('Type name is required')
      return
    }

    setSaving(true)
    setError(null)

    const result = await onCreate(trimmed, trimmed, color)
    setSaving(false)

    if (result.error) {
      setError('A type with that name already exists')
    } else {
      onClose()
    }
  }

  const inputStyle = {
    background: 'var(--bg-input)',
    color: 'var(--text-primary)',
    border: '1px solid var(--border-input)',
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'var(--bg-overlay-heavy)' }}
      onClick={onClose}
    >
      <div
        className="mx-4 w-full max-w-sm rounded-lg p-6"
        style={{
          background: 'var(--glass-modal-bg, var(--bg-card))',
          backdropFilter: 'blur(20px) saturate(150%)',
          WebkitBackdropFilter: 'blur(20px) saturate(150%)',
          border: '1px solid var(--glass-modal-border, var(--border-subtle))',
          boxShadow: 'var(--shadow-elevated)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-4 text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
          Add Contact Type
        </h3>

        {/* Type name */}
        <div className="mb-4">
          <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
            Type Name
          </label>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Advisor, Government, Mentor"
            className="w-full rounded-md px-3 py-2 text-sm outline-none"
            style={inputStyle}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate()
              if (e.key === 'Escape') onClose()
            }}
          />
        </div>

        {/* Color picker */}
        <div className="mb-4">
          <label className="mb-2 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
            Color
          </label>
          <div className="flex flex-wrap gap-2">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className="h-7 w-7 rounded-full transition-transform"
                style={{
                  background: c,
                  border: color === c ? '2px solid var(--text-primary)' : '2px solid transparent',
                  transform: color === c ? 'scale(1.2)' : 'scale(1)',
                  cursor: 'pointer',
                }}
              />
            ))}
          </div>
        </div>

        {/* Preview */}
        <div className="mb-4">
          <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
            Preview
          </label>
          <span
            className="inline-block rounded-full px-3 py-1 text-xs font-medium"
            style={{ background: color, color: '#ffffff' }}
          >
            {label || 'Type'}
          </span>
        </div>

        {/* Error */}
        {error && (
          <p className="mb-4 text-xs" style={{ color: 'var(--danger)' }}>{error}</p>
        )}

        {/* Buttons */}
        <div className="flex gap-3 justify-end">
          <button
            onClick={onClose}
            className="rounded-md px-4 py-2 text-sm"
            style={{ background: 'var(--hover-light)', color: 'var(--text-primary)', border: 'none', cursor: 'pointer' }}
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={saving}
            className="rounded-md px-4 py-2 text-sm font-medium"
            style={{
              background: saving ? 'rgba(76,114,176,0.5)' : 'var(--accent)',
              color: '#ffffff',
              border: 'none',
              cursor: saving ? 'not-allowed' : 'pointer',
            }}
          >
            {saving ? 'Creating...' : 'Create Type'}
          </button>
        </div>
      </div>
    </div>
  )
}
