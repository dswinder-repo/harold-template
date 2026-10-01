'use client'

import { useState } from 'react'
import type { PrepResult } from '@/lib/meetingPrep'

interface PrepPanelProps {
  prep: PrepResult | null
  loading: boolean
  error: string | null
  onClose: () => void
  onRetry: () => void
}

const LOADING_MESSAGES = [
  'Reviewing relationship history...',
  'Analyzing past interactions...',
  'Identifying talking points...',
  'Checking open action items...',
  'Building your brief...',
]

export default function PrepPanel({
  prep,
  loading,
  error,
  onClose,
  onRetry,
}: PrepPanelProps) {
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
              <rect width="20" height="14" x="2" y="7" rx="2" ry="2" />
              <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
            </svg>
            <span style={{ color: 'var(--text-primary)', fontSize: 15, fontWeight: 600 }}>
              Meeting Prep Brief
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
          {prep && !loading && <PrepContent prep={prep} />}
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
        <span style={{ color: 'var(--text-soft, #ccc)', fontSize: 13 }}>
          {LOADING_MESSAGES[messageIndex]}
        </span>
      </div>

      {[...Array(5)].map((_, i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div
            style={{
              height: 14,
              width: `${50 + i * 10}%`,
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
        Meeting prep failed
      </div>
      <div style={{ color: 'var(--text-tertiary, #888)', fontSize: 13, marginBottom: 16 }}>
        {error}
      </div>
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

// ── Prep content ────────────────────────────────────────────

function PrepContent({ prep }: { prep: PrepResult }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Meta line */}
      <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>
        Prepared {new Date(prep.preparedAt).toLocaleString()} · {prep.model}
      </div>

      {/* Summary */}
      {prep.summary && (
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
          {prep.summary}
        </div>
      )}

      {/* Sections */}
      {prep.sections.map((section, i) => (
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
    </div>
  )
}
