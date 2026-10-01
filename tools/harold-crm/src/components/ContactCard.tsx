'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import type { Contact, StatusType } from '@/lib/types'
import { DEFAULT_CATEGORY_COLORS, getStatusStyle } from '@/lib/types'
import { useEnumOptions } from '@/hooks/useEnumOptions'
import { truncate, ensureProtocol } from '@/lib/utils'

// Extracted outside component to avoid React Compiler purity check on Date.now()
function computeRecency(updatedAt: string | null | undefined) {
  const days = updatedAt
    ? Math.floor((Date.now() - new Date(updatedAt).getTime()) / (1000 * 60 * 60 * 24))
    : 999
  return {
    daysSinceUpdate: days,
    recencyPct: Math.max(10, Math.round(100 - (Math.min(days, 90) / 90) * 90)),
    recencyColor: days <= 7 ? '#55A868' : days <= 30 ? '#DD8452' : '#a0a0a0',
    shouldPulse: days <= 7,
  }
}

const WARMTH_COLORS: Record<string, string> = {
  Hot: '#C44E52',
  Warm: '#DD8452',
  Lukewarm: '#ffc107',
  Cold: '#a0a0a0',
}

interface ContactCardProps {
  contact: Contact
  categoryNames?: string[]
  contactCategories?: string[]
  animationIndex?: number
  onUpdate?: (id: string, updates: Partial<Contact>) => Promise<{ error: string | null }>
  onToggleCategory?: (contactId: string, categoryName: string) => Promise<{ error: unknown }>
  onSelect?: (contactId: string) => void
}

// Dropdown that closes on outside click
function InlineDropdown({
  options,
  currentValue,
  onSelect,
  onClose,
  renderOption,
}: {
  options: string[]
  currentValue: string
  onSelect: (val: string) => void
  onClose: () => void
  renderOption?: (val: string, isCurrent: boolean) => React.ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [onClose])

  return (
    <div
      ref={ref}
      className="absolute z-50 mt-1 rounded-md py-1 shadow-lg"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--hover-medium)', minWidth: '120px' }}
    >
      {options.map((opt) => (
        <button
          key={opt}
          onClick={(e) => { e.stopPropagation(); onSelect(opt) }}
          className="block w-full px-3 py-1.5 text-left text-xs transition-colors"
          style={{
            color: opt === currentValue ? 'var(--accent)' : 'var(--text-primary)',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            fontWeight: opt === currentValue ? 600 : 400,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--hover-subtle)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          {renderOption ? renderOption(opt, opt === currentValue) : opt.charAt(0).toUpperCase() + opt.slice(1)}
        </button>
      ))}
    </div>
  )
}

