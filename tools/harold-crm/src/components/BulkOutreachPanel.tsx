'use client'

import { useState, useMemo } from 'react'
import type { Contact } from '@/lib/types'
import { generateOutreach } from '@/lib/outreach-templates'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/hooks/useToast'
import { useCrmSettings } from '@/hooks/useCrmSettings'
import { SENDER_PROFILE_KEY, type SenderProfile } from '@/lib/senderProfile'

interface BulkOutreachPanelProps {
  contacts: Contact[]
  onClose: () => void
}

interface GeneratedEmail {
  contact: Contact
  subject: string
  body: string
}

export default function BulkOutreachPanel({ contacts, onClose }: BulkOutreachPanelProps) {
  const { user, profile } = useAuth()
  const { toast } = useToast()
  const senderName = profile?.full_name ?? ''
  const senderEmail = user?.email ?? ''
  const { getSetting } = useCrmSettings()
  const sender = getSetting<SenderProfile | null>(SENDER_PROFILE_KEY, null)

  // Generate a draft for every selected contact that has an email address
  const emails = useMemo<GeneratedEmail[]>(() => {
    return contacts
      .filter((c) => c.email) // only contacts with emails
      .map((c) => {
        const email = generateOutreach({
          contactName: c.name,
          orgName: c.org,
          focusArea: c.focus_area,
          region: c.region,
          investorType: c.investor_type,
          senderName,
          senderEmail,
          senderOrg: sender?.org,
          oneLiner: sender?.one_liner,
        }, c.category)
        return { contact: c, subject: email.subject, body: email.body }
      })
  }, [contacts, senderName, senderEmail, sender?.org, sender?.one_liner])

  const skippedCount = contacts.length - emails.length

  // Track which emails have been copied
  const [copiedIds, setCopiedIds] = useState<Set<string>>(new Set())

  async function copyOne(email: GeneratedEmail) {
    try {
      await navigator.clipboard.writeText(
        `To: ${email.contact.email}\nSubject: ${email.subject}\n\n${email.body}`
      )
      setCopiedIds((prev) => new Set(prev).add(email.contact.id))
      toast({ title: `Copied email for ${email.contact.name}`, type: 'success' })
    } catch {
      toast({ title: 'Failed to copy', type: 'error' })
    }
  }

  async function copyAll() {
    const allText = emails
      .map(
        (e, i) =>
          `${'—'.repeat(40)}\n${i + 1}. ${e.contact.name} (${e.contact.org})\nTo: ${e.contact.email}\nSubject: ${e.subject}\n\n${e.body}`
      )
      .join('\n\n')

    try {
      await navigator.clipboard.writeText(allText)
      setCopiedIds(new Set(emails.map((e) => e.contact.id)))
      toast({ title: `Copied ${emails.length} emails to clipboard`, type: 'success' })
    } catch {
      toast({ title: 'Failed to copy', type: 'error' })
    }
  }

  function openInMail(email: GeneratedEmail) {
    const mailto = `mailto:${email.contact.email}?subject=${encodeURIComponent(email.subject)}&body=${encodeURIComponent(email.body)}`
    window.open(mailto, '_blank')
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
          width: 600,
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
            <MailStackIcon />
            <span style={{ fontWeight: 600, fontSize: 15 }}>
              Bulk Outreach — {emails.length} Email{emails.length !== 1 ? 's' : ''}
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

        {/* Status bar */}
        {skippedCount > 0 && (
          <div
            style={{
              padding: '8px 20px',
              fontSize: 12,
              color: 'var(--text-muted)',
              background: 'rgba(221,132,82,0.08)',
              borderBottom: '1px solid var(--border-subtle)',
              flexShrink: 0,
            }}
          >
            ⚠ {skippedCount} contact{skippedCount !== 1 ? 's' : ''} skipped (no email on file)
          </div>
        )}

        {/* Email list — scrollable */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '12px 20px',
          }}
        >
          {emails.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: 40,
                color: 'var(--text-muted)',
                fontSize: 13,
              }}
            >
              None of the selected contacts have an email address.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {emails.map((email, idx) => (
                <EmailCard
                  key={email.contact.id}
                  email={email}
                  index={idx + 1}
                  copied={copiedIds.has(email.contact.id)}
                  onCopy={() => copyOne(email)}
                  onOpenInMail={() => openInMail(email)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        {emails.length > 0 && (
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
              onClick={copyAll}
              style={{
                flex: 1,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                padding: '9px 16px',
                background: 'var(--accent)',
                color: 'var(--text-primary)',
                border: 'none',
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              <ClipboardIcon />
              Copy All {emails.length} Emails
            </button>

            <button
              onClick={onClose}
              style={{
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
              Done
            </button>
          </div>
        )}
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function EmailCard({
  email,
  index,
  copied,
  onCopy,
  onOpenInMail,
}: {
  email: GeneratedEmail
  index: number
  copied: boolean
  onCopy: () => void
  onOpenInMail: () => void
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div
      style={{
        background: 'var(--bg-primary)',
        border: `1px solid ${copied ? 'rgba(85,168,104,0.4)' : 'var(--border-subtle)'}`,
        borderRadius: 8,
        overflow: 'hidden',
        transition: 'border-color 0.2s',
      }}
    >
      {/* Card header */}
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 14px',
          cursor: 'pointer',
          transition: 'background 0.15s',
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: 'var(--text-faint)',
            width: 20,
            textAlign: 'center',
            flexShrink: 0,
          }}
        >
          {index}
        </span>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
            {email.contact.name}
          </div>
          <div
            style={{
              fontSize: 11,
              color: 'var(--text-muted)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {email.contact.org} · {email.contact.email}
          </div>
        </div>

        {copied && (
          <span style={{ fontSize: 10, color: '#55A868', fontWeight: 600, flexShrink: 0 }}>
            ✓ Copied
          </span>
        )}

        <span
          style={{
            display: 'inline-block',
            transition: 'transform 0.2s',
            transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
            fontSize: 10,
            color: 'var(--text-faint)',
            flexShrink: 0,
          }}
        >
          ▼
        </span>
      </div>

      {/* Expanded body */}
      {expanded && (
        <div style={{ borderTop: '1px solid var(--border-subtle)' }}>
          <div style={{ padding: '10px 14px 6px' }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Subject
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-primary)', marginBottom: 10 }}>
              {email.subject}
            </div>

            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Body
            </div>
            <div
              style={{
                fontSize: 12,
                color: 'var(--text-secondary)',
                lineHeight: 1.6,
                whiteSpace: 'pre-wrap',
                maxHeight: 200,
                overflowY: 'auto',
              }}
            >
              {email.body}
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              gap: 8,
              padding: '8px 14px',
              borderTop: '1px solid var(--hover-faint)',
            }}
          >
            <button
              onClick={(e) => { e.stopPropagation(); onOpenInMail() }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '5px 10px',
                background: 'var(--accent)',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                fontSize: 11,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              <MailIcon size={11} />
              Open in Mail
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onCopy() }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '5px 10px',
                background: 'var(--hover-light)',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 4,
                fontSize: 11,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              <ClipboardIcon size={11} />
              Copy
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function MailStackIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect width="20" height="14" x="2" y="6" rx="2" />
      <path d="m22 9-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 9" />
      <path d="M5 4h14" opacity="0.5" />
    </svg>
  )
}

function MailIcon({ size = 13 }: { size?: number }) {
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

function ClipboardIcon({ size = 13 }: { size?: number }) {
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
      <rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
    </svg>
  )
}
