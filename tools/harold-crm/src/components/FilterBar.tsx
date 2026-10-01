'use client'

import { useMemo } from 'react'
import type { Contact, Category } from '@/lib/types'
import { DEFAULT_CATEGORY_COLORS } from '@/lib/types'
import { parseCountry } from '@/lib/utils'

interface FilterBarProps {
  contacts: Contact[]
  categories?: Category[]
  activeCategory: string
  onCategoryChange: (value: string) => void
  activeCountry: string
  onCountryChange: (value: string) => void
  onAddCategory?: () => void
}

export default function FilterBar({
  contacts,
  categories,
  activeCategory,
  onCategoryChange,
  activeCountry,
  onCountryChange,
  onAddCategory,
}: FilterBarProps) {
  // Build unique country list from all contacts
  const countries = useMemo(() => {
    const countrySet = new Set<string>()
    contacts.forEach((c) => {
      const country = parseCountry(c.location)
      if (country !== 'Unknown') countrySet.add(country)
    })
    return Array.from(countrySet).sort()
  }, [contacts])

  // One filter button per contact type
  const filterButtons = useMemo(() => {
    const buttons: { key: string; label: string; color?: string }[] = [
      { key: 'all', label: 'All' },
    ]

    if (categories && categories.length > 0) {
      for (const cat of categories) {
        buttons.push({ key: cat.name, label: cat.label, color: cat.color })
      }
    } else {
      // Fallback to defaults
      buttons.push(
        { key: 'investor', label: 'Investors', color: DEFAULT_CATEGORY_COLORS.investor },
        { key: 'founder', label: 'Founders', color: DEFAULT_CATEGORY_COLORS.founder },
        { key: 'team', label: 'Team', color: DEFAULT_CATEGORY_COLORS.team },
        { key: 'partner', label: 'Partners', color: DEFAULT_CATEGORY_COLORS.partner },
        { key: 'other', label: 'Other', color: DEFAULT_CATEGORY_COLORS.other },
      )
    }

    buttons.push({ key: 'high_priority', label: '\u2605 High Priority', color: 'var(--danger)' })
    return buttons
  }, [categories])

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Type filter buttons */}
      {filterButtons.map((btn) => {
        const isActive = activeCategory === btn.key
        return (
          <button
            key={btn.key}
            data-testid={`filter-${btn.key}`}
            onClick={() => onCategoryChange(btn.key)}
            className="rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
            style={{
              background: isActive
                ? btn.color ?? 'var(--accent)'
                : 'var(--hover-light)',
              color: 'var(--text-primary)',
              border: 'none',
              cursor: 'pointer',
              opacity: isActive ? 1 : 0.7,
            }}
            onMouseEnter={(e) => {
              if (!isActive) e.currentTarget.style.background = 'var(--hover-strong)'
            }}
            onMouseLeave={(e) => {
              if (!isActive) e.currentTarget.style.background = 'var(--hover-light)'
            }}
          >
            {btn.label}
          </button>
        )
      })}
      {onAddCategory && (
        <button
          onClick={onAddCategory}
          className="rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
          style={{
            background: 'var(--hover-subtle)',
            color: 'var(--text-faint)',
            border: '1px dashed var(--hover-medium)',
            cursor: 'pointer',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--hover-light)'
            e.currentTarget.style.color = 'var(--text-secondary)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'var(--hover-subtle)'
            e.currentTarget.style.color = 'var(--text-faint)'
          }}
        >
          + Type
        </button>
      )}

      {/* Divider */}
      <div className="mx-1 h-5 w-px" style={{ background: 'var(--border-subtle)' }} />

      {/* Country dropdown */}
      <select
        value={activeCountry}
        onChange={(e) => onCountryChange(e.target.value)}
        className="rounded-md px-2.5 py-1.5 text-sm outline-none"
        style={{
          background: 'var(--hover-light)',
          color: 'var(--text-primary)',
          border: 'none',
          cursor: 'pointer',
          opacity: activeCountry === 'all' ? 0.7 : 1,
        }}
      >
        <option value="all">All Countries</option>
        {countries.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>

      {/* Spacer + Cmd+K hint (hidden on mobile) */}
      <div className="ml-auto hidden items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs sm:flex" style={{ color: 'var(--text-faint)' }}>
        <kbd
          className="rounded px-1.5 py-0.5 font-mono text-[10px]"
          style={{ background: 'var(--hover-subtle)', border: '1px solid var(--border-subtle)' }}
        >
          {'\u2318'}K
        </kbd>
        <span>to search</span>
      </div>
    </div>
  )
}
