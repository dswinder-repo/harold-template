'use client'

import { useState } from 'react'
import type { CustomFieldType } from '@/lib/types'
import { CUSTOM_FIELD_TYPE_OPTIONS } from '@/lib/types'

interface AddFieldModalProps {
  onClose: () => void
  onCreate: (name: string, type: CustomFieldType, options: string[] | null) => Promise<{ error?: unknown }>
}

export default function AddFieldModal({ onClose, onCreate }: AddFieldModalProps) {
  const [fieldName, setFieldName] = useState('')
  const [fieldType, setFieldType] = useState<CustomFieldType>('text')
  const [optionsText, setOptionsText] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleCreate = async () => {
    const trimmed = fieldName.trim()
    if (!trimmed) {
      setError('Field name is required')
      return
    }

    setSaving(true)
    setError(null)

    const options = fieldType === 'select'
      ? optionsText.split('\n').map((o) => o.trim()).filter(Boolean)
      : null

    if (fieldType === 'select' && (!options || options.length < 2)) {
      setError('Dropdown fields need at least 2 options')
      setSaving(false)
      return
    }

    const result = await onCreate(trimmed, fieldType, options)
    setSaving(false)

    if (result.error) {
      setError('A field with that name already exists')
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
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-4 text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
          Add Custom Field
        </h3>

        {/* Field name */}
        <div className="mb-4">
          <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
            Field Name
          </label>
          <input
            type="text"
            value={fieldName}
            onChange={(e) => setFieldName(e.target.value)}
            placeholder="e.g. LinkedIn URL"
            className="w-full rounded-md px-3 py-2 text-sm outline-none"
            style={inputStyle}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate()
              if (e.key === 'Escape') onClose()
            }}
          />
        </div>

        {/* Field type */}
        <div className="mb-4">
          <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
            Field Type
          </label>
          <select
            value={fieldType}
            onChange={(e) => setFieldType(e.target.value as CustomFieldType)}
            className="w-full rounded-md px-3 py-2 text-sm outline-none"
            style={inputStyle}
          >
            {CUSTOM_FIELD_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {/* Options for select type */}
        {fieldType === 'select' && (
          <div className="mb-4">
            <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
              Options (one per line)
            </label>
            <textarea
              value={optionsText}
              onChange={(e) => setOptionsText(e.target.value)}
              placeholder={"Option A\nOption B\nOption C"}
              className="w-full rounded-md px-3 py-2 text-sm outline-none"
              style={inputStyle}
              rows={4}
            />
          </div>
        )}

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
            {saving ? 'Creating...' : 'Create Field'}
          </button>
        </div>
      </div>
    </div>
  )
}
