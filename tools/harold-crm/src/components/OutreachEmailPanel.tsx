'use client'

import { useState, useEffect, useRef } from 'react'
import type { Contact } from '@/lib/types'
import { generateOutreach } from '@/lib/outreach-templates'
import { useToast } from '@/hooks/useToast'
import { useCrmSettings } from '@/hooks/useCrmSettings'
import { SENDER_PROFILE_KEY, type SenderProfile } from '@/lib/senderProfile'

interface OutreachEmailPanelProps {
  contact: Contact
  category?: string
  senderName: string
  senderEmail: string
  onClose: () => void
}

export default function OutreachEmailPanel({
  contact,
  category,
  senderName,
  senderEmail,
  onClose,
}: OutreachEmailPanelProps) {
  const { toast } = useToast()
  const { getSetting } = useCrmSettings()
  const sender = getSetting<SenderProfile | null>(SENDER_PROFILE_KEY, null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)

  // Generate template on mount
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')

  useEffect(() => {
    const email = generateOutreach({
      contactName: contact.name,
      orgName: contact.org,
      focusArea: contact.focus_area,
      region: contact.region,
      investorType: contact.investor_type,
      senderName,
      senderEmail,
      senderOrg: sender?.org,
      oneLiner: sender?.one_liner,
    }, category ?? contact.category)
    setSubject(email.subject)
    setBody(email.body)
  }, [contact, category, senderName, senderEmail, sender?.org, sender?.one_liner])

  // Auto-resize textarea
  useEffect(() => {
    const ta = bodyRef.current
    if (ta) {
      ta.style.height = 'auto'
      ta.style.height = ta.scrollHeight + 'px'
    }
  }, [body])

  const hasEmail = !!contact.email

  function handleOpenInMail() {
    if (!hasEmail) return
    const mailto = `mailto:${contact.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
    window.open(mailto, '_blank')
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`)
      toast({ title: 'Copied to clipboard', type: 'success' })
    } catch {
      toast({ title: 'Failed to copy', type: 'error' })
    }
  }

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
            <MailIcon />
            <span style={{ fontWeight: 600, fontSize: 15 }}>
              Draft Outreach Email
            </span>
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
          {/* To field */}
          <FieldRow label="To">
            {hasEmail ? (
              <span style={{ color: 'var(--text-primary)', fontSize: 13 }}>
                {contact.name} &lt;{contact.email}&gt;
              </span>
            ) : (
              <span style={{ color: 'var(--text-faint)', fontSize: 13, fontStyle: 'italic' }}>
                No email on file — add one to use &ldquo;Open in Mail&rdquo;
              </span>
            )}
          </FieldRow>

          {/* From field */}
          <FieldRow label="From">
            <span style={{ color: 'var(--text-primary)', fontSize: 13 }}>
              {senderName || 'Unknown'} &lt;{senderEmail || '—'}&gt;
            </span>
          </FieldRow>

          {/* Subject field — editable */}
          <FieldRow label="Subject">
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              style={{
                width: '100%',
                background: 'var(--bg-input)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 4,
                padding: '6px 8px',
                color: 'var(--text-primary)',
                fontSize: 13,
                outline: 'none',
              }}
            />
          </FieldRow>

          {/* Body field — editable textarea */}
          <FieldRow label="Body">
            <textarea
              ref={bodyRef}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              style={{
                width: '100%',
                background: 'var(--bg-input)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 4,
                padding: '8px 10px',
                color: 'var(--text-primary)',
                fontSize: 13,
                lineHeight: 1.6,
                outline: 'none',
                resize: 'vertical',
                minHeight: 200,
                fontFamily: 'inherit',
              }}
            />
          </FieldRow>
        </div>

        {/* Footer actions — sticky bottom */}
        <div
          style={{
            display: 'flex',
            gap: 10,
            padding: '14px 20px',
            borderTop: '1px solid var(--border-subtle)',
            flexShrink: 0,
          }}
        >
          <button
            onClick={handleOpenInMail}
            disabled={!hasEmail}
            style={{
              flex: 1,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              padding: '9px 16px',
              background: hasEmail ? 'var(--accent)' : 'var(--bg-input)',
              color: hasEmail ? 'var(--text-primary)' : 'var(--text-faint)',
              border: 'none',
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 500,
              cursor: hasEmail ? 'pointer' : 'not-allowed',
              transition: 'all 0.15s',
            }}
          >
            <MailIcon size={13} />
            Open in Mail
          </button>

          <button
            onClick={handleCopy}
            style={{
              flex: 1,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              padding: '9px 16px',
              background: 'var(--bg-input)',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            <ClipboardIcon />
            Copy to Clipboard
          </button>
        </div>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--text-tertiary)',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  )
}

function MailIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect width="20" height="16" x="2" y="4" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  )
}

function ClipboardIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
    </svg>
  )
}
