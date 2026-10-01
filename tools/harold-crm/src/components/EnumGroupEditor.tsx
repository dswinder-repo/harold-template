'use client'

import { useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { useEnumOptions } from '@/hooks/useEnumOptions'
import type { EnumOption } from '@/lib/types'

const GROUP_LABELS: Record<string, string> = {
  investor_type: 'Investor Type',
  region: 'Region',
  label: 'Label',
}

interface EnumGroupEditorProps {
  group: string
}

export default function EnumGroupEditor({ group }: EnumGroupEditorProps) {
  const { user } = useAuth()
  const { getOptionsRaw, addOption, updateOption, deleteOption } = useEnumOptions()

  const [addingNew, setAddingNew] = useState(false)
  const [newValue, setNewValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const options = getOptionsRaw(group)
  const groupLabel = GROUP_LABELS[group] ?? group

  const handleAdd = async () => {
    if (!newValue.trim() || !user) return
    setError(null)
    setSaving(true)

    // Labels are stored lower-case so the same label is never spelled two ways
    const value = group === 'label' ? newValue.trim().toLowerCase() : newValue.trim()
    const { error: err } = await addOption(group, value, value, user.id)
    if (err) {
      setError((err as { message?: string }).message ?? 'Failed to add option')
    } else {
      setNewValue('')
      setAddingNew(false)
    }
    setSaving(false)
  }

  const handleEdit = async (opt: EnumOption) => {
    if (!editValue.trim() || editValue.trim() === opt.value) {
      setEditingId(null)
      return
    }
    setEditSaving(true)
    const { error: err } = await updateOption(opt.id, {
      value: editValue.trim(),
      label: editValue.trim(),
    })
    if (err) {
      setError((err as { message?: string }).message ?? 'Failed to update option')
    }
    setEditSaving(false)
    setEditingId(null)
  }

  const handleDelete = async (id: string) => {
    setError(null)
    const { error: err } = await deleteOption(id)
    if (err) {
      setError((err as { message?: string }).message ?? 'Failed to delete option')
    }
    setDeleteConfirmId(null)
  }

  const startEdit = (opt: EnumOption) => {
    setEditingId(opt.id)
    setEditValue(opt.value)
    setDeleteConfirmId(null)
  }

  const inputStyle = {
    background: 'var(--bg-input)',
    color: 'var(--text-primary)',
    border: '1px solid var(--border-input)',
  }

  return (
    <div>
      {error && (
        <div
          className="mb-3 rounded-md px-3 py-2 text-xs"
          style={{ background: 'rgba(196,78,82,0.15)', color: 'var(--danger)' }}
        >
          {error}
          <button
            onClick={() => setError(null)}
            className="ml-2"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)' }}
          >
            &times;
          </button>
        </div>
      )}

      {/* Options list */}
      <div className="flex flex-col gap-1">
        {options.map((opt) => (
          <div
            key={opt.id}
            className="group flex items-center gap-2 rounded-md px-3 py-2"
            style={{ background: 'var(--hover-faint)' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--hover-subtle)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--hover-faint)' }}
          >
            {editingId === opt.id ? (
              /* Editing mode */
              <div className="flex flex-1 items-center gap-2">
                <input
                  type="text"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleEdit(opt)
                    if (e.key === 'Escape') setEditingId(null)
                  }}
                  className="flex-1 rounded-md px-2 py-1 text-sm outline-none"
                  style={inputStyle}
                  autoFocus
                  disabled={editSaving}
                />
                <button
                  onClick={() => handleEdit(opt)}
                  disabled={editSaving}
                  className="rounded px-2 py-1 text-xs"
                  style={{ background: 'var(--accent)', color: '#fff', border: 'none', cursor: 'pointer' }}
                >
                  {editSaving ? '...' : 'Save'}
                </button>
                <button
                  onClick={() => setEditingId(null)}
                  className="rounded px-2 py-1 text-xs"
                  style={{ background: 'var(--hover-light)', color: 'var(--text-secondary)', border: 'none', cursor: 'pointer' }}
                >
                  Cancel
                </button>
              </div>
            ) : (
              /* Display mode */
              <>
                <span className="flex-1 text-sm" style={{ color: 'var(--text-primary)' }}>
                  {opt.label}
                </span>

                {opt.is_default && (
                  <span
                    className="rounded-full px-2 py-0.5 text-xs"
                    style={{ background: 'var(--hover-light)', color: 'var(--text-faint)' }}
                    title="Default option — cannot be removed"
                  >
                    default
                  </span>
                )}

                {/* Edit / delete buttons */}
                {deleteConfirmId === opt.id ? (
                  <div className="flex items-center gap-1">
                    <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Remove?</span>
                    <button
                      onClick={() => handleDelete(opt.id)}
                      className="rounded px-2 py-0.5 text-xs"
                      style={{ background: 'var(--danger)', color: '#fff', border: 'none', cursor: 'pointer' }}
                    >
                      Yes
                    </button>
                    <button
                      onClick={() => setDeleteConfirmId(null)}
                      className="rounded px-2 py-0.5 text-xs"
                      style={{ background: 'var(--hover-light)', color: 'var(--text-primary)', border: 'none', cursor: 'pointer' }}
                    >
                      No
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      onClick={() => startEdit(opt)}
                      className="rounded px-2 py-0.5 text-xs"
                      style={{ background: 'rgba(76,114,176,0.15)', color: 'var(--accent)', border: 'none', cursor: 'pointer' }}
                    >
                      Edit
                    </button>
                    {opt.is_default ? (
                      <span
                        className="px-2 py-0.5 text-xs"
                        style={{ color: 'var(--text-faint)', cursor: 'not-allowed' }}
                        title="Default options cannot be removed"
                      >
                        &#x1F512;
                      </span>
                    ) : (
                      <button
                        onClick={() => setDeleteConfirmId(opt.id)}
                        className="rounded px-2 py-0.5 text-xs"
                        style={{ background: 'rgba(196,78,82,0.15)', color: 'var(--danger)', border: 'none', cursor: 'pointer' }}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        ))}
      </div>

      {/* Empty state */}
      {options.length === 0 && (
        <p className="py-4 text-center text-sm" style={{ color: 'var(--text-faint)' }}>
          No options configured yet.
        </p>
      )}

      {/* Add new option */}
      {addingNew ? (
        <div
          className="mt-3 rounded-md p-3"
          style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-subtle)' }}
        >
          <p className="mb-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
            This will be available as a permanent option across the CRM.
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder={`New ${groupLabel.toLowerCase()}...`}
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAdd()
                if (e.key === 'Escape') { setAddingNew(false); setNewValue('') }
              }}
              className="flex-1 rounded-md px-3 py-1.5 text-sm outline-none"
              style={inputStyle}
              autoFocus
              disabled={saving}
            />
            <button
              onClick={handleAdd}
              disabled={saving || !newValue.trim()}
              className="rounded-md px-4 py-1.5 text-sm font-medium"
              style={{
                background: saving || !newValue.trim() ? 'var(--hover-light)' : 'var(--accent)',
                color: saving || !newValue.trim() ? 'var(--text-faint)' : '#fff',
                border: 'none',
                cursor: saving || !newValue.trim() ? 'not-allowed' : 'pointer',
              }}
            >
              {saving ? 'Adding...' : 'Add'}
            </button>
            <button
              onClick={() => { setAddingNew(false); setNewValue('') }}
              className="rounded-md px-3 py-1.5 text-sm"
              style={{ background: 'var(--hover-light)', color: 'var(--text-secondary)', border: 'none', cursor: 'pointer' }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setAddingNew(true)}
          className="mt-3 w-full rounded-md px-3 py-2 text-sm transition-colors"
          style={{
            background: 'var(--hover-faint)',
            color: 'var(--accent)',
            border: '1px dashed var(--border-subtle)',
            cursor: 'pointer',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--hover-subtle)'
            e.currentTarget.style.borderColor = 'var(--accent)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'var(--hover-faint)'
            e.currentTarget.style.borderColor = 'var(--border-subtle)'
          }}
        >
          + Add New {groupLabel}
        </button>
      )}
    </div>
  )
}
