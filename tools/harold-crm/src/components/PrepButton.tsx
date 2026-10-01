'use client'

interface PrepButtonProps {
  loading: boolean
  onClick: () => void
  variant?: 'full' | 'icon'
}

export default function PrepButton({
  loading,
  onClick,
  variant = 'full',
}: PrepButtonProps) {
  if (variant === 'icon') {
    return (
      <button
        onClick={onClick}
        disabled={loading}
        title="Prep for meeting"
        style={{
          background: 'none',
          border: 'none',
          color: loading ? 'var(--text-faint)' : 'var(--accent)',
          cursor: loading ? 'not-allowed' : 'pointer',
          padding: 4,
          borderRadius: 4,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'color 0.15s',
        }}
      >
        {loading ? <SpinnerIcon /> : <BriefcaseIcon />}
      </button>
    )
  }

  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="btn-press"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '7px 14px',
        background: loading ? 'var(--bg-card)' : 'var(--accent)',
        color: loading ? 'var(--text-tertiary)' : 'var(--text-primary)',
        border: 'none',
        borderRadius: 6,
        fontSize: 13,
        fontWeight: 500,
        cursor: loading ? 'not-allowed' : 'pointer',
        transition: 'all 0.15s',
        opacity: loading ? 0.7 : 1,
      }}
    >
      {loading ? <SpinnerIcon /> : <BriefcaseIcon />}
      {loading ? 'Prepping...' : 'Prep me'}
    </button>
  )
}

function BriefcaseIcon() {
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
      <rect width="20" height="14" x="2" y="7" rx="2" ry="2" />
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
    </svg>
  )
}

function SpinnerIcon() {
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
      style={{ animation: 'spin 1s linear infinite' }}
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </svg>
  )
}
