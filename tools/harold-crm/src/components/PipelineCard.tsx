'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import type { Contact } from '@/lib/types'

const WARMTH_COLORS: Record<string, string> = {
  Hot: '#C44E52',
  Warm: '#DD8452',
  Lukewarm: '#ffc107',
  Cold: '#8da0cb',
  '': '#555',
}

const WARMTH_BG: Record<string, string> = {
  Hot: 'rgba(196,78,82,0.12)',
  Warm: 'rgba(221,132,82,0.12)',
  Lukewarm: 'rgba(255,193,7,0.1)',
  Cold: 'rgba(141,160,203,0.1)',
  '': 'rgba(85,85,85,0.1)',
}

const STATUS_DOT: Record<string, string> = {
  active: '#55a868',
  pending: '#ffc107',
  cold: '#8da0cb',
  archived: '#555',
}

interface PipelineCardProps {
  contact: Contact
  onSelect?: (contactId: string) => void
  showQuickAdvance?: boolean
  /** Called with the pipeline entry id */
  onQuickAdvance?: (entryId: string) => void
}

export default function PipelineCard({ contact, onSelect, showQuickAdvance = false, onQuickAdvance }: PipelineCardProps) {
  const [hovered, setHovered] = useState(false)
  const warmth = contact.warmth || ''
  const warmthColor = WARMTH_COLORS[warmth] ?? '#555'
  const warmthBg = WARMTH_BG[warmth] ?? 'rgba(85,85,85,0.1)'

  // Calculate days in current stage (memoized to avoid impure Date.now in render)
  const daysInStage = useMemo(() => {
    if (!contact.stage_entered_at) return null
    const now = new Date()
    const entered = new Date(contact.stage_entered_at)
    return Math.floor((now.getTime() - entered.getTime()) / 86400000)
  }, [contact.stage_entered_at])

  return (
    <div
      style={{
        background: hovered ? 'var(--hover-strong)' : 'var(--bg-card)',
        border: `1px solid ${hovered ? 'var(--accent)' : 'var(--border-subtle)'}`,
        borderRadius: 8,
        padding: '10px 12px',
        cursor: 'pointer',
        transition: 'all 0.15s',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => onSelect?.(contact.id)}
    >
      {/* Name + status dot */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: STATUS_DOT[contact.status] ?? '#555',
            flexShrink: 0,
          }}
        />
        <span
          style={{
            color: 'var(--text-primary)',
            fontSize: 13,
            fontWeight: 500,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
          }}
        >
          {contact.name}
        </span>
        {showQuickAdvance && onQuickAdvance && (
          <button
            onClick={(e) => { e.stopPropagation(); onQuickAdvance(contact.pipeline_entry_id ?? contact.id) }}
            title="Advance to next stage"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--accent)',
              fontSize: 13,
              padding: '0 2px',
              flexShrink: 0,
              opacity: hovered ? 1 : 0,
              transition: 'opacity 0.15s',
              lineHeight: 1,
            }}
          >
            ⟶
          </button>
        )}
        <Link
          href={`/contacts/${contact.id}`}
          onClick={(e) => e.stopPropagation()}
          style={{
            color: 'var(--text-faint)',
            fontSize: 11,
            textDecoration: 'none',
            flexShrink: 0,
            opacity: hovered ? 1 : 0,
            transition: 'opacity 0.15s',
          }}
          title="Open full profile"
        >
          ↗
        </Link>
      </div>

      {/* Org */}
      <div
        style={{
          color: 'var(--text-tertiary, #888)',
          fontSize: 11,
          marginBottom: 6,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {contact.org}
      </div>

      {/* Purpose: why this person is in the pipeline */}
      {contact.pipeline && (
        <div
          style={{
            color: 'var(--text-secondary)',
            fontSize: 11,
            marginBottom: 6,
            fontStyle: 'italic',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={contact.pipeline}
        >
          {contact.pipeline}
        </div>
      )}

      {/* Warmth pill + days in stage */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {warmth && (
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              padding: '2px 6px',
              borderRadius: 4,
              color: warmthColor,
              background: warmthBg,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            {warmth}
          </span>
        )}

        {contact.investor_type && (
          <span
            style={{
              fontSize: 10,
              color: 'var(--text-muted)',
              padding: '2px 5px',
              borderRadius: 3,
              background: 'var(--hover-faint)',
            }}
          >
            {contact.investor_type}
          </span>
        )}

        {daysInStage !== null && (
          <span
            style={{
              fontSize: 10,
              color: daysInStage > 60 ? 'var(--danger)' : daysInStage > 30 ? 'var(--warning)' : 'var(--text-muted)',
              marginLeft: 'auto',
            }}
          >
            {daysInStage}d
          </span>
        )}
      </div>
    </div>
  )
}
