'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import type { AuditLogEntry } from '@/lib/types'
import { formatRelativeTime } from '@/lib/utils'
import { useShowMore } from '@/hooks/useShowMore'
import { useScrollReveal } from '@/hooks/useScrollReveal'
import ShowMoreButton from './ShowMoreButton'

interface ActivityFeedProps {
  entries: AuditLogEntry[]
  loading?: boolean
  showContactLink?: boolean
}

function describeAction(entry: AuditLogEntry): string {
  switch (entry.action) {
    case 'create':
      return 'created contact'
    case 'delete':
      return 'deleted contact'
    case 'status_change':
      return `changed status from "${entry.old_value}" to "${entry.new_value}"`
    case 'note_added':
      return 'added a note'
    case 'stage_change': {
      const purpose = (entry.metadata as { purpose?: string } | null)?.purpose
      const where = purpose ? ` (${purpose})` : ''
      return entry.old_value
        ? `moved in the pipeline from "${entry.old_value}" to "${entry.new_value}"${where}`
        : `added to the pipeline: ${entry.new_value ?? ''}`
    }
    case 'update':
      if (entry.field_changed) {
        return `updated ${entry.field_changed.replace(/_/g, ' ')}${entry.old_value ? ` from "${entry.old_value}"` : ''}${entry.new_value ? ` to "${entry.new_value}"` : ''}`
      }
      return 'updated contact'
    default:
      return entry.action
  }
}

export default function ActivityFeed({
  entries,
  loading,
  showContactLink = true,
}: ActivityFeedProps) {
  const { visible: visibleEntries, hasMore, hiddenCount, showMore, showAll } = useShowMore(entries)
  const { containerRef: feedRevealRef, refresh: refreshFeedReveal } = useScrollReveal<HTMLDivElement>()

  useEffect(() => { refreshFeedReveal() }, [visibleEntries, refreshFeedReveal])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <div
          className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-solid border-current border-r-transparent"
          style={{ color: 'var(--accent)' }}
        />
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <p className="py-6 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>
        No activity yet
      </p>
    )
  }

  return (
    <div ref={feedRevealRef} className="flex flex-col gap-3">
      {visibleEntries.map((entry) => {
        const userName = entry.profiles?.full_name ?? entry.profiles?.email ?? 'System'
        const contactName = entry.contacts?.name
        const contactOrg = entry.contacts?.org

        return (
          <div
            key={entry.id}
            className="scroll-reveal flex gap-3 rounded-md p-3"
            style={{ background: 'var(--bg-card)' }}
          >
            {/* Avatar */}
            <div
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold"
              style={{ background: 'var(--hover-light)', color: 'var(--text-primary)' }}
            >
              {userName
                .split(' ')
                .map((n) => n[0])
                .join('')
                .toUpperCase()
                .slice(0, 2)}
            </div>

            {/* Content */}
            <div className="flex-1 text-sm">
              <div>
                <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{userName}</span>{' '}
                <span style={{ color: 'var(--text-secondary)' }}>{describeAction(entry)}</span>
              </div>

              {showContactLink && contactName && entry.contact_id && (
                <div className="mt-0.5">
                  <Link
                    href={`/contacts/${entry.contact_id}`}
                    className="text-xs hover:underline"
                    style={{ color: 'var(--accent)', textDecoration: 'none' }}
                  >
                    {contactName}
                    {contactOrg ? ` \u2014 ${contactOrg}` : ''}
                  </Link>
                </div>
              )}

              <div className="mt-1 text-xs" style={{ color: 'var(--text-faint)' }}>
                {formatRelativeTime(entry.created_at)}
              </div>
            </div>
          </div>
        )
      })}
      {hasMore && <ShowMoreButton hiddenCount={hiddenCount} onShowMore={showMore} onShowAll={showAll} />}
    </div>
  )
}
