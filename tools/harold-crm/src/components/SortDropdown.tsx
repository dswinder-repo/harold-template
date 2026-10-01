'use client'

import { useState, useRef, useEffect } from 'react'

export type SortKey = 'default' | 'name_asc' | 'name_desc' | 'org' | 'priority'

interface SortOption {
  key: SortKey
  label: string
}

const SORT_OPTIONS: SortOption[] = [
  { key: 'default', label: 'Recently Updated' },
  { key: 'name_asc', label: 'A → Z' },
  { key: 'name_desc', label: 'Z → A' },
  { key: 'org', label: 'By Organization' },
  { key: 'priority', label: 'By Priority' },
]

interface SortDropdownProps {
  value: SortKey
  onChange: (key: SortKey) => void
}

export default function SortDropdown({ value, onChange }: SortDropdownProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const current = SORT_OPTIONS.find(o => o.key === value) ?? SORT_OPTIONS[0]

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors"
        style={{
          background: 'var(--hover-light)',
          color: 'var(--text-secondary)',
          border: 'none',
          cursor: 'pointer',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--hover-medium)' }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--hover-light)' }}
      >
        <span style={{ fontSize: 11, opacity: 0.7 }}>Sort:</span>
        <span>{current.label}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ opacity: 0.5 }}>
          <path d="M2.5 4L5 6.5L7.5 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <ul
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            zIndex: 50,
            marginTop: 4,
            minWidth: 170,
            background: 'var(--bg-card)',
            border: '1px solid var(--border-input)',
            borderRadius: 6,
            padding: '4px 0',
            listStyle: 'none',
            boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
          }}
        >
          {SORT_OPTIONS.map(option => (
            <li
              key={option.key}
              onMouseDown={() => { onChange(option.key); setOpen(false) }}
              style={{
                padding: '6px 12px',
                fontSize: 13,
                cursor: 'pointer',
                color: option.key === value ? 'var(--accent)' : 'var(--text-primary)',
                background: option.key === value ? 'var(--hover-light)' : 'transparent',
              }}
              onMouseEnter={(e) => { if (option.key !== value) e.currentTarget.style.background = 'var(--hover-light)' }}
              onMouseLeave={(e) => { if (option.key !== value) e.currentTarget.style.background = 'transparent' }}
            >
              {option.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
