'use client'

import { useState, useMemo } from 'react'
import type { Contact } from '@/lib/types'
import { findDuplicates, type DuplicateGroup } from '@/lib/duplicateDetection'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/hooks/useToast'

interface DuplicateDetectionPanelProps {
  contacts: Contact[]
  userId: string
  onClose: () => void
  onMerged: () => void
}

type MergeField = 'name' | 'org' | 'email' | 'phone' | 'category' | 'status' |
  'priority' | 'warmth' | 'location' | 'website' | 'investor_type' | 'region' |
  'notes'

const MERGE_FIELDS: { key: MergeField; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'org', label: 'Organization' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'category', label: 'Type' },
  { key: 'status', label: 'Status' },
  { key: 'priority', label: 'Priority' },
  { key: 'warmth', label: 'Warmth' },
  { key: 'location', label: 'Location' },
  { key: 'website', label: 'Website' },
  { key: 'investor_type', label: 'Investor Type' },
  { key: 'region', label: 'Region' },
  { key: 'notes', label: 'Notes' },
]

// Notes merge options
type NotesMergeMode = 'pick' | 'combine'

export default function DuplicateDetectionPanel({
  contacts,
  userId,
  onClose,
  onMerged,
}: DuplicateDetectionPanelProps) {
  const [mergeTarget, setMergeTarget] = useState<DuplicateGroup | null>(null)
  const [fieldChoices, setFieldChoices] = useState<Record<MergeField, 0 | 1>>({} as Record<MergeField, 0 | 1>)
  const [primaryIdx, setPrimaryIdx] = useState<0 | 1>(0)
  const [notesMergeMode, setNotesMergeMode] = useState<NotesMergeMode>('combine')
  const [confirmingMerge, setConfirmingMerge] = useState(false)
  const [merging, setMerging] = useState(false)
  const [dismissedPairs, setDismissedPairs] = useState<Set<string>>(new Set())
  const [mergedPairs, setMergedPairs] = useState<Set<string>>(new Set())
  const { toast } = useToast()

  const duplicates = useMemo(() => findDuplicates(contacts), [contacts])

  const visibleDuplicates = duplicates.filter((group) => {
    const key = [group.contacts[0].id, group.contacts[1].id].sort().join(':')
    return !dismissedPairs.has(key) && !mergedPairs.has(key)
  })

  const dismissPair = (group: DuplicateGroup) => {
    const key = [group.contacts[0].id, group.contacts[1].id].sort().join(':')
    setDismissedPairs((prev) => new Set(prev).add(key))
  }

  const startMerge = (group: DuplicateGroup) => {
    // Auto-select: for each field, pick whichever has data (prefer contact[0])
    const choices = {} as Record<MergeField, 0 | 1>
    MERGE_FIELDS.forEach(({ key }) => {
      const val0 = group.contacts[0][key] as string
      const val1 = group.contacts[1][key] as string
      choices[key] = val0 && val0.trim() ? 0 : val1 && val1.trim() ? 1 : 0
    })
    setFieldChoices(choices)
    setPrimaryIdx(0)
    setNotesMergeMode('combine')
    setConfirmingMerge(false)
    setMergeTarget(group)
  }

  const executeMerge = async () => {
    if (!mergeTarget) return
    setMerging(true)

    // Determine winner/loser based on user's primary selection
    const winner = mergeTarget.contacts[primaryIdx]
    const loser = mergeTarget.contacts[primaryIdx === 0 ? 1 : 0]
    const loserIdx = primaryIdx === 0 ? 1 : 0

    // Build the merged field values from user's field-by-field choices.
    // Empty means '' rather than null: Harold's schema keeps these text columns non-null.
    // (Pipeline entries, labels, interactions and tasks move across in merge_contacts.)
    const updates: Record<string, string> = {}
    MERGE_FIELDS.forEach(({ key }) => {
      if (key === 'notes') {
        // Handle notes based on merge mode
        if (notesMergeMode === 'combine') {
          const notes0 = mergeTarget.contacts[0].notes?.trim() ?? ''
          const notes1 = mergeTarget.contacts[1].notes?.trim() ?? ''
          if (notes0 && notes1 && notes0 !== notes1) {
            const otherName = mergeTarget.contacts[loserIdx].name
            updates.notes = `${notes0}\n\n--- Merged from ${otherName} ---\n${notes1}`
          } else {
            updates.notes = notes0 || notes1 || ''
          }
        } else {
          // 'pick' mode — use whichever the user selected
          const chosenIdx = fieldChoices[key] ?? 0
          const val = mergeTarget.contacts[chosenIdx][key] as string
          updates.notes = val?.trim() || ''
        }
      } else {
        // For all other fields, use the user's choice
        const chosenIdx = fieldChoices[key] ?? 0
        // Map the choice relative to our winner/loser (choices are 0/1 index into contacts array)
        const chosen = mergeTarget.contacts[chosenIdx]
        const value = chosen[key] as string
        updates[key] = value?.trim() || ''
      }
    })

    const supabase = createClient()

    // Step 1: Update the winner contact with the user's merged field selections
    const { error: updateError } = await supabase
      .from('contacts')
      .update({ ...updates, updated_by: userId })
      .eq('id', winner.id)

    if (updateError) {
      toast({ title: `Failed to update contact: ${updateError.message}`, type: 'error' })
      setMerging(false)
      setConfirmingMerge(false)
      return
    }

    // Step 2: Use the atomic merge_contacts RPC to handle all relational
    // reassignment (interactions, tasks, audit_log, contact_categories,
    // custom_values, stage_changes) and deletion in a single transaction
    const { error: rpcError } = await supabase.rpc('merge_contacts', {
      primary_id: winner.id,
      secondary_id: loser.id,
      merge_user_id: userId,
    })

    if (rpcError) {
      toast({ title: `Merge failed: ${rpcError.message}`, type: 'error' })
      setMerging(false)
      setConfirmingMerge(false)
      return
    }

    toast({ title: `Merged "${loser.name}" into "${winner.name}"`, type: 'success' })

    // Track this pair as merged so it disappears from the list
    const pairKey = [mergeTarget.contacts[0].id, mergeTarget.contacts[1].id].sort().join(':')
    setMergedPairs((prev) => new Set(prev).add(pairKey))

    setMerging(false)
    setMergeTarget(null)
    setConfirmingMerge(false)

    // Notify parent to refresh contacts but DON'T close the panel
    onMerged()
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center"
      style={{ background: 'var(--bg-overlay)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="relative w-full max-w-2xl rounded-xl p-6 shadow-2xl"
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-subtle)',
          maxHeight: '85vh',
          overflowY: 'auto',
        }}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute right-4 top-4 flex h-7 w-7 items-center justify-center rounded-full transition-colors"
          style={{ background: 'var(--hover-subtle)', color: 'var(--text-secondary)', border: 'none', cursor: 'pointer' }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--hover-medium)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--hover-subtle)')}
        >
          ✕
        </button>

        {!mergeTarget ? (
          /* ─── Duplicate List View ─── */
          <>
            <h2 className="mb-1 text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
              🔍 Duplicate Detection
            </h2>
            <p className="mb-4 text-xs" style={{ color: 'var(--text-secondary)' }}>
              Found {visibleDuplicates.length} potential duplicate{visibleDuplicates.length !== 1 ? 's' : ''} among {contacts.length} contacts.
            </p>

            {visibleDuplicates.length === 0 ? (
              <div className="py-10 text-center">
                <span className="text-3xl">✅</span>
                <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                  No duplicates found. Your contact list is clean!
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {visibleDuplicates.map((group) => {
                  const [a, b] = group.contacts
                  const pct = Math.round(group.score * 100)
                  const pairKey = [a.id, b.id].sort().join(':')
                  return (
                    <div
                      key={pairKey}
                      className="rounded-lg p-4"
                      style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-subtle)' }}
                    >
                      <div className="mb-2 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span
                            className="rounded-full px-2 py-0.5 text-xs font-bold"
                            style={{
                              background: pct >= 80 ? 'rgba(196,78,82,0.2)' : pct >= 50 ? 'rgba(221,132,82,0.2)' : 'rgba(76,114,176,0.2)',
                              color: pct >= 80 ? 'var(--danger)' : pct >= 50 ? '#DD8452' : 'var(--accent)',
                            }}
                          >
                            {pct}% match
                          </span>
                          <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
                            {group.reasons.join(' · ')}
                          </span>
                        </div>
                        <button
                          onClick={() => dismissPair(group)}
                          className="rounded px-2 py-0.5 text-xs transition-colors"
                          style={{ background: 'transparent', color: 'var(--text-faint)', border: 'none', cursor: 'pointer' }}
                          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-secondary)')}
                          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-faint)')}
                          title="Not a duplicate — dismiss"
                        >
                          Not a dup
                        </button>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <ContactCard contact={a} />
                        <ContactCard contact={b} />
                      </div>

                      <div className="mt-3 flex justify-end">
                        <button
                          onClick={() => startMerge(group)}
                          className="rounded-md px-4 py-1.5 text-xs font-medium transition-colors"
                          style={{ background: 'var(--accent)', color: '#ffffff', border: 'none', cursor: 'pointer' }}
                        >
                          Merge →
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        ) : (
          /* ─── Field-by-Field Merge View ─── */
          <>
            <h2 className="mb-1 text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
              ⚡ Merge Contacts
            </h2>

            {/* Primary contact selector */}
            <div className="mb-4 rounded-lg p-3" style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-subtle)' }}>
              <p className="mb-2 text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                Which contact should survive? (the other will be deleted)
              </p>
              <div className="grid grid-cols-2 gap-2">
                {([0, 1] as const).map((idx) => (
                  <button
                    key={idx}
                    onClick={() => setPrimaryIdx(idx)}
                    className="rounded-md p-2 text-left text-xs transition-colors"
                    style={{
                      background: primaryIdx === idx ? 'rgba(76,114,176,0.15)' : 'transparent',
                      border: primaryIdx === idx ? '2px solid var(--accent)' : '1px solid var(--border-subtle)',
                      cursor: 'pointer',
                      color: 'var(--text-primary)',
                    }}
                  >
                    <span className="font-medium">{mergeTarget.contacts[idx].name}</span>
                    {mergeTarget.contacts[idx].org && (
                      <span style={{ color: 'var(--text-faint)' }}> · {mergeTarget.contacts[idx].org}</span>
                    )}
                    {primaryIdx === idx && (
                      <span className="ml-1 text-xs font-bold" style={{ color: 'var(--accent)' }}>✓ keeps</span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            <p className="mb-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
              Pick the winning value for each field:
            </p>

            <div className="mb-4 flex flex-col gap-1">
              {MERGE_FIELDS.map(({ key, label }) => {
                const val0 = (mergeTarget.contacts[0][key] as string) ?? ''
                const val1 = (mergeTarget.contacts[1][key] as string) ?? ''
                if (!val0.trim() && !val1.trim()) return null

                const selected = fieldChoices[key] ?? 0

                // Special notes row with combine toggle
                if (key === 'notes' && val0.trim() && val1.trim() && val0.trim() !== val1.trim()) {
                  return (
                    <div key={key}>
                      <div
                        className="grid items-center gap-2 rounded px-2 py-1.5"
                        style={{ gridTemplateColumns: '100px 1fr 1fr' }}
                      >
                        <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                          {label}
                        </span>
                        <FieldOption
                          value={val0}
                          isSelected={notesMergeMode === 'pick' && selected === 0}
                          onClick={() => { setNotesMergeMode('pick'); setFieldChoices((prev) => ({ ...prev, notes: 0 })) }}
                        />
                        <FieldOption
                          value={val1}
                          isSelected={notesMergeMode === 'pick' && selected === 1}
                          onClick={() => { setNotesMergeMode('pick'); setFieldChoices((prev) => ({ ...prev, notes: 1 })) }}
                        />
                      </div>
                      <div className="ml-[100px] mt-1 px-2">
                        <button
                          onClick={() => setNotesMergeMode(notesMergeMode === 'combine' ? 'pick' : 'combine')}
                          className="rounded px-2 py-0.5 text-xs transition-colors"
                          style={{
                            background: notesMergeMode === 'combine' ? 'rgba(85,168,104,0.15)' : 'transparent',
                            color: notesMergeMode === 'combine' ? '#55A868' : 'var(--text-faint)',
                            border: notesMergeMode === 'combine' ? '1px solid #55A868' : '1px solid var(--border-subtle)',
                            cursor: 'pointer',
                          }}
                        >
                          {notesMergeMode === 'combine' ? '✓ Combining both notes' : 'Combine both notes'}
                        </button>
                      </div>
                    </div>
                  )
                }

                return (
                  <div
                    key={key}
                    className="grid items-center gap-2 rounded px-2 py-1.5"
                    style={{ gridTemplateColumns: '100px 1fr 1fr' }}
                  >
                    <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                      {label}
                    </span>
                    <FieldOption
                      value={val0}
                      isSelected={selected === 0}
                      onClick={() => setFieldChoices((prev) => ({ ...prev, [key]: 0 }))}
                    />
                    <FieldOption
                      value={val1}
                      isSelected={selected === 1}
                      onClick={() => setFieldChoices((prev) => ({ ...prev, [key]: 1 }))}
                    />
                  </div>
                )
              })}
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setMergeTarget(null); setConfirmingMerge(false) }}
                className="rounded-md px-4 py-1.5 text-sm transition-colors"
                style={{ background: 'var(--hover-light)', color: 'var(--text-primary)', border: 'none', cursor: 'pointer' }}
              >
                Back
              </button>

              {!confirmingMerge ? (
                <button
                  onClick={() => setConfirmingMerge(true)}
                  className="rounded-md px-4 py-1.5 text-sm font-medium transition-colors"
                  style={{
                    background: 'var(--danger)',
                    color: '#ffffff',
                    border: 'none',
                    cursor: 'pointer',
                  }}
                >
                  Merge Contacts
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-xs" style={{ color: 'var(--danger)' }}>
                    Delete &ldquo;{mergeTarget.contacts[primaryIdx === 0 ? 1 : 0].name}&rdquo; permanently?
                  </span>
                  <button
                    onClick={() => setConfirmingMerge(false)}
                    className="rounded-md px-3 py-1.5 text-xs transition-colors"
                    style={{ background: 'var(--hover-light)', color: 'var(--text-primary)', border: 'none', cursor: 'pointer' }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={executeMerge}
                    disabled={merging}
                    className="rounded-md px-4 py-1.5 text-sm font-bold transition-colors"
                    style={{
                      background: merging ? 'rgba(196,78,82,0.5)' : 'var(--danger)',
                      color: '#ffffff',
                      border: 'none',
                      cursor: merging ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {merging ? 'Merging...' : 'Confirm Delete & Merge'}
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function ContactCard({ contact }: { contact: Contact }) {
  return (
    <div className="rounded-md p-2.5" style={{ background: 'var(--hover-subtle)' }}>
      <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
        {contact.name}
      </div>
      <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
        {contact.org || '—'}
      </div>
      {contact.email && (
        <div className="mt-0.5 truncate text-xs" style={{ color: 'var(--text-faint)' }}>
          {contact.email}
        </div>
      )}
      {contact.phone && (
        <div className="truncate text-xs" style={{ color: 'var(--text-faint)' }}>
          {contact.phone}
        </div>
      )}
    </div>
  )
}

function FieldOption({
  value,
  isSelected,
  onClick,
}: {
  value: string
  isSelected: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="truncate rounded px-2 py-1 text-left text-xs transition-colors"
      style={{
        background: isSelected ? 'rgba(76,114,176,0.2)' : 'transparent',
        color: isSelected ? 'var(--accent)' : 'var(--text-secondary)',
        border: isSelected ? '1px solid var(--accent)' : '1px solid var(--border-subtle)',
        cursor: 'pointer',
        fontWeight: isSelected ? 600 : 400,
      }}
      title={value || '(empty)'}
    >
      {value || <span style={{ color: 'var(--text-faint)', fontStyle: 'italic' }}>(empty)</span>}
    </button>
  )
}
