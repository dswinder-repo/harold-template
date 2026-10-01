'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ENRICHABLE_FIELDS, type ResearchResult, type SuggestedUpdate } from '@/lib/research'

interface ResearchPanelProps {
  research: ResearchResult | null
  loading: boolean
  error: string | null
  contactId: string
  onClose: () => void
  onRetry: () => void
}

const LOADING_MESSAGES = [
  'Searching the web...',
  'Analyzing results...',
  'Reviewing news sources...',
  'Compiling intelligence...',
  'Preparing report...',
]

export default function ResearchPanel({
  research,
  loading,
  error,
  contactId,
  onClose,
  onRetry,
}: ResearchPanelProps) {
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
          width: 540,
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--accent)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            <span style={{ color: 'var(--text-primary)', fontSize: 15, fontWeight: 600 }}>
              AI Research Report
            </span>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              fontSize: 18,
              cursor: 'pointer',
              padding: '4px 8px',
              borderRadius: 4,
            }}
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
          {loading && <LoadingSkeleton />}
          {error && <ErrorState error={error} onRetry={onRetry} />}
          {research && !loading && (
            <ResearchContent research={research} contactId={contactId} />
          )}
        </div>
      </div>
    </>
  )
}

// ── Loading skeleton ────────────────────────────────────────

function LoadingSkeleton() {
  const [messageIndex, setMessageIndex] = useState(0)

  // Rotate messages
  useState(() => {
    const interval = setInterval(() => {
      setMessageIndex((prev) => (prev + 1) % LOADING_MESSAGES.length)
    }, 3000)
    return () => clearInterval(interval)
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '12px 16px',
          background: 'var(--bg-card)',
          borderRadius: 8,
          border: '1px solid var(--border-subtle)',
        }}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2"
          style={{ animation: 'spin 1s linear infinite' }}
        >
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
        </svg>
        <span style={{ color: 'var(--text-soft, #ccc)', fontSize: 13 }}>{LOADING_MESSAGES[messageIndex]}</span>
      </div>

      {[...Array(4)].map((_, i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div
            style={{
              height: 14,
              width: `${60 + i * 10}%`,
              background: 'var(--bg-card)',
              borderRadius: 4,
              animation: 'pulse 1.5s ease-in-out infinite',
              animationDelay: `${i * 0.2}s`,
            }}
          />
          <div
            style={{
              height: 10,
              width: '100%',
              background: 'var(--bg-primary)',
              borderRadius: 4,
              animation: 'pulse 1.5s ease-in-out infinite',
              animationDelay: `${i * 0.2 + 0.1}s`,
            }}
          />
          <div
            style={{
              height: 10,
              width: '85%',
              background: 'var(--bg-primary)',
              borderRadius: 4,
              animation: 'pulse 1.5s ease-in-out infinite',
              animationDelay: `${i * 0.2 + 0.2}s`,
            }}
          />
        </div>
      ))}

      <style>{`@keyframes pulse { 0%, 100% { opacity: 0.4 } 50% { opacity: 0.8 } }`}</style>
    </div>
  )
}

// ── Error state ─────────────────────────────────────────────

function ErrorState({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div
      style={{
        padding: '24px',
        background: 'rgba(196,78,82,0.08)',
        border: '1px solid rgba(196,78,82,0.2)',
        borderRadius: 8,
        textAlign: 'center',
      }}
    >
      <div style={{ color: 'var(--danger)', fontSize: 14, fontWeight: 500, marginBottom: 8 }}>
        Research failed
      </div>
      <div style={{ color: 'var(--text-tertiary, #888)', fontSize: 13, marginBottom: 16 }}>{error}</div>
      <button
        onClick={onRetry}
        style={{
          padding: '7px 16px',
          background: 'var(--accent)',
          color: '#fff',
          border: 'none',
          borderRadius: 6,
          fontSize: 13,
          cursor: 'pointer',
        }}
      >
        Retry
      </button>
    </div>
  )
}

// ── Research content ────────────────────────────────────────

