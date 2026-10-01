'use client'

import { useState, useRef, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/hooks/useToast'
import BulkOutreachPanel from '@/components/BulkOutreachPanel'
import type { Contact, StatusType, WarmthType } from '@/lib/types'
import { getStatusStyle } from '@/lib/types'
import { useEnumOptions } from '@/hooks/useEnumOptions'

interface BulkActionBarProps {
  selectedIds: Set<string>
  contacts: Contact[]
  onClear: () => void
  userId?: string
}

function Dropdown({
  label,
  options,
  onSelect,
  renderOption,
}: {
  label: string
  options: string[]
  onSelect: (val: string) => void
  renderOption?: (val: string) => React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="rounded px-3 py-1.5 text-xs font-medium transition-colors"
        style={{
          background: 'var(--hover-light)',
          color: 'var(--text-primary)',
          border: '1px solid var(--border-subtle)',
          cursor: 'pointer',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--hover-medium)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--hover-light)')}
      >
        {label} ▾
      </button>
      {open && (
        <div
          className="absolute bottom-full z-50 mb-1 rounded-md py-1 shadow-lg"
          style={{ background: 'var(--bg-card)', border: '1px solid var(--hover-medium)', minWidth: '140px' }}
        >
          {options.map((opt) => (
            <button
              key={opt}
              onClick={() => { onSelect(opt); setOpen(false) }}
              className="block w-full px-3 py-1.5 text-left text-xs transition-colors"
              style={{ background: 'transparent', color: 'var(--text-primary)', border: 'none', cursor: 'pointer' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--hover-subtle)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              {renderOption ? renderOption(opt) : opt.charAt(0).toUpperCase() + opt.slice(1)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function BulkActionBar({ selectedIds, contacts, onClear, userId }: BulkActionBarProps) {
  const [working, setWorking] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showMergeConfirm, setShowMergeConfirm] = useState(false)
  const [showBulkOutreach, setShowBulkOutreach] = useState(false)
  const { toast } = useToast()
  const { getOptions } = useEnumOptions()
  const count = selectedIds.size

  // Filter to selected contacts for bulk outreach
  const selectedContacts = contacts.filter((c) => selectedIds.has(c.id))

  async function bulkUpdate(updates: Partial<{ status: StatusType; warmth: WarmthType }>) {
    if (!userId || working) return
    setWorking(true)
    const supabase = createClient()
    const ids = Array.from(selectedIds)
    const { error } = await supabase
      .from('contacts')
      .update({ ...updates, updated_by: userId })
      .in('id', ids)
    setWorking(false)
    if (error) {
      toast({ title: `Failed to update ${count} contacts`, type: 'error' })
    } else {
      toast({ title: `Updated ${count} contacts`, type: 'success' })
      onClear()
    }
  }

  async function bulkDelete() {
    if (!userId || working) return
    setWorking(true)
    const supabase = createClient()
    const ids = Array.from(selectedIds)
    const { error } = await supabase
      .from('contacts')
      .delete()
      .in('id', ids)
    setWorking(false)
    setShowDeleteConfirm(false)
    if (error) {
      toast({ title: `Failed to delete ${count} contacts`, type: 'error' })
    } else {
      toast({ title: `Deleted ${count} contacts`, type: 'success' })
      onClear()
    }
  }

  async function mergeSelected() {
    if (!userId || working || count !== 2) return
    setWorking(true)
    const supabase = createClient()
    const ids = Array.from(selectedIds)
    const { error } = await supabase.rpc('merge_contacts', {
      primary_id: ids[0],
      secondary_id: ids[1],
      merge_user_id: userId,
    })
    setWorking(false)
    setShowMergeConfirm(false)
    if (error) {
      toast({ title: 'Failed to merge contacts', type: 'error' })
    } else {
      toast({ title: 'Contacts merged successfully', type: 'success' })
      onClear()
    }
  }

  return (
    <>
      <div
        className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg px-5 py-3 shadow-xl"
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--accent)',
          backdropFilter: 'blur(8px)',
        }}
      >
        <span className="text-sm font-semibold" style={{ color: 'var(--accent)' }}>
          {count} selected
        </span>

        <div style={{ width: '1px', height: '20px', background: 'var(--border-subtle)' }} />

        <Dropdown
          label="Status"
          options={getOptions('status')}
          onSelect={(val) => bulkUpdate({ status: val as StatusType })}
          renderOption={(val) => {
            const s = getStatusStyle(val)
            return <span style={{ color: s?.text }}>{val.charAt(0).toUpperCase() + val.slice(1)}</span>
          }}
        />

        <Dropdown
          label="Warmth"
          options={getOptions('warmth').filter(Boolean)}
          onSelect={(val) => bulkUpdate({ warmth: val as WarmthType })}
        />

        <button
          onClick={() => setShowBulkOutreach(true)}
          className="rounded px-3 py-1.5 text-xs font-medium transition-colors"
          style={{
            background: 'rgba(76,114,176,0.15)',
            color: '#4C72B0',
            border: '1px solid rgba(76,114,176,0.3)',
            cursor: 'pointer',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(76,114,176,0.25)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(76,114,176,0.15)')}
        >
          ✉ Draft Emails
        </button>

        {count === 2 && (
          <button
            onClick={() => setShowMergeConfirm(true)}
            className="rounded px-3 py-1.5 text-xs font-medium transition-colors"
            style={{
              background: 'rgba(76,114,176,0.15)',
              color: '#4C72B0',
              border: '1px solid rgba(76,114,176,0.3)',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(76,114,176,0.25)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(76,114,176,0.15)')}
          >
            Merge
          </button>
        )}

        <button
          onClick={() => setShowDeleteConfirm(true)}
          className="rounded px-3 py-1.5 text-xs font-medium transition-colors"
          style={{
            background: 'rgba(196,78,82,0.15)',
            color: '#C44E52',
            border: '1px solid rgba(196,78,82,0.3)',
            cursor: 'pointer',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(196,78,82,0.25)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(196,78,82,0.15)')}
        >
          Delete
        </button>

        <div style={{ width: '1px', height: '20px', background: 'var(--border-subtle)' }} />

        <button
          onClick={onClear}
          className="text-xs"
          style={{ color: 'var(--text-secondary)', background: 'none', border: 'none', cursor: 'pointer' }}
        >
          Clear
        </button>

        {working && (
          <div
            className="h-4 w-4 animate-spin rounded-full border-2 border-solid border-current border-r-transparent"
            style={{ color: 'var(--accent)' }}
          />
        )}
      </div>

      {/* Merge Confirmation Modal */}
      {showMergeConfirm && count === 2 && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(2px)' }}
          onClick={() => setShowMergeConfirm(false)}
        >
          <div
            className="rounded-lg p-6 shadow-xl"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', maxWidth: '420px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-2 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              Merge 2 contacts?
            </h3>
            <p className="mb-4 text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              The first selected contact will be kept as primary. Empty fields will be filled from the second contact.
              All interactions, tasks, and activity will be combined. The second contact will be removed.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowMergeConfirm(false)}
                className="rounded px-4 py-2 text-xs"
                style={{ background: 'var(--hover-light)', color: 'var(--text-primary)', border: 'none', cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                onClick={mergeSelected}
                className="rounded px-4 py-2 text-xs font-semibold"
                style={{ background: '#4C72B0', color: '#fff', border: 'none', cursor: 'pointer' }}
              >
                {working ? 'Merging...' : 'Merge Contacts'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Outreach Panel */}
      {showBulkOutreach && (
        <BulkOutreachPanel
          contacts={selectedContacts}
          onClose={() => setShowBulkOutreach(false)}
        />
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(2px)' }}
          onClick={() => setShowDeleteConfirm(false)}
        >
          <div
            className="rounded-lg p-6 shadow-xl"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', maxWidth: '400px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-2 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              Delete {count} contacts?
            </h3>
            <p className="mb-4 text-xs" style={{ color: 'var(--text-secondary)' }}>
              This action cannot be undone. All interactions, tasks, and activity for these contacts will also be deleted.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="rounded px-4 py-2 text-xs"
                style={{ background: 'var(--hover-light)', color: 'var(--text-primary)', border: 'none', cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                onClick={bulkDelete}
                className="rounded px-4 py-2 text-xs font-semibold"
                style={{ background: '#C44E52', color: '#fff', border: 'none', cursor: 'pointer' }}
              >
                {working ? 'Deleting...' : 'Delete All'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