export default function ContactCard({ contact, contactCategories, animationIndex, onUpdate, onToggleCategory, onSelect }: ContactCardProps) {
  const [showStatusDropdown, setShowStatusDropdown] = useState(false)
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false)
  // Type and labels are two different things and are shown as two different things.
  // The type is what someone is, exactly one, and it always shows. Labels are anything
  // else worth tagging them with, any number, and they sit after it.
  const labels = (contactCategories ?? []).filter((c) => c !== contact.category)
  const { getOptions } = useEnumOptions()
  // Label choices: the label list from Settings plus any label this contact already has
  const labelOptions = [...new Set([...getOptions('label').filter(Boolean), ...labels])]
    .filter((l) => l !== contact.category)
  const primaryColor = DEFAULT_CATEGORY_COLORS[contact.category] ?? '#937860'
  const statusStyle = getStatusStyle(contact.status)

  // Feature 4: warmth gradient
  const warmthColor = WARMTH_COLORS[contact.warmth] ?? null

  // Features 6 + 7: recency computation
  const { daysSinceUpdate, recencyPct, recencyColor, shouldPulse } = computeRecency(contact.updated_at)

  // Feature 2: stagger animation
  const staggerStyle = animationIndex != null && animationIndex < 15
    ? { animation: `card-fade-up 0.3s ease ${(animationIndex * 0.04).toFixed(2)}s both` }
    : undefined

  // Feature C: 3D tilt
  const cardRef = useRef<HTMLDivElement>(null)

  return (
    <div
      ref={cardRef}
      data-testid={`contact-card-${contact.name.replace(/\s+/g, '-').toLowerCase()}`}
      className="card-shimmer cursor-pointer rounded-md"
      style={{
        background: 'var(--bg-card)',
        borderLeft: `3px solid ${primaryColor}`,
        borderRadius: '6px',
        height: '100%',
        display: 'flex',
        flexDirection: 'column' as const,
        position: 'relative' as const,
        overflow: 'hidden' as const,
        boxShadow: 'var(--shadow-card)',
        transition: 'box-shadow 150ms ease',
        ...staggerStyle,
      }}
      onClick={() => onSelect?.(contact.id)}
      onAnimationEnd={(e) => {
        // Clear stagger animation so inline JS tilt transforms can take effect
        // (animation fill-mode: both overrides inline style.transform)
        e.currentTarget.style.animation = 'none'
      }}
      onMouseMove={(e) => {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
        const rect = cardRef.current?.getBoundingClientRect()
        if (!rect) return
        const x = (e.clientX - rect.left) / rect.width - 0.5
        const y = (e.clientY - rect.top) / rect.height - 0.5
        // Zero transition so tilt tracks cursor instantly (no lag)
        e.currentTarget.style.transition = 'transform 0ms'
        e.currentTarget.style.transform = `translateY(-4px) perspective(600px) rotateX(${(-y * 15).toFixed(1)}deg) rotateY(${(x * 15).toFixed(1)}deg)`
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = `var(--shadow-card-hover), 0 8px 24px ${primaryColor}20`
      }}
      onMouseLeave={(e) => {
        // Smooth snap-back
        e.currentTarget.style.transition = 'transform 150ms ease'
        e.currentTarget.style.boxShadow = 'var(--shadow-card)'
        e.currentTarget.style.transform = ''
      }}
    >
      {/* Feature 4: warmth gradient */}
      {warmthColor && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: '40px',
          background: `linear-gradient(to bottom, ${warmthColor}0d, transparent)`,
          pointerEvents: 'none', borderRadius: '6px 6px 0 0',
        }} />
      )}
      <div className="flex flex-1 flex-col p-4">
        {/* Name + Org */}
        <div className="mb-2">
          <Link
            href={`/contacts/${contact.id}`}
            className="block text-sm font-semibold leading-snug hover:underline"
            style={{ color: 'var(--text-primary)', textDecoration: 'none' }}
            onClick={(e) => e.stopPropagation()}
          >
            {contact.name}
            {/* Feature 7: relationship pulse dot — inline next to name to avoid checkbox overlap */}
            <span
              className={shouldPulse ? 'animate-pulse-dot' : undefined}
              style={{
                display: 'inline-block', width: '6px', height: '6px',
                borderRadius: '50%', background: recencyColor,
                marginLeft: '6px', verticalAlign: 'middle', flexShrink: 0,
              }}
              title={`Updated ${daysSinceUpdate === 0 ? 'today' : daysSinceUpdate === 1 ? 'yesterday' : `${daysSinceUpdate}d ago`}`}
            />
          </Link>
          {contact.organization_id ? (
            <Link
              href={`/org/${contact.organization_id}`}
              className="mt-1 block text-xs hover:underline"
              style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}
              onClick={(e) => e.stopPropagation()}
            >
              {truncate(contact.org, 40)}
            </Link>
          ) : (
            <div className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
              {truncate(contact.org, 40)}
            </div>
          )}
        </div>

        {/* Location + Status + Category + Priority */}
        <div className="mb-3 flex flex-1 flex-wrap items-start gap-2" style={{ alignContent: 'flex-start' }}>
          {contact.location && (
            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              📍 {truncate(contact.location, 25)}
            </span>
          )}

          {/* Clickable status badge */}
          <div className="relative">
            <button
              onClick={(e) => {
                e.stopPropagation()
                if (onUpdate) setShowStatusDropdown(!showStatusDropdown)
              }}
              className="btn-press rounded-full px-2 py-0.5 text-xs font-medium transition-opacity"
              style={{
                background: statusStyle.bg,
                color: statusStyle.text,
                border: 'none',
                cursor: onUpdate ? 'pointer' : 'default',
              }}
              title={onUpdate ? 'Click to change status' : undefined}
            >
              {contact.status}
            </button>
            {showStatusDropdown && onUpdate && (
              <InlineDropdown
                options={getOptions('status')}
                currentValue={contact.status}
                onSelect={async (val) => {
                  setShowStatusDropdown(false)
                  await onUpdate(contact.id, { status: val as StatusType })
                }}
                onClose={() => setShowStatusDropdown(false)}
                renderOption={(val, isCurrent) => {
                  const s = getStatusStyle(val)
                  return (
                    <span style={{ color: isCurrent ? 'var(--accent)' : s.text }}>
                      {val.charAt(0).toUpperCase() + val.slice(1)}
                    </span>
                  )
                }}
              />
            )}
          </div>

          {/* Type: exactly one, always shown */}
          {contact.category && (
            <span
              className="rounded-full px-2 py-0.5 text-xs font-semibold"
              style={{ background: `${primaryColor}30`, color: primaryColor }}
              title="Type: what this contact is"
            >
              {contact.category}
            </span>
          )}

          {/* Labels: any number, or none. Outlined so they read as secondary to the type. */}
          {labels.map((label) => {
            const color = DEFAULT_CATEGORY_COLORS[label] ?? '#937860'
            return (
              <span
                key={label}
                className="rounded-full px-2 py-0.5 text-xs font-medium"
                style={{ border: `1px solid ${color}80`, color }}
                title="Label"
              >
                {label}
              </span>
            )
          })}

          {/* Category toggle button */}
          {labelOptions.length > 0 && onToggleCategory && (
            <div className="relative">
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setShowCategoryDropdown(!showCategoryDropdown)
                }}
                className="btn-press rounded-full px-1.5 py-0.5 text-xs transition-opacity"
                style={{
                  background: 'var(--hover-subtle)',
                  color: 'var(--text-secondary)',
                  border: 'none',
                  cursor: 'pointer',
                }}
                title="Add or remove labels"
              >
                {labels.length === 0 ? '+ label' : '✎'}
              </button>
              {showCategoryDropdown && (
                <InlineDropdown
                  options={labelOptions}
                  currentValue=""
                  onSelect={async (val) => {
                    await onToggleCategory(contact.id, val)
                  }}
                  onClose={() => setShowCategoryDropdown(false)}
                  renderOption={(val) => {
                    const color = DEFAULT_CATEGORY_COLORS[val] ?? '#937860'
                    const isActive = labels.includes(val)
                    return (
                      <span className="flex items-center gap-2">
                        <span
                          className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-sm text-xs"
                          style={{
                            background: isActive ? color : 'transparent',
                            border: `1px solid ${isActive ? color : 'var(--border-input)'}`,
                            color: isActive ? 'var(--text-primary)' : 'transparent',
                            fontSize: '10px',
                          }}
                        >
                          {isActive ? '✓' : ''}
                        </span>
                        <span
                          className="inline-block h-2 w-2 rounded-full"
                          style={{ background: color }}
                        />
                        <span style={{ color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                          {val.charAt(0).toUpperCase() + val.slice(1)}
                        </span>
                      </span>
                    )
                  }}
                />
              )}
            </div>
          )}

          {contact.priority === 'high' && (
            <span className="text-xs font-bold" style={{ color: 'var(--danger)' }}>
              ★ HIGH
            </span>
          )}
        </div>

        {/* Action buttons */}
        <div className="mt-auto flex gap-2">
          {contact.email ? (
            <a
              href={`mailto:${contact.email}`}
              className="rounded px-2 py-1 text-xs transition-colors"
              style={{ background: 'var(--hover-light)', color: 'var(--text-primary)', textDecoration: 'none' }}
              onClick={(e) => e.stopPropagation()}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--hover-strong)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--hover-light)')}
            >
              ✉ Email
            </a>
          ) : (
            <span className="rounded px-2 py-1 text-xs" style={{ color: 'var(--text-faint)', cursor: 'not-allowed' }}>
              ✉ Email
            </span>
          )}
          {contact.phone ? (
            <a
              href={`tel:${contact.phone}`}
              className="rounded px-2 py-1 text-xs transition-colors"
              style={{ background: 'var(--hover-light)', color: 'var(--text-primary)', textDecoration: 'none' }}
              onClick={(e) => e.stopPropagation()}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--hover-strong)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--hover-light)')}
            >
              📞 Call
            </a>
          ) : (
            <span className="rounded px-2 py-1 text-xs" style={{ color: 'var(--text-faint)', cursor: 'not-allowed' }}>
              📞 Call
            </span>
          )}
          {contact.website ? (
            <a
              href={ensureProtocol(contact.website)}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded px-2 py-1 text-xs transition-colors"
              style={{ background: 'var(--hover-light)', color: 'var(--text-primary)', textDecoration: 'none' }}
              onClick={(e) => e.stopPropagation()}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--hover-strong)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--hover-light)')}
            >
              🌐 Web
            </a>
          ) : (
            <span className="rounded px-2 py-1 text-xs" style={{ color: 'var(--text-faint)', cursor: 'not-allowed' }}>
              🌐 Web
            </span>
          )}
          <Link
            href={`/contacts/${contact.id}`}
            className="rounded px-2 py-1 text-xs transition-colors"
            style={{ background: 'var(--hover-light)', color: 'var(--text-primary)', textDecoration: 'none', marginLeft: 'auto' }}
            onClick={(e) => e.stopPropagation()}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--hover-strong)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--hover-light)')}
          >
            ✏️ Edit
          </Link>
        </div>

      </div>
      {/* Feature 6: recency bar */}
      <div style={{
        height: '3px', width: `${recencyPct}%`,
        background: recencyColor, opacity: 0.7,
        borderRadius: '0 0 0 3px', flexShrink: 0,
      }} />
    </div>
  )
}
