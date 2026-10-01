'use client'

import type { Contact } from '@/lib/types'

interface ResearchButtonProps {
  contact: Contact
  category: string
  loading: boolean
  onClick: () => void
  variant?: 'full' | 'icon'
}

export default function ResearchButton({
  contact: _contact,
  category: _category,
  loading,
  onClick,
  variant = 'full',
}: ResearchButtonProps) {
  void _contact
  void _category

  if (variant === 'icon') {
    return (
      <button
        onClick={onClick}
        disabled={loading}
        className="btn-press"
        title="Research this contact"
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
        {loading ? (
          <SpinnerIcon />
        ) : (
          <SearchIcon />
        )}
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
      {loading ? <SpinnerIcon /> : <SearchIcon />}
      {loading ? 'Researching...' : 'Research'}
    </button>
  )
}

function SearchIcon() {
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
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.35-4.35" />
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
