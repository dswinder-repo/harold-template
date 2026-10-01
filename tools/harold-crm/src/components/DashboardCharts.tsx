'use client'

import { useState, useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/useAuth'
import type { Contact, AuditLogEntry, Task, ActionType } from '@/lib/types'

// ── Pipeline Carousel (Left) ───────────────────────────────────────────

const STAGE_COLORS = ['#4C72B0', '#55A868', '#DD8452', '#C44E52', '#8172B3', '#937860', '#ffc107', '#a0a0a0']

/** Stage order, so the bars read as a funnel rather than by size. */
const STAGE_ORDER = [
  'Identified', 'Reached Out', 'In Conversation', 'Advancing', 'Committed', 'Active', 'Dormant',
]

interface PipelineEntry {
  contact_id: string
  purpose: string
  stage: string
}

/**
 * One carousel page per purpose: the one pipeline, split by why people are in it.
 * Reads open pipeline entries directly.
 */
function PipelineCarousel({ entries }: { entries: PipelineEntry[] }) {
  const purposes = useMemo(() => {
    const seen = new Map<string, number>()
    for (const e of entries) seen.set(e.purpose, (seen.get(e.purpose) ?? 0) + 1)
    return [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p)
  }, [entries])
  const [pipelineIdx, setPipelineIdx] = useState(0)
  const [barsReady, setBarsReady] = useState(false)
  const safePipelineIdx = pipelineIdx < purposes.length ? pipelineIdx : 0
  const purpose = purposes[safePipelineIdx]

  // Reset and replay bar animation on pipeline switch
  useEffect(() => {
    setBarsReady(false)
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => setBarsReady(true))
    })
    return () => cancelAnimationFrame(raf)
  }, [pipelineIdx])

  const stageData = useMemo(() => {
    const stages: Record<string, number> = {}
    for (const e of entries) {
      if (e.purpose !== purpose || !e.stage) continue
      stages[e.stage] = (stages[e.stage] ?? 0) + 1
    }
    const rows = Object.entries(stages).sort(
      (a, b) => STAGE_ORDER.indexOf(a[0]) - STAGE_ORDER.indexOf(b[0])
    )
    const total = rows.reduce((sum, [, count]) => sum + count, 0)
    return { entries: rows, total }
  }, [entries, purpose])

  return (
    <div
      className="rounded-lg p-4"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', minHeight: '220px' }}
    >
      {/* Header with carousel arrows */}
      <div className="mb-3 flex items-center justify-between">
        <h3
          className="text-xs font-semibold uppercase tracking-wider"
          style={{ color: 'var(--text-secondary)' }}
        >
          {purpose ?? 'Pipeline'}
        </h3>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setPipelineIdx((prev) => (prev - 1 + purposes.length) % purposes.length)}
            className="rounded px-1.5 py-0.5 text-xs transition-colors"
            style={{ background: 'var(--hover-light)', color: 'var(--text-secondary)', border: 'none', cursor: 'pointer' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--hover-medium)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--hover-light)')}
          >
            ‹
          </button>
          {/* Dot indicators */}
          <div className="flex items-center gap-1 px-1">
            {purposes.map((p, i) => (
              <span
                key={p}
                style={{
                  width: '5px',
                  height: '5px',
                  borderRadius: '50%',
                  background: i === safePipelineIdx ? 'var(--accent)' : 'var(--border-subtle)',
                  transition: 'background 200ms',
                  cursor: 'pointer',
                }}
                onClick={() => setPipelineIdx(i)}
              />
            ))}
          </div>
          <button
            onClick={() => setPipelineIdx((prev) => (prev + 1) % purposes.length)}
            className="rounded px-1.5 py-0.5 text-xs transition-colors"
            style={{ background: 'var(--hover-light)', color: 'var(--text-secondary)', border: 'none', cursor: 'pointer' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--hover-medium)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--hover-light)')}
          >
            ›
          </button>
        </div>
      </div>

      {stageData.entries.length === 0 ? (
        <p className="py-6 text-center text-xs" style={{ color: 'var(--text-faint)' }}>
          Nothing in the pipeline yet
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {stageData.entries.map(([stage, count], i) => {
            const pct = stageData.total > 0 ? (count / stageData.total) * 100 : 0
            return (
              <div key={stage}>
                <div className="mb-0.5 flex items-center justify-between">
                  <span className="text-xs" style={{ color: 'var(--text-primary)' }}>
                    {stage}
                  </span>
                  <span className="text-xs font-medium" style={{ color: 'var(--text-faint)' }}>
                    {count}
                  </span>
                </div>
                <div
                  style={{
                    height: '6px',
                    borderRadius: '3px',
                    background: 'var(--hover-light)',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: barsReady ? `${Math.max(pct, 2)}%` : '0%',
                      borderRadius: '3px',
                      background: STAGE_COLORS[i % STAGE_COLORS.length],
                      transition: 'width 400ms ease-out',
                      transitionDelay: `${i * 60}ms`,
                    }}
                  />
                </div>
              </div>
            )
          })}
          <div className="mt-1 text-right text-xs" style={{ color: 'var(--text-faint)' }}>
            {stageData.total} total
          </div>
        </div>
      )}
    </div>
  )
}

