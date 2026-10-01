'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import type { OrgSearchResult } from '@/hooks/useOrganizations'
import { useOrganizations } from '@/hooks/useOrganizations'

interface OrgAutocompleteProps {
  value: string
  organizationId: string | null
  onChange: (name: string, orgId: string | null) => void
  inputStyle?: React.CSSProperties
  labelStyle?: React.CSSProperties
}

export default function OrgAutocomplete({
  value,
  organizationId,
  onChange,
  inputStyle,
  labelStyle,
}: OrgAutocompleteProps) {
  const { searchOrgs, findOrgByName } = useOrganizations()
  const [query, setQuery] = useState(value)
  const [results, setResults] = useState<OrgSearchResult[]>([])
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Sync external value changes
  useEffect(() => {
    setQuery(value)
  }, [value])

  // Debounced search
  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([])
      setOpen(false)
      return
    }
    const hits = await searchOrgs(q)
    setResults(hits)
    setOpen(hits.length > 0)
    setActiveIndex(-1)
  }, [searchOrgs])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setQuery(val)
    // Clear org link when user is typing a new name
    onChange(val, null)

    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => doSearch(val), 300)
  }

  const handleSelect = (org: OrgSearchResult) => {
    setQuery(org.name)
    onChange(org.name, org.id)
    setOpen(false)
    setResults([])
  }

  // Handle blur by checking if the typed name matches an existing org
  const handleBlur = () => {
    // Delay to allow click events on dropdown to fire
    setTimeout(() => {
      if (!open) return
      setOpen(false)
      // If user typed something that matches an org exactly, link it
      if (query.trim() && !organizationId) {
        const match = findOrgByName(query)
        if (match) {
          onChange(match.name, match.id)
        }
      }
    }, 200)
  }

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open || results.length === 0) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex(prev => (prev < results.length - 1 ? prev + 1 : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex(prev => (prev > 0 ? prev - 1 : results.length - 1))
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault()
      handleSelect(results[activeIndex])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div className="sm:col-span-2" ref={wrapperRef} style={{ position: 'relative' }}>
      <label className="mb-1 block text-xs font-medium" style={labelStyle}>
        Organization
      </label>
      <div style={{ position: 'relative' }}>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleInputChange}
          onFocus={() => { if (query.trim()) doSearch(query) }}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          className="w-full rounded-md px-3 py-2 text-sm outline-none"
          style={inputStyle}
          placeholder="Search or type a new org..."
          autoComplete="off"
        />
        {/* Linked indicator */}
        {organizationId && (
          <span
            style={{
              position: 'absolute',
              right: 8,
              top: '50%',
              transform: 'translateY(-50%)',
              fontSize: 12,
              color: 'var(--accent)',
              pointerEvents: 'none',
            }}
            title="Linked to organization"
          >
            &#x2714;
          </span>
        )}
      </div>

      {/* Dropdown */}
      {open && results.length > 0 && (
        <ul
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            zIndex: 50,
            maxHeight: 220,
            overflowY: 'auto',
            background: 'var(--bg-card)',
            border: '1px solid var(--border-input)',
            borderRadius: 6,
            marginTop: 4,
            padding: 0,
            listStyle: 'none',
            boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
          }}
        >
          {results.map((org, idx) => (
            <li
              key={org.id}
              onMouseDown={() => handleSelect(org)}
              onMouseEnter={() => setActiveIndex(idx)}
              style={{
                padding: '8px 12px',
                cursor: 'pointer',
                fontSize: 13,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                background: idx === activeIndex ? 'var(--hover-light)' : 'transparent',
                color: 'var(--text-primary)',
              }}
            >
              <span>{org.name}</span>
              <span
                style={{
                  fontSize: 11,
                  color: 'var(--text-muted)',
                  marginLeft: 8,
                  flexShrink: 0,
                }}
              >
                {org.contact_count} contact{org.contact_count !== 1 ? 's' : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
