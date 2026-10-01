'use client'

import { useMemo, useState, useEffect } from 'react'
import type { Interaction, Task, AuditLogEntry } from '@/lib/types'
import { INTERACTION_TYPES } from '@/lib/types'
import { formatRelativeTime } from '@/lib/utils'
import { useShowMore } from '@/hooks/useShowMore'
import { useScrollReveal } from '@/hooks/useScrollReveal'
import ShowMoreButton from './ShowMoreButton'

interface TimelineEvent {
  type: 'interaction' | 'task' | 'audit'
  date: string
  data: Interaction | Task | AuditLogEntry
}

function getDateGroup(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today.getTime() - 86400000)
  const eventDay = new Date(date.getFullYear(), date.getMonth(), date.getDate())

  if (eventDay.getTime() === today.getTime()) return 'Today'
  if (eventDay.getTime() === yesterday.getTime()) return 'Yesterday'
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined })
}

const EVENT_STYLES: Record<string, { color: string; icon: string }> = {
  interaction_call:     { color: '#4C72B0', icon: '\u{1F4DE}' },
  interaction_email:    { color: '#DD8452', icon: '\u2709\uFE0F' },
  interaction_meeting:  { color: '#55A868', icon: '\u{1F91D}' },
  interaction_note:     { color: '#8172B3', icon: '\u{1F4DD}' },
  interaction_linkedin: { color: '#0077B5', icon: '\u{1F517}' },
  interaction_other:    { color: '#937860', icon: '\u{1F4AC}' },
  task_completed:       { color: '#28a745', icon: '\u2705' },
  task_pending:         { color: '#ffc107', icon: '\u{1F4CB}' },
  task_in_progress:     { color: '#4C72B0', icon: '\u{1F3C3}' },
  task_cancelled:       { color: '#666666', icon: '\u274C' },
  audit:                { color: '#a0a0a0', icon: '\u{1F4DD}' },
}

function getEventStyle(event: TimelineEvent) {
  if (event.type === 'interaction') {
    const interaction = event.data as Interaction
    return EVENT_STYLES[`interaction_${interaction.type}`] ?? EVENT_STYLES.interaction_other
  }
  if (event.type === 'task') {
    const task = event.data as Task
    return EVENT_STYLES[`task_${task.status}`] ?? EVENT_STYLES.task_pending
  }
  return EVENT_STYLES.audit
}

function getEventTitle(event: TimelineEvent): string {
  if (event.type === 'interaction') {
    const interaction = event.data as Interaction
    const meta = INTERACTION_TYPES.find((t) => t.value === interaction.type)
    return `${meta?.label ?? interaction.type}: ${interaction.subject}`
  }
  if (event.type === 'task') {
    const task = event.data as Task
    const statusLabel = task.status === 'completed' ? 'Completed' : task.status === 'in_progress' ? 'In Progress' : task.status === 'cancelled' ? 'Cancelled' : 'Task'
    return `${statusLabel}: ${task.title}`
  }
  const audit = event.data as AuditLogEntry
  if (audit.field_changed) {
    return `${audit.action}: ${audit.field_changed}`
  }
  return audit.action
}

function getEventBody(event: TimelineEvent): string | null {
  if (event.type === 'interaction') {
    const interaction = event.data as Interaction
    return interaction.body || null
  }
  if (event.type === 'task') {
    const task = event.data as Task
    return task.description || null
  }
  const audit = event.data as AuditLogEntry
  if (audit.old_value && audit.new_value) {
    return `${audit.old_value} \u2192 ${audit.new_value}`
  }
  return audit.new_value || null
}

function getEventAuthor(event: TimelineEvent): string | null {
  if (event.type === 'interaction') {
    return (event.data as Interaction).profiles?.full_name ?? null
  }
  if (event.type === 'task') {
    return (event.data as Task).profiles?.full_name ?? null
  }
  return (event.data as AuditLogEntry).profiles?.full_name ?? null
}