function ResearchContent({
  research,
  contactId,
}: {
  research: ResearchResult
  contactId: string
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Meta line */}
      <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>
        Searched {new Date(research.searchedAt).toLocaleString()} · {research.model}
      </div>

      {/* Summary */}
      {research.summary && (
        <div
          style={{
            padding: '12px 16px',
            background: 'rgba(76,114,176,0.08)',
            border: '1px solid rgba(76,114,176,0.15)',
            borderRadius: 8,
            color: 'var(--text-soft, #ccc)',
            fontSize: 13,
            lineHeight: 1.6,
          }}
        >
          {research.summary}
        </div>
      )}

      {/* Sections */}
      {research.sections.map((section, i) => (
        <div key={i}>
          <h3
            style={{
              color: 'var(--text-primary)',
              fontSize: 14,
              fontWeight: 600,
              margin: '0 0 8px',
              paddingBottom: 6,
              borderBottom: '1px solid var(--border-subtle)',
            }}
          >
            {section.title}
          </h3>
          <div
            style={{
              color: 'var(--text-secondary)',
              fontSize: 13,
              lineHeight: 1.65,
              whiteSpace: 'pre-wrap',
            }}
          >
            {section.content}
          </div>
        </div>
      ))}

      {/* Suggested Updates */}
      {research.suggestedUpdates.length > 0 && (
        <SuggestedUpdatesCard updates={research.suggestedUpdates} contactId={contactId} />
      )}

      {/* Citations */}
      {research.citations.length > 0 && (
        <div>
          <h3
            style={{
              color: 'var(--text-primary)',
              fontSize: 14,
              fontWeight: 600,
              margin: '0 0 8px',
              paddingBottom: 6,
              borderBottom: '1px solid var(--border-subtle)',
            }}
          >
            Sources
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {research.citations.map((citation, i) => (
              <a
                key={i}
                href={citation.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: 'var(--accent)',
                  fontSize: 12,
                  textDecoration: 'none',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {i + 1}. {citation.title || citation.url}
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Suggested updates card ──────────────────────────────────

function SuggestedUpdatesCard({
  updates,
  contactId,
}: {
  updates: SuggestedUpdate[]
  contactId: string
}) {
  const [applied, setApplied] = useState<Record<string, boolean>>({})
  const [skipped, setSkipped] = useState<Record<string, boolean>>({})
  const supabase = createClient()

  const handleApply = async (update: SuggestedUpdate) => {
    let newValue = update.suggestedValue

    // For notes field: append to existing notes instead of replacing
    if (update.field === 'notes') {
      const { data: contact } = await supabase
        .from('contacts')
        .select('notes')
        .eq('id', contactId)
        .single()

      const existingNotes = (contact?.notes as string) || ''
      const timestamp = new Date().toLocaleDateString()
      const aiNotes = `\n\n--- AI Research (${timestamp}) ---\n${update.suggestedValue}`
      newValue = existingNotes ? existingNotes + aiNotes : aiNotes.trim()
    }

    const { error } = await supabase
      .from('contacts')
      .update({ [update.field]: newValue })
      .eq('id', contactId)

    if (!error) {
      setApplied((prev) => ({ ...prev, [update.field]: true }))
    }
  }

  const confidenceColor: Record<string, string> = {
    high: '#55a868',
    medium: '#DD8452',
    low: '#C44E52',
  }

  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 8,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '10px 14px',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#DD8452"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
        </svg>
        <span style={{ color: 'var(--text-primary)', fontSize: 13, fontWeight: 600 }}>
          Suggested CRM Updates
        </span>
      </div>

      {updates.map((update, i) => {
        const isApplied = applied[update.field]
        const isSkipped = skipped[update.field]
        const fieldLabel = ENRICHABLE_FIELDS[update.field] ?? update.field

        if (isSkipped) return null

        return (
          <div
            key={i}
            style={{
              padding: '10px 14px',
              borderBottom: i < updates.length - 1 ? '1px solid var(--border-subtle)' : 'none',
              display: 'flex',
              flexDirection: update.field === 'notes' ? 'column' : 'row',
              alignItems: update.field === 'notes' ? 'stretch' : 'center',
              gap: 10,
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                <span style={{ color: 'var(--text-secondary)', fontSize: 12, fontWeight: 500 }}>{fieldLabel}</span>
                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 600,
                    padding: '1px 5px',
                    borderRadius: 3,
                    color: confidenceColor[update.confidence],
                    background: `${confidenceColor[update.confidence]}15`,
                    textTransform: 'uppercase',
                  }}
                >
                  {update.confidence}
                </span>
                {update.field === 'notes' && (
                  <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>appends to existing</span>
                )}
              </div>
              <div
                style={{
                  color: 'var(--text-soft, #ccc)',
                  fontSize: 12,
                  ...(update.field === 'notes'
                    ? { lineHeight: 1.5, whiteSpace: 'pre-wrap' }
                    : { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }),
                }}
              >
                {update.suggestedValue}
              </div>
            </div>

            {isApplied ? (
              <span style={{
                color: 'var(--success)',
                fontSize: 12,
                fontWeight: 500,
                flexShrink: 0,
                ...(update.field === 'notes' ? { alignSelf: 'flex-end' } : {}),
              }}>
                ✓ Applied
              </span>
            ) : (
              <div style={{
                display: 'flex',
                gap: 4,
                flexShrink: 0,
                ...(update.field === 'notes' ? { alignSelf: 'flex-end' } : {}),
              }}>
                <button
                  onClick={() => handleApply(update)}
                  style={{
                    padding: '4px 10px',
                    background: 'var(--accent)',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 4,
                    fontSize: 11,
                    cursor: 'pointer',
                  }}
                >
                  Apply
                </button>
                <button
                  onClick={() => setSkipped((prev) => ({ ...prev, [update.field]: true }))}
                  style={{
                    padding: '4px 8px',
                    background: 'none',
                    color: 'var(--text-muted)',
                    border: '1px solid var(--hover-medium)',
                    borderRadius: 4,
                    fontSize: 11,
                    cursor: 'pointer',
                  }}
                >
                  Skip
                </button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
