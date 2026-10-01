'use client'

import { useState, useRef, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

// Bug reports and feature requests, filed from any page while you use the CRM.
//
// Each one lands in the bug_reports or feature_requests table with the page it
// was filed from, so a later coding session (any AI harness, or you) can read
// the open ones, fix them and mark them resolved. See "Bug reports" in the
// README for the queries.

// ── Page context label ────────────────────────────────────────────────────
function getPageContext(pathname: string): string {
  if (pathname === '/dashboard') return 'Dashboard'
  if (pathname.startsWith('/contacts/new')) return 'New Contact'
  if (pathname.match(/^\/contacts\//)) return 'Contact Detail'
  if (pathname.match(/^\/org\//)) return 'Organization'
  if (pathname === '/pipeline') return 'Pipeline'
  if (pathname === '/tasks') return 'Tasks'
  if (pathname === '/map') return 'Map'
  if (pathname === '/activity') return 'Activity'
  if (pathname === '/investors') return 'Investors'
  if (pathname === '/settings') return 'Settings'
  return pathname
}

type Tab = 'bug' | 'feature'
type Severity = 'low' | 'normal' | 'high' | 'critical'
type Priority = 'low' | 'medium' | 'high'

const SEVERITY_COLORS: Record<Severity, string> = {
  low: '#a0a0a0',
  normal: '#4C72B0',
  high: '#DD8452',
  critical: '#C44E52',
}

const PRIORITY_COLORS: Record<Priority, string> = {
  low: '#a0a0a0',
  medium: '#4C72B0',
  high: '#C44E52',
}

export default function FeedbackButton() {
  const pathname = usePathname()
  const supabase = createClient()

  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<Tab>('bug')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [severity, setSeverity] = useState<Severity>('normal')
  const [priority, setPriority] = useState<Priority>('medium')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const titleRef = useRef<HTMLInputElement>(null)

  // Focus title on open
  useEffect(() => {
    if (open) setTimeout(() => titleRef.current?.focus(), 50)
  }, [open])

  // Reset on tab change
  useEffect(() => {
    setTitle('')
    setDescription('')
    setSeverity('normal')
    setPriority('medium')
    setError(null)
    setSubmitted(false)
  }, [tab])

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    if (open) document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open])

  const handleClose = () => {
    setOpen(false)
    setTitle('')
    setDescription('')
    setSeverity('normal')
    setPriority('medium')
    setError(null)
    setSubmitted(false)
  }

  const handleSubmit = async () => {
    if (!title.trim()) { setError('Title is required.'); return }
    setSubmitting(true)
    setError(null)

    const pageCtx = getPageContext(pathname)

    if (tab === 'bug') {
      const { error: err } = await supabase.from('bug_reports').insert({
        title: title.trim(),
        description: description.trim() || null,
        url: pathname,
        page_context: pageCtx,
        severity,
        status: 'open',
      })
      if (err) { setError(err.message); setSubmitting(false); return }
    } else {
      const { error: err } = await supabase.from('feature_requests').insert({
        title: title.trim(),
        description: description.trim() || null,
        url: pathname,
        page_context: pageCtx,
        priority,
        status: 'open',
      })
      if (err) { setError(err.message); setSubmitting(false); return }
    }

    setSubmitting(false)
    setSubmitted(true)
    setTimeout(handleClose, 1400)
  }

  // Nobody is signed in on the login screen, so there is nothing to file against.
  if (pathname.startsWith('/login') || pathname.startsWith('/auth/')) return null

  return (
    <>
      {/* Floating trigger button */}
      <button
        onClick={() => setOpen(true)}
        className="btn-press"
        style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          zIndex: 90,
          background: 'var(--bg-card)',
          border: '1px solid var(--hover-medium)',
          color: 'var(--text-secondary)',
          borderRadius: '20px',
          padding: '8px 14px',
          fontSize: '12px',
          fontWeight: 500,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          boxShadow: 'var(--shadow-card)',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
        onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-secondary)')}
        title="Report a bug or request a feature"
        aria-label="Report a bug or request a feature"
      >
        💬 Feedback
      </button>

      {/* Modal overlay */}
      {open && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 999,
            background: 'var(--bg-overlay)',
            display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end',
            padding: '24px',
          }}
          onClick={handleClose}
        >
          <div
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--hover-medium)',
              borderRadius: '12px',
              width: '100%',
              maxWidth: '420px',
              padding: '20px',
              boxShadow: '0 24px 48px rgba(0,0,0,0.4)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="mb-4 flex items-center justify-between">
              <div className="flex gap-0 rounded-lg" style={{ background: 'var(--bg-secondary)', padding: '3px' }}>
                {(['bug', 'feature'] as Tab[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    style={{
                      padding: '5px 14px',
                      borderRadius: '8px',
                      fontSize: '12px',
                      fontWeight: 500,
                      border: 'none',
                      cursor: 'pointer',
                      background: tab === t ? 'var(--bg-card)' : 'transparent',
                      color: tab === t ? 'var(--text-primary)' : 'var(--text-secondary)',
                      boxShadow: tab === t ? '0 1px 3px rgba(0,0,0,0.3)' : 'none',
                      transition: 'all 150ms',
                    }}
                  >
                    {t === 'bug' ? '🐛 Bug Report' : '💡 Feature Request'}
                  </button>
                ))}
              </div>
              <button
                onClick={handleClose}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--text-secondary)', fontSize: '18px', lineHeight: 1, padding: '4px',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-secondary)')}
              >
                ✕
              </button>
            </div>

            {submitted ? (
              <div className="py-6 text-center">
                <div style={{ fontSize: 32 }}>✅</div>
                <div className="mt-2 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                  {tab === 'bug' ? 'Bug reported!' : 'Feature request submitted!'}
                </div>
                <div className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
                  Saved with the page it came from, ready for your next fix-up session.
                </div>
              </div>
            ) : (
              <>
                {/* Page context badge */}
                <div className="mb-3">
                  <span
                    className="rounded-full px-2 py-0.5 text-xs"
                    style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}
                  >
                    📍 {getPageContext(pathname)}
                  </span>
                </div>

                {/* Title */}
                <div className="mb-3">
                  <input
                    ref={titleRef}
                    type="text"
                    placeholder={tab === 'bug' ? 'What went wrong?' : 'What would you like to see?'}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                    className="w-full rounded px-3 py-2 text-sm"
                    style={{
                      background: 'var(--bg-input)',
                      border: '1px solid var(--border-input)',
                      color: 'var(--text-primary)',
                      outline: 'none',
                    }}
                  />
                </div>

                {/* Description */}
                <div className="mb-3">
                  <textarea
                    placeholder="More details (optional)"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={3}
                    className="w-full resize-none rounded px-3 py-2 text-sm"
                    style={{
                      background: 'var(--bg-input)',
                      border: '1px solid var(--border-input)',
                      color: 'var(--text-primary)',
                      outline: 'none',
                    }}
                  />
                </div>

                {/* Severity / Priority selector */}
                <div className="mb-4">
                  <div className="mb-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {tab === 'bug' ? 'Severity' : 'Priority'}
                  </div>
                  <div className="flex gap-2">
                    {tab === 'bug'
                      ? (['low', 'normal', 'high', 'critical'] as Severity[]).map((s) => (
                          <button
                            key={s}
                            onClick={() => setSeverity(s)}
                            style={{
                              padding: '3px 10px',
                              borderRadius: '12px',
                              fontSize: '11px',
                              fontWeight: severity === s ? 600 : 400,
                              border: `1px solid ${severity === s ? SEVERITY_COLORS[s] : 'var(--hover-medium)'}`,
                              background: severity === s ? `${SEVERITY_COLORS[s]}20` : 'transparent',
                              color: severity === s ? SEVERITY_COLORS[s] : 'var(--text-secondary)',
                              cursor: 'pointer',
                              transition: 'all 150ms',
                            }}
                          >
                            {s.charAt(0).toUpperCase() + s.slice(1)}
                          </button>
                        ))
                      : (['low', 'medium', 'high'] as Priority[]).map((p) => (
                          <button
                            key={p}
                            onClick={() => setPriority(p)}
                            style={{
                              padding: '3px 10px',
                              borderRadius: '12px',
                              fontSize: '11px',
                              fontWeight: priority === p ? 600 : 400,
                              border: `1px solid ${priority === p ? PRIORITY_COLORS[p] : 'var(--hover-medium)'}`,
                              background: priority === p ? `${PRIORITY_COLORS[p]}20` : 'transparent',
                              color: priority === p ? PRIORITY_COLORS[p] : 'var(--text-secondary)',
                              cursor: 'pointer',
                              transition: 'all 150ms',
                            }}
                          >
                            {p.charAt(0).toUpperCase() + p.slice(1)}
                          </button>
                        ))}
                  </div>
                </div>

                {error && (
                  <div className="mb-3 rounded px-3 py-2 text-xs" style={{ background: '#C44E5220', color: '#C44E52' }}>
                    {error}
                  </div>
                )}

                <button
                  onClick={handleSubmit}
                  disabled={submitting || !title.trim()}
                  className="btn-press w-full rounded py-2 text-sm font-medium transition-opacity"
                  style={{
                    background: '#4C72B0',
                    color: '#fff',
                    border: 'none',
                    cursor: submitting || !title.trim() ? 'not-allowed' : 'pointer',
                    opacity: submitting || !title.trim() ? 0.6 : 1,
                  }}
                >
                  {submitting ? 'Submitting…' : tab === 'bug' ? 'Submit Bug Report' : 'Submit Feature Request'}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