// ── Recent Activity (Center) ────────────────────────────────────────────

const ACTION_ICONS: Record<string, string> = {
  create: '✨',
  update: '✏️',
  delete: '🗑',
  status_change: '🔄',
  note_added: '📝',
}

function RecentActivity() {
  const { user } = useAuth()
  const [entries, setEntries] = useState<AuditLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [now] = useState(() => Date.now())

  useEffect(() => {
    if (!user) return
    const supabase = createClient()
    async function fetchLog() {
      const { data } = await supabase
        .from('audit_log')
        .select(`
          *,
          profiles:user_id ( id, full_name ),
          contacts:contact_id ( id, name, org )
        `)
        .order('created_at', { ascending: false })
        .limit(10)
      setEntries((data ?? []) as AuditLogEntry[])
      setLoading(false)
    }
    fetchLog()
  }, [user])

  function formatAction(entry: AuditLogEntry): string {
    const action = entry.action as ActionType
    const contact = (entry as unknown as { contacts: { name: string } | null }).contacts
    const name = contact?.name ?? 'Unknown'

    switch (action) {
      case 'create':
        return `Added ${name}`
      case 'delete':
        return `Deleted ${name}`
      case 'status_change':
        return `${name} → ${entry.new_value ?? 'updated'}`
      case 'note_added':
        return `Note on ${name}`
      case 'update':
        return entry.field_changed
          ? `${name}: ${entry.field_changed} updated`
          : `Updated ${name}`
      default:
        return `${action} — ${name}`
    }
  }

  function timeAgo(iso: string): string {
    const diff = now - new Date(iso).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    const days = Math.floor(hrs / 24)
    return `${days}d ago`
  }

  return (
    <div
      className="rounded-lg p-4"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', minHeight: '220px' }}
    >
      <h3
        className="mb-3 text-xs font-semibold uppercase tracking-wider"
        style={{ color: 'var(--text-secondary)' }}
      >
        Recent Activity
      </h3>

      {loading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="shimmer rounded"
              style={{ height: '16px', width: `${80 - i * 8}%` }}
            />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <p className="py-6 text-center text-xs" style={{ color: 'var(--text-faint)' }}>
          No recent activity
        </p>
      ) : (
        <div className="flex flex-col" style={{ maxHeight: '180px', overflowY: 'auto' }}>
          {entries.map((entry) => {
            const contact = (entry as unknown as { contacts: { id: string; name: string } | null }).contacts
            return (
              <a
                key={entry.id}
                href={contact?.id ? `/contacts/${contact.id}` : '#'}
                className="flex items-start gap-2 py-1.5 text-xs transition-colors"
                style={{
                  color: 'var(--text-primary)',
                  textDecoration: 'none',
                  borderBottom: '1px solid var(--hover-subtle)',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--hover-subtle)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <span style={{ flexShrink: 0, fontSize: '11px', lineHeight: '16px' }}>
                  {ACTION_ICONS[entry.action] ?? '•'}
                </span>
                <span className="min-w-0 flex-1 truncate" style={{ lineHeight: '16px' }}>
                  {formatAction(entry)}
                </span>
                <span
                  className="flex-shrink-0"
                  style={{ color: 'var(--text-faint)', fontSize: '10px', lineHeight: '16px' }}
                >
                  {timeAgo(entry.created_at)}
                </span>
              </a>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Urgent Tasks (Right) ────────────────────────────────────────────────

const PRIORITY_DOTS: Record<string, string> = {
  high: '#C44E52',
  medium: '#ffc107',
  low: '#a0a0a0',
}

function UrgentTasks() {
  const { user } = useAuth()
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [completingIds, setCompletingIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!user) return
    const supabase = createClient()
    async function fetchTasks() {
      // Sort: high priority first (by raw text ascending: 'high' < 'low' < 'medium')
      // Better approach: fetch all pending/in_progress and sort client-side
      const { data } = await supabase
        .from('tasks')
        .select(`
          *,
          contacts:contact_id ( id, name )
        `)
        .in('status', ['pending', 'in_progress'])
        .order('due_date', { ascending: true })
        .limit(20)

      // Client-side priority sort since DB text sort doesn't match
      const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 }
      const sorted = ((data ?? []) as Task[]).sort((a, b) => {
        const pa = priorityOrder[a.priority] ?? 9
        const pb = priorityOrder[b.priority] ?? 9
        if (pa !== pb) return pa - pb
        // Then by due date (nulls last)
        if (!a.due_date && !b.due_date) return 0
        if (!a.due_date) return 1
        if (!b.due_date) return -1
        return new Date(a.due_date).getTime() - new Date(b.due_date).getTime()
      })

      setTasks(sorted.slice(0, 10))
      setLoading(false)
    }
    fetchTasks()
  }, [user])

  async function handleDeleteTask(taskId: string) {
    if (deletingId === taskId) {
      // Second tap — confirm delete
      const supabase = createClient()
      const { error } = await supabase.from('tasks').delete().eq('id', taskId)
      setDeletingId(null)
      if (!error) {
        setTasks((prev) => prev.filter((t) => t.id !== taskId))
      }
    } else {
      // First tap — mark for confirmation
      setDeletingId(taskId)
      setTimeout(() => setDeletingId((prev) => (prev === taskId ? null : prev)), 3000)
    }
  }

  async function handleCompleteTask(taskId: string) {
    setCompletingIds((prev) => new Set(prev).add(taskId))
    const supabase = createClient()
    const { error } = await supabase
      .from('tasks')
      .update({ status: 'completed' })
      .eq('id', taskId)
    if (!error) {
      // Fade out then remove
      setTimeout(() => {
        setTasks((prev) => prev.filter((t) => t.id !== taskId))
        setCompletingIds((prev) => {
          const next = new Set(prev)
          next.delete(taskId)
          return next
        })
      }, 300)
    } else {
      setCompletingIds((prev) => {
        const next = new Set(prev)
        next.delete(taskId)
        return next
      })
    }
  }

  function formatDue(iso: string | null): string {
    if (!iso) return ''
    // Parse date-only strings (YYYY-MM-DD) as local midnight, not UTC
    const parts = iso.split('T')[0].split('-')
    const dueDay = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]))
    const now = new Date()
    const todayLocal = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const diff = Math.round((dueDay.getTime() - todayLocal.getTime()) / 86400000)
    if (diff < -1) return `${Math.abs(diff)}d overdue`
    if (diff === -1) return 'yesterday'
    if (diff === 0) return 'today'
    if (diff === 1) return 'tomorrow'
    return `in ${diff}d`
  }

  return (
    <div
      className="rounded-lg p-4"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', minHeight: '220px' }}
    >
      <div className="mb-3 flex items-center justify-between">
        <h3
          className="text-xs font-semibold uppercase tracking-wider"
          style={{ color: 'var(--text-secondary)' }}
        >
          Tasks
        </h3>
        <a
          href="/tasks"
          className="text-xs transition-colors"
          style={{ color: 'var(--accent)', textDecoration: 'none' }}
          onMouseEnter={(e) => (e.currentTarget.style.textDecoration = 'underline')}
          onMouseLeave={(e) => (e.currentTarget.style.textDecoration = 'none')}
        >
          View all →
        </a>
      </div>

      {loading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="shimmer rounded"
              style={{ height: '16px', width: `${85 - i * 10}%` }}
            />
          ))}
        </div>
      ) : tasks.length === 0 ? (
        <p className="py-6 text-center text-xs" style={{ color: 'var(--text-faint)' }}>
          No open tasks
        </p>
      ) : (
        <div className="flex flex-col" style={{ maxHeight: '180px', overflowY: 'auto' }}>
          {tasks.map((task) => {
            const contact = (task as unknown as { contacts: { id: string; name: string } | null }).contacts
            const isOverdue = task.due_date && (() => {
              const p = task.due_date!.split('T')[0].split('-')
              const due = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]))
              const now = new Date()
              const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
              return due.getTime() < today.getTime()
            })()
            const isConfirming = deletingId === task.id
            const isCompleting = completingIds.has(task.id)
            return (
              <div
                key={task.id}
                className="group flex items-start gap-2 py-1.5 text-xs transition-colors"
                style={{
                  color: 'var(--text-primary)',
                  borderBottom: '1px solid var(--hover-subtle)',
                  opacity: isCompleting ? 0.4 : 1,
                  transition: 'opacity 300ms, background 150ms',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--hover-subtle)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <input
                  type="checkbox"
                  checked={isCompleting}
                  onChange={() => handleCompleteTask(task.id)}
                  style={{
                    accentColor: 'var(--accent)',
                    cursor: 'pointer',
                    width: '13px',
                    height: '13px',
                    opacity: isCompleting ? 1 : 0.45,
                    transition: 'opacity 150ms',
                    filter: 'brightness(0.85)',
                    flexShrink: 0,
                    marginTop: '1px',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.opacity = '1' }}
                  onMouseLeave={(e) => { if (!isCompleting) e.currentTarget.style.opacity = '0.45' }}
                />
                <span
                  style={{
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    background: PRIORITY_DOTS[task.priority] ?? '#a0a0a0',
                    flexShrink: 0,
                    marginTop: '5px',
                  }}
                />
                <a
                  href={contact?.id ? `/contacts/${contact.id}` : '/tasks'}
                  className="min-w-0 flex-1 truncate"
                  style={{ lineHeight: '16px', color: 'inherit', textDecoration: 'none' }}
                >
                  {task.title}
                  {contact?.name && (
                    <span style={{ color: 'var(--text-faint)' }}> — {contact.name}</span>
                  )}
                </a>
                {task.due_date && (
                  <span
                    className="flex-shrink-0"
                    style={{
                      color: isOverdue ? '#C44E52' : 'var(--text-faint)',
                      fontSize: '10px',
                      lineHeight: '16px',
                      fontWeight: isOverdue ? 600 : 400,
                    }}
                  >
                    {formatDue(task.due_date)}
                  </span>
                )}
                <button
                  onClick={(e) => { e.preventDefault(); handleDeleteTask(task.id) }}
                  className="flex-shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                  style={{
                    background: isConfirming ? 'rgba(196,78,82,0.15)' : 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: isConfirming ? '#C44E52' : 'var(--text-faint)',
                    fontSize: '10px',
                    lineHeight: '16px',
                    padding: '0 2px',
                    borderRadius: '3px',
                    opacity: isConfirming ? 1 : undefined,
                  }}
                  title={isConfirming ? 'Click again to confirm delete' : 'Delete task'}
                >
                  {isConfirming ? '✕ del?' : '✕'}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Main Export ──────────────────────────────────────────────────────────

export default function DashboardCharts({ contacts }: { contacts: Contact[] }) {
  const [entries, setEntries] = useState<PipelineEntry[]>([])

  useEffect(() => {
    let cancelled = false
    const supabase = createClient()
    supabase
      .from('contact_pipelines')
      .select('contact_id, purpose, stage')
      .is('closed_at', null)
      .then((res: { data: PipelineEntry[] | null }) => {
        if (!cancelled) setEntries(res.data ?? [])
      })
    return () => { cancelled = true }
  }, [])

  if (contacts.length === 0) return null

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      <PipelineCarousel entries={entries} />
      <RecentActivity />
      <UrgentTasks />
    </div>
  )
}