interface TimelineActions {
  onToggleTaskComplete?: (taskId: string, completed: boolean) => Promise<{ error?: unknown }>
  onDeleteTask?: (taskId: string) => Promise<{ error?: unknown }>
  onDeleteInteraction?: (interactionId: string) => Promise<{ error?: unknown }>
}

export default function UnifiedTimeline({
  interactions,
  tasks,
  auditEntries,
  onToggleTaskComplete,
  onDeleteTask,
  onDeleteInteraction,
}: {
  interactions: Interaction[]
  tasks: Task[]
  auditEntries: AuditLogEntry[]
} & TimelineActions) {
  const [completingIds, setCompletingIds] = useState<Set<string>>(new Set())
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const { containerRef: scrollRevealRef, refresh: refreshReveal } = useScrollReveal<HTMLDivElement>()

  const allEvents = useMemo(() => {
    const all: TimelineEvent[] = [
      ...interactions.map((i) => ({ type: 'interaction' as const, date: i.occurred_at, data: i })),
      ...tasks.map((t) => ({ type: 'task' as const, date: t.updated_at || t.created_at, data: t })),
      ...auditEntries.map((a) => ({ type: 'audit' as const, date: a.created_at, data: a })),
    ]
    return all.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
  }, [interactions, tasks, auditEntries])

  const { visible: visibleEvents, hasMore, hiddenCount, showMore, showAll } = useShowMore(allEvents)

  const grouped = useMemo(() => {
    const groups: { label: string; events: TimelineEvent[] }[] = []
    let currentLabel = ''
    for (const event of visibleEvents) {
      const label = getDateGroup(event.date)
      if (label !== currentLabel) {
        groups.push({ label, events: [] })
        currentLabel = label
      }
      groups[groups.length - 1].events.push(event)
    }
    return groups
  }, [visibleEvents])

  // Re-observe scroll-reveal items when content changes
  useEffect(() => { refreshReveal() }, [visibleEvents, refreshReveal])

  async function handleToggleTask(taskId: string, currentlyCompleted: boolean) {
    if (!onToggleTaskComplete) return
    if (currentlyCompleted) {
      // Mark as pending (undo complete)
      await onToggleTaskComplete(taskId, false)
    } else {
      // Mark as completed
      setCompletingIds((prev) => new Set(prev).add(taskId))
      const result = await onToggleTaskComplete(taskId, true)
      // Let the UI fade then update will come from parent
      setTimeout(() => {
        setCompletingIds((prev) => {
          const next = new Set(prev)
          next.delete(taskId)
          return next
        })
      }, result?.error ? 0 : 400)
    }
  }

  async function handleDelete(eventType: 'task' | 'interaction', id: string) {
    if (deletingId === id) {
      // Second tap — confirm
      setDeletingId(null)
      if (eventType === 'task' && onDeleteTask) {
        await onDeleteTask(id)
      } else if (eventType === 'interaction' && onDeleteInteraction) {
        await onDeleteInteraction(id)
      }
    } else {
      // First tap
      setDeletingId(id)
      setTimeout(() => setDeletingId((prev) => (prev === id ? null : prev)), 3000)
    }
  }

  if (allEvents.length === 0) {
    return (
      <p className="py-8 text-center text-sm" style={{ color: 'var(--text-faint)' }}>
        No activity yet
      </p>
    )
  }

  return (
    <div ref={scrollRevealRef} style={{ position: 'relative' }}>
      {grouped.map((group) => (
        <div key={group.label} className="mb-4">
          <div
            className="sticky top-0 z-10 mb-2 text-xs font-semibold uppercase tracking-wider"
            style={{ color: 'var(--text-faint)', background: 'var(--bg-card)', paddingBlock: '4px' }}
          >
            {group.label}
          </div>

          {group.events.map((event) => {
            const evStyle = getEventStyle(event)
            const title = getEventTitle(event)
            const body = getEventBody(event)
            const author = getEventAuthor(event)
            const isTask = event.type === 'task'
            const isInteraction = event.type === 'interaction'
            const task = isTask ? (event.data as Task) : null
            const isCompleting = isTask && completingIds.has(event.data.id)
            const isTaskDone = task?.status === 'completed'
            const isConfirmingDelete = deletingId === event.data.id
            const canDelete = (isTask && !!onDeleteTask) || (isInteraction && !!onDeleteInteraction)

            return (
              <div
                key={`${event.type}-${event.data.id}`}
                className="scroll-reveal group mb-3 flex gap-3"
                style={{
                  position: 'relative',
                  opacity: isCompleting ? 0.4 : undefined,
                  transition: 'opacity 300ms',
                }}
              >
                {/* Timeline dot */}
                <div className="flex flex-col items-center" style={{ minWidth: '24px' }}>
                  <div
                    style={{
                      width: '24px',
                      height: '24px',
                      borderRadius: '50%',
                      background: `${evStyle.color}22`,
                      border: `2px solid ${evStyle.color}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '11px',
                      flexShrink: 0,
                    }}
                  >
                    {evStyle.icon}
                  </div>
                  <div
                    style={{
                      width: '1px',
                      flex: 1,
                      background: 'var(--timeline-line)',
                      minHeight: '8px',
                    }}
                  />
                </div>

                {/* Event content */}
                <div className="flex-1 pb-1" style={{ minWidth: 0 }}>
                  <div className="flex items-center gap-2">
                    <span
                      className="text-xs font-medium"
                      style={{
                        color: evStyle.color,
                        textTransform: 'uppercase',
                        letterSpacing: '0.03em',
                      }}
                    >
                      {event.type}
                    </span>
                    <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
                      {formatRelativeTime(event.date)}
                    </span>
                    {/* Action buttons — show on hover */}
                    <span className="ml-auto flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100" style={{ flexShrink: 0 }}>
                      {/* Task done checkbox */}
                      {isTask && onToggleTaskComplete && (
                        <input
                          type="checkbox"
                          checked={isTaskDone || isCompleting}
                          onChange={() => handleToggleTask(event.data.id, isTaskDone ?? false)}
                          title={isTaskDone ? 'Mark as pending' : 'Mark as done'}
                          style={{
                            accentColor: 'var(--accent)',
                            cursor: 'pointer',
                            width: '13px',
                            height: '13px',
                            opacity: (isTaskDone || isCompleting) ? 1 : 0.45,
                            transition: 'opacity 150ms',
                            filter: 'brightness(0.85)',
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.opacity = '1' }}
                          onMouseLeave={(e) => { if (!isTaskDone && !isCompleting) e.currentTarget.style.opacity = '0.45' }}
                        />
                      )}
                      {/* Delete button */}
                      {canDelete && (
                        <button
                          onClick={() => handleDelete(event.type as 'task' | 'interaction', event.data.id)}
                          style={{
                            background: isConfirmingDelete ? 'rgba(196,78,82,0.15)' : 'none',
                            border: 'none',
                            cursor: 'pointer',
                            color: isConfirmingDelete ? '#C44E52' : 'var(--text-faint)',
                            fontSize: '10px',
                            lineHeight: '16px',
                            padding: '0 2px',
                            borderRadius: '3px',
                            opacity: isConfirmingDelete ? 1 : undefined,
                          }}
                          title={isConfirmingDelete ? 'Click again to confirm delete' : 'Delete'}
                        >
                          {isConfirmingDelete ? '✕ del?' : '✕'}
                        </button>
                      )}
                    </span>
                  </div>

                  <p
                    className="mt-0.5 text-sm"
                    style={{
                      color: 'var(--text-primary)',
                      textDecoration: isTaskDone ? 'line-through' : 'none',
                      opacity: isTaskDone ? 0.6 : 1,
                    }}
                  >
                    {title}
                  </p>

                  {body && (
                    <p
                      className="mt-1 text-xs"
                      style={{
                        color: 'var(--text-secondary)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                      }}
                    >
                      {body}
                    </p>
                  )}

                  {author && (
                    <span className="mt-1 inline-block text-xs" style={{ color: 'var(--text-faint)' }}>
                      by {author}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ))}
      {hasMore && <ShowMoreButton hiddenCount={hiddenCount} onShowMore={showMore} onShowAll={showAll} />}
    </div>
  )
}
