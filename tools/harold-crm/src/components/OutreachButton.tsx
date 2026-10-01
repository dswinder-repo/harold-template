'use client'

interface OutreachButtonProps {
  onClick: () => void
  variant?: 'full' | 'icon'
}

export default function OutreachButton({
  onClick,
  variant = 'full',
}: OutreachButtonProps) {
  if (variant === 'icon') {
    return (
      <button
        onClick={onClick}
        className="btn-press"
        title="Draft outreach email"
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--accent)',
          cursor: 'pointer',
          padding: 4,
          borderRadius: 4,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'color 0.15s',
        }}
      >
        <MailIcon />
      </button>
    )
  }

  return (
    <button
      onClick={onClick}
      className="btn-press"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '7px 14px',
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
      <MailIcon />
      Draft Email
    </button>
  )
}

function MailIcon() {
  return (
    <svg
      width="14"
      height="14"
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
