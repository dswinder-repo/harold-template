'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useNotifications } from '@/hooks/useNotifications'
import { generateNotifications } from '@/lib/generateNotifications'
import { NOTIFICATION_TYPE_META } from '@/lib/types'
import type { Notification, NotificationType } from '@/lib/types'

/**
 * Notifications are generated in the browser from the signed-in user's own data
 * (see lib/generateNotifications.ts), so no server job or service key is needed.
 */
async function generateNotificationsWithFallback(userId: string): Promise<void> {
  await generateNotifications(userId)
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'var(--danger)',
  warning: 'var(--warning)',
  info: 'var(--accent)',
}

export default function NotificationBell({ userId }: { userId: string }) {
  const { notifications, unreadCount, markRead, markAllRead, dismissAll, refetch } =
    useNotifications(userId)
  const [open, setOpen] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [actionFeedback, setActionFeedback] = useState<string | null>(null)
  const [createdTasks, setCreatedTasks] = useState<Set<string>>(new Set())
  const dropdownRef = useRef<HTMLDivElement>(null)
  const bellRef = useRef<SVGSVGElement>(null)
  const prevCountRef = useRef(unreadCount)
  const router = useRouter()

  // Bounce bell icon when unread count increases
  useEffect(() => {
    if (unreadCount > prevCountRef.current && bellRef.current) {
      bellRef.current.classList.remove('animate-micro-bounce')
      // Force reflow to restart animation
      void bellRef.current.getBoundingClientRect()
      bellRef.current.classList.add('animate-micro-bounce')
    }
    prevCountRef.current = unreadCount
  }, [unreadCount])

  // Create a follow-up task from a stale_contact or warmth_decay notification
  const handleCreateFollowUp = useCallback(async (notif: Notification, e: React.MouseEvent) => {
    e.stopPropagation() // Don't trigger navigation
    if (createdTasks.has(notif.id)) return

    const supabase = createClient()
    const threeDaysFromNow = new Date(Date.now() + 3 * 86400000).toISOString().split('T')[0]

    const { error } = await supabase.from('tasks').insert({
      contact_id: notif.contact_id,
      assigned_to: userId,
      created_by: userId,
      title: `Follow up: ${notif.title}`,
      description: notif.body,
      status: 'pending',
      priority: 'medium',
      due_date: threeDaysFromNow,
    })

    if (!error) {
      setCreatedTasks((prev) => new Set(prev).add(notif.id))
    }
  }, [userId, createdTasks])

  // Track if we just dismissed all — prevent regeneration on mount
  const justDismissedRef = useRef(false)

  // Generate notifications on mount (once), but NOT if we just dismissed
  const hasGenerated = useRef(false)
  useEffect(() => {
    if (hasGenerated.current || justDismissedRef.current) return
    hasGenerated.current = true
    generateNotificationsWithFallback(userId).then(() => refetch())
  }, [userId, refetch])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Clear feedback after 2 seconds
  useEffect(() => {
    if (!actionFeedback) return
    const timer = setTimeout(() => setActionFeedback(null), 2000)
    return () => clearTimeout(timer)
  }, [actionFeedback])

  const handleRefresh = async () => {
    justDismissedRef.current = false
    setGenerating(true)
    await generateNotificationsWithFallback(userId)
    await refetch()
    setGenerating(false)
  }

  const handleClickNotification = async (notif: Notification) => {
    if (!notif.read) {
      await markRead(notif.id)
    }
    setOpen(false)
    if (notif.contact_id) {
      router.push(`/contacts/${notif.contact_id}`)
    }
  }

  const handleMarkAllRead = async () => {
    setActionFeedback('Marking all as read...')
    await markAllRead()
    setActionFeedback('✓ All marked as read')
  }

  const handleDismissAll = async () => {
    justDismissedRef.current = true
    setActionFeedback('Dismissing all...')
    await dismissAll()
    setActionFeedback('✓ All dismissed')
    // Close after a brief pause so user sees confirmation
    setTimeout(() => setOpen(false), 600)
  }

  const typeIcon = (type: NotificationType) => NOTIFICATION_TYPE_META[type]?.icon ?? ''

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell button */}
      <button
        data-testid="notification-bell"
        onClick={() => setOpen(!open)}
        className="btn-press relative flex items-center justify-center rounded p-1.5 transition-colors"
        style={{
          background: open ? 'var(--hover-strong)' : 'var(--hover-light)',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--text-header)',
          width: 36,
          height: 36,
        }}
        onMouseEnter={(e) => {
          if (!open) e.currentTarget.style.background = 'var(--hover-strong)'
        }}
        onMouseLeave={(e) => {
          if (!open) e.currentTarget.style.background = 'var(--hover-light)'
        }}
        title="Notifications"
      >
        <svg
          ref={bellRef}
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unreadCount > 0 && (
          <span
            className="absolute flex items-center justify-center rounded-full text-xs font-bold"
            style={{
              top: 2,
              right: 2,
              minWidth: 16,
              height: 16,
              padding: '0 4px',
              background: 'var(--danger)',
              color: '#fff',
              fontSize: 10,
            }}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div
          className="absolute right-0 mt-2 overflow-hidden rounded-lg shadow-lg"
          style={{
            width: 380,
            maxHeight: 480,
            background: 'var(--bg-card)',
            border: '1px solid var(--border-subtle)',
            zIndex: 60,
          }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between px-4 py-3"
            style={{ borderBottom: '1px solid var(--border-subtle)' }}
          >
            <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              Notifications
              {unreadCount > 0 && (
                <span
                  className="ml-2 rounded-full px-1.5 py-0.5 text-xs"
                  style={{ background: 'rgba(196,78,82,0.3)', color: 'var(--danger)' }}
                >
                  {unreadCount}
                </span>
              )}
            </span>
            <button
              onClick={handleRefresh}
              disabled={generating}
              className="btn-press text-xs transition-colors"
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--accent)',
                cursor: generating ? 'wait' : 'pointer',
                opacity: generating ? 0.5 : 1,
              }}
            >
              {generating ? 'Scanning...' : 'Refresh'}
            </button>
          </div>

          {/* List */}
          <div style={{ maxHeight: 360, overflowY: 'auto' }}>
            {notifications.length === 0 ? (
              <div
                className="flex flex-col items-center justify-center py-8"
                style={{ color: 'var(--text-muted)' }}
              >
                <span style={{ fontSize: 28, marginBottom: 8 }}>&#x2705;</span>
                <span className="text-sm">All clear — no alerts</span>
              </div>
            ) : (
              notifications.map((notif) => (
                <button
                  key={notif.id}
                  onClick={() => handleClickNotification(notif)}
                  className="flex w-full gap-3 px-4 py-3 text-left transition-colors"
                  style={{
                    background: notif.read ? 'transparent' : 'rgba(76,114,176,0.1)',
                    borderBottom: '1px solid var(--hover-subtle)',
                    borderLeft: notif.read ? 'none' : '3px solid var(--accent)',
                    borderTop: 'none',
                    borderRight: 'none',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = 'var(--hover-subtle)')
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = notif.read
                      ? 'transparent'
                      : 'rgba(76,114,176,0.1)')
                  }
                >
                  {/* Severity dot */}
                  <div className="flex flex-col items-center pt-1">
                    <span
                      className="inline-block rounded-full"
                      style={{
                        width: 8,
                        height: 8,
                        background: SEVERITY_COLORS[notif.severity] ?? SEVERITY_COLORS.info,
                      }}
                    />
                  </div>

                  {/* Content */}
                  <div className="flex-1 overflow-hidden">
                    <div className="flex items-center gap-2">
                      <span style={{ fontSize: 14 }}>{typeIcon(notif.type)}</span>
                      <span
                        className="truncate text-sm"
                        style={{
                          color: notif.read ? 'var(--text-muted)' : 'var(--text-primary)',
                          fontWeight: notif.read ? 400 : 600,
                        }}
                      >
                        {notif.title}
                      </span>
                    </div>
                    <p
                      className="mt-0.5 truncate text-xs"
                      style={{ color: notif.read ? 'var(--text-muted)' : 'var(--text-secondary)', margin: 0 }}
                    >
                      {notif.body}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {timeAgo(notif.created_at)}
                      </span>
                      {(notif.type === 'stale_contact' || notif.type === 'warmth_decay') &&
                        notif.contact_id && (
                          <button
                            onClick={(e) => handleCreateFollowUp(notif, e)}
                            className="btn-press rounded px-1.5 py-0.5 text-xs font-medium transition-colors"
                            style={{
                              background: createdTasks.has(notif.id)
                                ? 'rgba(40,167,69,0.15)'
                                : 'rgba(76,114,176,0.12)',
                              border: createdTasks.has(notif.id)
                                ? '1px solid rgba(40,167,69,0.3)'
                                : '1px solid rgba(76,114,176,0.25)',
                              color: createdTasks.has(notif.id)
                                ? 'var(--success)'
                                : 'var(--accent)',
                              cursor: createdTasks.has(notif.id) ? 'default' : 'pointer',
                            }}
                            disabled={createdTasks.has(notif.id)}
                          >
                            {createdTasks.has(notif.id) ? '✓ Task created' : '+ Follow-up'}
                          </button>
                        )}
                    </div>
                  </div>

                  {/* Unread indicator */}
                  {!notif.read && (
                    <div className="flex items-center">
                      <span
                        className="inline-block rounded-full"
                        style={{ width: 8, height: 8, background: 'var(--accent)' }}
                      />
                    </div>
                  )}
                </button>
              ))
            )}
          </div>

          {/* Footer */}
          {notifications.length > 0 && (
            <div
              className="flex items-center justify-between px-4 py-2.5"
              style={{ borderTop: '1px solid var(--border-subtle)' }}
            >
              {actionFeedback ? (
                <span
                  className="text-xs font-medium"
                  style={{
                    color: actionFeedback.startsWith('✓') ? 'var(--success)' : 'var(--text-muted)',
                  }}
                >
                  {actionFeedback}
                </span>
              ) : (
                <>
                  <button
                    onClick={handleMarkAllRead}
                    className="btn-press rounded px-2.5 py-1 text-xs font-medium transition-colors"
                    style={{
                      background: 'rgba(76,114,176,0.15)',
                      border: '1px solid rgba(76,114,176,0.3)',
                      color: 'var(--accent)',
                      cursor: 'pointer',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(76,114,176,0.25)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'rgba(76,114,176,0.15)'
                    }}
                  >
                    Mark all read
                  </button>
                  <button
                    onClick={handleDismissAll}
                    className="btn-press rounded px-2.5 py-1 text-xs font-medium transition-colors"
                    style={{
                      background: 'rgba(196,78,82,0.1)',
                      border: '1px solid rgba(196,78,82,0.25)',
                      color: 'var(--danger)',
                      cursor: 'pointer',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(196,78,82,0.2)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'rgba(196,78,82,0.1)'
                    }}
                  >
                    Dismiss all
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
