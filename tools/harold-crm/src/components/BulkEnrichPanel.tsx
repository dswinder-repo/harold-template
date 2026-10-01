'use client'

import { useState, useMemo } from 'react'
import type { Contact } from '@/lib/types'
import { useEnrichment, type EnrichResult } from '@/hooks/useEnrichment'

interface BulkEnrichPanelProps {
  contacts: Contact[]
  userId: string
  onClose: () => void
}

const ENRICHABLE = [
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'website', label: 'Website' },
  { key: 'location', label: 'Location' },
  { key: 'focus_area', label: 'Focus Area', hint: 'Best effort — may be less accurate' },
] as const

type FieldKey = (typeof ENRICHABLE)[number]['key']

export default function BulkEnrichPanel({ contacts, userId, onClose }: BulkEnrichPanelProps) {
  const [selectedFields, setSelectedFields] = useState<Set<FieldKey>>(new Set(['email', 'phone', 'website']))
  const { enriching, progress, results, errors, startBulkEnrich, cancel, applyUpdate, dismissUpdate } =
    useEnrichment()

  // Compute how many contacts are missing each field
  const missingCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const f of ENRICHABLE) {
      counts[f.key] = contacts.filter((c) => !c[f.key as keyof Contact]).length
    }
    return counts
  }, [contacts])

  // Contacts that need enrichment for selected fields
  const eligibleContacts = useMemo(() => {
    return contacts.filter((c) =>
      Array.from(selectedFields).some((f) => !c[f as keyof Contact])
    )
  }, [contacts, selectedFields])

  const toggleField = (key: FieldKey) => {
    setSelectedFields((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const handleStart = () => {
    if (eligibleContacts.length === 0 || selectedFields.size === 0) return
    startBulkEnrich(eligibleContacts, Array.from(selectedFields), userId)
  }

  // Tally results
  const totalApplied = results.reduce((sum, r) => sum + r.applied.length, 0)
  const totalReview = results.reduce((sum, r) => sum + r.needsReview.length, 0)
  const isDone = !enriching && progress.total > 0

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'var(--bg-overlay)',
          zIndex: 998,
        }}
      />

      {/* Panel */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: 500,
          maxWidth: '100vw',
          background: 'var(--bg-card)',
          borderLeft: '1px solid var(--border-subtle)',
          zIndex: 999,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 20px',
            borderBottom: '1px solid var(--border-subtle)',
            flexShrink: 0,
          }}
        >
          <div>
            <span style={{ fontWeight: 600, fontSize: 15, color: 'var(--text-primary)' }}>
              ✨ Bulk Enrich Contacts
            </span>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
              AI-powered search for missing contact data
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-tertiary)',
              cursor: 'pointer',
              fontSize: 18,
              padding: '2px 6px',
              borderRadius: 4,
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        {/* Content — scrollable */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: 20,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          {/* Field selector */}
          {!enriching && !isDone && (
            <>
              <div>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: 'var(--text-tertiary)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    marginBottom: 8,
                  }}
                >
                  Fields to Enrich
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {ENRICHABLE.map((f) => (
                    <label
                      key={f.key}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        cursor: 'pointer',
                        padding: '6px 10px',
                        borderRadius: 6,
                        background: selectedFields.has(f.key)
                          ? 'rgba(76,114,176,0.1)'
                          : 'transparent',
                        transition: 'background 0.15s',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedFields.has(f.key)}
                        onChange={() => toggleField(f.key)}
                        style={{ accentColor: 'var(--accent)' }}
                      />
                      <span style={{ fontSize: 13, color: 'var(--text-primary)', flex: 1 }}>
                        {f.label}
                        <span style={{ color: 'var(--text-faint)', marginLeft: 6 }}>
                          ({missingCounts[f.key]} missing)
                        </span>
                      </span>
                      {'hint' in f && (
                        <span style={{ fontSize: 11, color: 'var(--text-faint)', fontStyle: 'italic' }}>
                          {f.hint}
                        </span>
                      )}
                    </label>
                  ))}
                </div>
              </div>

              {/* Preview */}
              <div
                style={{
                  padding: '12px 14px',
                  borderRadius: 8,
                  background: 'var(--bg-primary)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                  <strong>{eligibleContacts.length}</strong> contacts have missing data for the selected fields.
                  {eligibleContacts.length > 0 && (
                    <span style={{ display: 'block', marginTop: 4, fontSize: 12, color: 'var(--text-faint)' }}>
                      Estimated time: ~{Math.ceil((eligibleContacts.length * 2) / 60)} min
                      ({eligibleContacts.length} × ~2s each)
                    </span>
                  )}
                </span>
              </div>
            </>
          )}

          {/* Progress bar */}
          {enriching && (
            <div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginBottom: 6,
                  fontSize: 12,
                  color: 'var(--text-secondary)',
                }}
              >
                <span>Enriching: {progress.current}</span>
                <span>
                  {progress.done} / {progress.total}
                </span>
              </div>
              <div
                style={{
                  height: 6,
                  borderRadius: 3,
                  background: 'var(--hover-subtle)',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    borderRadius: 3,
                    background: 'var(--accent)',
                    width: `${progress.total > 0 ? (progress.done / progress.total) * 100 : 0}%`,
                    transition: 'width 0.3s ease',
                  }}
                />
              </div>
              {totalApplied > 0 && (
                <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 6 }}>
                  {totalApplied} fields updated so far...
                </div>
              )}
            </div>
          )}

          {/* Results summary */}
          {isDone && (
            <div
              style={{
                padding: '12px 14px',
                borderRadius: 8,
                background: 'rgba(85,168,104,0.1)',
                border: '1px solid rgba(85,168,104,0.3)',
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 600, color: '#55A868' }}>
                ✓ Enrichment Complete
              </span>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
                <strong>{totalApplied}</strong> fields auto-updated (high confidence).
                {totalReview > 0 && (
                  <> <strong>{totalReview}</strong> suggestions need review below.</>
                )}
                {errors.length > 0 && (
                  <> <strong>{errors.length}</strong> errors occurred.</>
                )}
              </div>
            </div>
          )}

          {/* Review list */}
          {isDone && results.filter((r) => r.needsReview.length > 0).length > 0 && (
            <div>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: 'var(--text-tertiary)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  marginBottom: 8,
                }}
              >
                Suggestions for Review
              </div>
              {results
                .filter((r) => r.needsReview.length > 0)
                .map((r) => (
                  <ReviewBlock
                    key={r.contactId}
                    result={r}
                    userId={userId}
                    onApply={applyUpdate}
                    onDismiss={dismissUpdate}
                  />
                ))}
            </div>
          )}

          {/* Errors */}
          {errors.length > 0 && (
            <div>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: 'var(--text-tertiary)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  marginBottom: 6,
                }}
              >
                Errors ({errors.length})
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: 'var(--text-faint)',
                  maxHeight: 120,
                  overflowY: 'auto',
                }}
              >
                {errors.map((e, i) => (
                  <div key={i}>• {e}</div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            gap: 10,
            padding: '14px 20px',
            borderTop: '1px solid var(--border-subtle)',
            flexShrink: 0,
          }}
        >
          {!enriching && !isDone && (
            <button
              onClick={handleStart}
              disabled={eligibleContacts.length === 0 || selectedFields.size === 0}
              style={{
                flex: 1,
                padding: '9px 16px',
                background:
                  eligibleContacts.length > 0 && selectedFields.size > 0
                    ? 'var(--accent)'
                    : 'var(--bg-input)',
                color:
                  eligibleContacts.length > 0 && selectedFields.size > 0
                    ? '#fff'
                    : 'var(--text-faint)',
                border: 'none',
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 500,
                cursor:
                  eligibleContacts.length > 0 && selectedFields.size > 0
                    ? 'pointer'
                    : 'not-allowed',
                transition: 'all 0.15s',
              }}
            >
              Start Enrichment ({eligibleContacts.length} contacts)
            </button>
          )}

          {enriching && (
            <button
              onClick={cancel}
              style={{
                flex: 1,
                padding: '9px 16px',
                background: 'rgba(196,78,82,0.15)',
                color: 'var(--danger)',
                border: 'none',
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          )}

          {isDone && (
            <button
              onClick={onClose}
              style={{
                flex: 1,
                padding: '9px 16px',
                background: 'var(--hover-light)',
                color: 'var(--text-primary)',
                border: 'none',
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Close
            </button>
          )}
        </div>
      </div>
    </>
  )
}

// ── Review Block sub-component ───────────────────────────────

function ReviewBlock({
  result,
  userId,
  onApply,
  onDismiss,
}: {
  result: EnrichResult
  userId: string
  onApply: (contactId: string, field: string, value: string, userId: string) => Promise<void>
  onDismiss: (contactId: string, field: string) => void
}) {
  return (
    <div
      style={{
        padding: '10px 12px',
        borderRadius: 8,
        background: 'var(--bg-primary)',
        border: '1px solid var(--border-subtle)',
        marginBottom: 8,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>
        {result.contactName}
      </div>
      {result.needsReview.map((s) => (
        <div
          key={`${result.contactId}-${s.field}`}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '4px 0',
            fontSize: 12,
          }}
        >
          <span style={{ color: 'var(--text-secondary)', minWidth: 70 }}>{s.field}</span>
          <span style={{ color: 'var(--text-primary)', flex: 1, wordBreak: 'break-all' }}>
            {s.suggestedValue}
          </span>
          <span
            style={{
              fontSize: 10,
              padding: '1px 5px',
              borderRadius: 4,
              background: s.confidence === 'medium' ? 'rgba(221,132,82,0.15)' : 'rgba(196,78,82,0.15)',
              color: s.confidence === 'medium' ? '#DD8452' : '#C44E52',
            }}
          >
            {s.confidence}
          </span>
          <button
            onClick={() => onApply(result.contactId, s.field, s.suggestedValue, userId)}
            style={{
              background: 'rgba(85,168,104,0.15)',
              color: '#55A868',
              border: 'none',
              borderRadius: 4,
              padding: '2px 8px',
              fontSize: 11,
              cursor: 'pointer',
              fontWeight: 500,
            }}
          >
            Apply
          </button>
          <button
            onClick={() => onDismiss(result.contactId, s.field)}
            style={{
              background: 'var(--hover-subtle)',
              color: 'var(--text-faint)',
              border: 'none',
              borderRadius: 4,
              padding: '2px 8px',
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            Skip
          </button>
        </div>
      ))}
    </div>
  )
}
