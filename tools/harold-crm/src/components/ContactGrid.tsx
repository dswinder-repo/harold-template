'use client'

import { useRef, useState, useEffect, useCallback } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { Contact } from '@/lib/types'
import { groupContactsByOrg } from '@/lib/utils'
import ContactCard from './ContactCard'

interface ContactGridProps {
  contacts: Contact[]
  groupByOrg?: boolean
  loading?: boolean
  categoryNames?: string[]
  getCategoriesForContact?: (contactId: string) => string[]
  onUpdateContact?: (id: string, updates: Partial<Contact>) => Promise<{ error: string | null }>
  onToggleCategory?: (contactId: string, categoryName: string) => Promise<{ error: unknown }>
  onSelectContact?: (contactId: string) => void
  selectedIds?: Set<string>
  onToggleSelect?: (contactId: string) => void
  onSelectAll?: () => void
}

const MIN_CARD_WIDTH = 280
const GAP = 10
const ROW_HEIGHT = 160 // estimated card height including gap
const VIRTUALIZE_THRESHOLD = 40 // only virtualize when we have enough contacts

export default function ContactGrid({
  contacts,
  groupByOrg,
  loading,
  categoryNames,
  getCategoriesForContact,
  onUpdateContact,
  onToggleCategory,
  onSelectContact,
  selectedIds,
  onToggleSelect,
  onSelectAll,
}: ContactGridProps) {
  const selectionEnabled = !!onToggleSelect
  const containerRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [columns, setColumns] = useState(3)

  // Measure container width and compute column count (same logic as CSS auto-fill)
  const measureColumns = useCallback(() => {
    if (!containerRef.current) return
    const width = containerRef.current.offsetWidth
    const cols = Math.max(1, Math.floor((width + GAP) / (MIN_CARD_WIDTH + GAP)))
    setColumns(cols)
  }, [])

  useEffect(() => {
    measureColumns()
    const ro = new ResizeObserver(() => measureColumns())
    if (containerRef.current) ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [measureColumns])

  // Group contacts into rows
  const rows: Contact[][] = []
  for (let i = 0; i < contacts.length; i += columns) {
    rows.push(contacts.slice(i, i + columns))
  }

  const shouldVirtualize = contacts.length >= VIRTUALIZE_THRESHOLD

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 5,
    enabled: shouldVirtualize,
  })

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div
          className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-solid border-current border-r-transparent"
          style={{ color: 'var(--accent)' }}
        />
      </div>
    )
  }

  if (contacts.length === 0) {
    return (
      <div className="micro-fade-in flex flex-col items-center justify-center py-20">
        <svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          {/* Person silhouette */}
          <circle cx="32" cy="22" r="9" stroke="var(--text-faint)" strokeWidth="2" fill="none" />
          <path d="M16 52c0-8.837 7.163-16 16-16s16 7.163 16 16" stroke="var(--text-faint)" strokeWidth="2" fill="none" strokeLinecap="round" />
          {/* Pulsing radar rings */}
          <circle cx="32" cy="32" r="20" stroke="var(--text-faint)" strokeWidth="1" fill="none" style={{ animation: 'empty-state-pulse 2.5s ease-in-out infinite' }} />
          <circle cx="32" cy="32" r="28" stroke="var(--text-faint)" strokeWidth="0.5" fill="none" style={{ animation: 'empty-state-pulse 2.5s ease-in-out 0.4s infinite' }} />
        </svg>
        <p className="mt-4 text-lg" style={{ color: 'var(--text-secondary)' }}>
          No contacts found
        </p>
        <p className="mt-1 text-sm" style={{ color: 'var(--text-faint)' }}>
          Try adjusting your filters or search query
        </p>
      </div>
    )
  }

  const allSelected = selectionEnabled && contacts.length > 0 && contacts.every((c) => selectedIds?.has(c.id))
  const someSelected = selectionEnabled && contacts.some((c) => selectedIds?.has(c.id))

  const renderRow = (rowContacts: Contact[], rowStartIndex = 0) => (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${columns}, 1fr)`,
        gap: `${GAP}px`,
      }}
    >
      {rowContacts.map((contact, i) => {
        const isSelected = selectedIds?.has(contact.id) ?? false
        return (
          <div key={contact.id} className="relative" style={{ height: '100%' }}>
            <div
              style={{
                borderRadius: '6px',
                outline: isSelected ? '2px solid var(--accent)' : 'none',
                outlineOffset: '-1px',
                height: '100%',
              }}
            >
              <ContactCard
                contact={contact}
                categoryNames={categoryNames}
                contactCategories={getCategoriesForContact?.(contact.id)}
                animationIndex={rowStartIndex + i}
                onUpdate={onUpdateContact}
                onToggleCategory={onToggleCategory}
                onSelect={onSelectContact}
              />
            </div>
            {selectionEnabled && (
              <div
                className="absolute right-2 top-2 z-10"
                onClick={(e) => e.stopPropagation()}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => onToggleSelect?.(contact.id)}
                  style={{
                    accentColor: 'var(--accent)',
                    cursor: 'pointer',
                    width: '13px',
                    height: '13px',
                    opacity: isSelected ? 1 : 0.45,
                    transition: 'opacity 150ms',
                    filter: 'brightness(0.85)',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.opacity = '1' }}
                  onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.opacity = '0.45' }}
                />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )

  // Org-grouped rendering path
  if (groupByOrg) {
    const orgGroups = groupContactsByOrg(contacts)
    return (
      <div ref={containerRef}>
        {selectionEnabled && (
          <div className="mb-2 flex items-center gap-2">
            <label
              className="flex cursor-pointer items-center gap-2 text-xs"
              style={{ color: 'var(--text-secondary)' }}
            >
              <input
                type="checkbox"
                checked={allSelected}
                ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected }}
                onChange={() => onSelectAll?.()}
                style={{ accentColor: 'var(--accent)' }}
              />
              Select all ({contacts.length})
            </label>
          </div>
        )}
        {orgGroups.map((group) => (
          <div key={group.orgId ?? group.orgName} style={{ marginBottom: 24 }}>
            {/* Org section header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: 8,
                paddingBottom: 6,
                borderBottom: '1px solid var(--border-input)',
              }}
            >
              {group.orgId ? (
                <a
                  href={`/org/${group.orgId}`}
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: 'var(--text-primary)',
                    textDecoration: 'none',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-primary)' }}
                >
                  {group.orgName}
                </a>
              ) : (
                <span
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: 'var(--text-secondary)',
                  }}
                >
                  {group.orgName}
                </span>
              )}
              <span
                style={{
                  fontSize: 11,
                  color: 'var(--text-faint)',
                  fontWeight: 400,
                }}
              >
                {group.contacts.length} contact{group.contacts.length !== 1 ? 's' : ''}
              </span>
            </div>
            {/* Contacts in this org */}
            <div
              className="grid"
              style={{
                gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                gap: `${GAP}px`,
              }}
            >
              {group.contacts.map((contact, index) => {
                const isSelected = selectedIds?.has(contact.id) ?? false
                return (
                  <div key={contact.id} className="relative">
                    <div
                      style={{
                        borderRadius: '6px',
                        outline: isSelected ? '2px solid var(--accent)' : 'none',
                        outlineOffset: '-1px',
                        height: '100%',
                      }}
                    >
                      <ContactCard
                        contact={contact}
                        categoryNames={categoryNames}
                        contactCategories={getCategoriesForContact?.(contact.id)}
                        animationIndex={index}
                        onUpdate={onUpdateContact}
                        onToggleCategory={onToggleCategory}
                        onSelect={onSelectContact}
                      />
                    </div>
                    {selectionEnabled && (
                      <div
                        className="absolute right-2 top-2 z-10"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => onToggleSelect?.(contact.id)}
                          style={{
                            accentColor: 'var(--accent)',
                            cursor: 'pointer',
                            width: '13px',
                            height: '13px',
                            opacity: isSelected ? 1 : 0.45,
                            transition: 'opacity 150ms',
                            filter: 'brightness(0.85)',
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.opacity = '1' }}
                          onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.opacity = '0.45' }}
                        />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    )
  }

  // Non-virtualized path for small lists
  if (!shouldVirtualize) {
    return (
      <div ref={containerRef}>
        {selectionEnabled && (
          <div className="mb-2 flex items-center gap-2">
            <label
              className="flex cursor-pointer items-center gap-2 text-xs"
              style={{ color: 'var(--text-secondary)' }}
            >
              <input
                type="checkbox"
                checked={allSelected}
                ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected }}
                onChange={() => onSelectAll?.()}
                style={{ accentColor: 'var(--accent)' }}
              />
              Select all ({contacts.length})
            </label>
          </div>
        )}
        <div
          className="grid"
          style={{
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: `${GAP}px`,
          }}
        >
          {contacts.map((contact, index) => {
            const isSelected = selectedIds?.has(contact.id) ?? false
            return (
              <div key={contact.id} className="relative">
                <div
                  style={{
                    borderRadius: '6px',
                    outline: isSelected ? '2px solid var(--accent)' : 'none',
                    outlineOffset: '-1px',
                    height: '100%',
                  }}
                >
                  <ContactCard
                    contact={contact}
                    categoryNames={categoryNames}
                    contactCategories={getCategoriesForContact?.(contact.id)}
                    animationIndex={index}
                    onUpdate={onUpdateContact}
                    onToggleCategory={onToggleCategory}
                    onSelect={onSelectContact}
                  />
                </div>
                {selectionEnabled && (
                  <div
                    className="absolute right-2 top-2 z-10"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => onToggleSelect?.(contact.id)}
                      style={{
                        accentColor: 'var(--accent)',
                        cursor: 'pointer',
                        width: '13px',
                        height: '13px',
                        opacity: isSelected ? 1 : 0.45,
                        transition: 'opacity 150ms',
                        filter: 'brightness(0.85)',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.opacity = '1' }}
                      onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.opacity = '0.45' }}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  // Virtualized path for large lists
  const virtualItems = virtualizer.getVirtualItems()

  return (
    <div ref={containerRef}>
      {selectionEnabled && (
        <div className="mb-2 flex items-center gap-2">
          <label
            className="flex cursor-pointer items-center gap-2 text-xs"
            style={{ color: 'var(--text-secondary)' }}
          >
            <input
              type="checkbox"
              checked={allSelected}
              ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected }}
              onChange={() => onSelectAll?.()}
              style={{ accentColor: 'var(--accent)' }}
            />
            Select all ({contacts.length})
          </label>
        </div>
      )}

      <div
        ref={scrollRef}
        style={{
          height: 'calc(100vh - 280px)',
          overflow: 'auto',
        }}
      >
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {virtualItems.map((virtualRow) => (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`,
                paddingBottom: `${GAP}px`,
              }}
            >
              {renderRow(rows[virtualRow.index], virtualRow.index * columns)}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
