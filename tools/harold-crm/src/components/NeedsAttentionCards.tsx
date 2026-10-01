'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/hooks/useToast'
import type { Notification, NotificationType } from '@/lib/types'
import { NOTIFICATION_TYPE_META } from '@/lib/types'

const SEVERITY_STYLES: Record<string, { bg: string; border: string }> = {
  critical: { bg: 'rgba(196,78,82,0.1)', border: 'rgba(196,78,82,0.3)' },
  warning: { bg: 'rgba(221,132,82,0.1)', border: 'rgba(221,132,82,0.3)' },
  info: { bg: 'rgba(76,114,176,0.1)', border: 'rgba(76,114,176,0.3)' },
}

export default function NeedsAttentionCards() {
  const { user } = useAuth()
  const { toast } = useToast()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)

  const dismissNotification = useCallback(async (id: string) => {
    const prev = notifications
    setNotifications((ns) => ns.filter((n) => n.id !== id))
    const supabase = createClient()
    const { error } = await supabase.from('notifications').update({ dismissed: true }).eq('id', id)
    if (error) {
      setNotifications(prev)
      toast({ title: 'Failed to dismiss', type: 'error' })
    }
  }, [notifications, toast])

  useEffect(() => {
    if (!user) return

    const supabase = createClient()
    async function fetchNotifications() {
      const { data } = await supabase
        .from('notifications')
        .select('*, contacts:contact_id ( id, name, org, category )')
        .eq('user_id', user!.id)
        .eq('dismissed', false)
        .in('severity', ['critical', 'warning'])
        .order('created_at', { ascending: false })
        .limit(6)

      setNotifications((data ?? []) as Notification[])
      setLoading(false)
    }

    fetchNotifications()
  }, [user])

  if (loading || notifications.length === 0) return null

  return (
    <div>
      <h3
        className="mb-3 text-xs font-semibold uppercase tracking-wider"
        style={{ color: 'var(--text-secondary)' }}
      >
        Needs Attention
      </h3>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {notifications.map((n) => {
          const meta = NOTIFICATION_TYPE_META[n.type as NotificationType]
          const sevStyle = SEVERITY_STYLES[n.severity] ?? SEVERITY_STYLES.info

          return (
            <div
              key={n.id}
              className="relative rounded-lg p-3 pr-7"
              style={{
                background: sevStyle.bg,
                border: `1px solid ${sevStyle.border}`,
                cursor: n.contact_id ? 'pointer' : 'default',
              }}
              onClick={() => {
                if (n.contact_id) {
                  window.location.href = `/contacts/${n.contact_id}`
                }
              }}
            >
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  dismissNotification(n.id)
                }}
                className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full transition-colors"
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--text-tertiary)',
                  fontSize: 11,
                  lineHeight: 1,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = 'var(--text-secondary)'
                  e.currentTarget.style.background = 'rgba(0,0,0,0.08)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = 'var(--text-tertiary)'
                  e.currentTarget.style.background = 'transparent'
                }}
                title="Dismiss"
              >
                ✕
              </button>
              <div className="mb-1 flex items-center gap-2">
                <span style={{ fontSize: '13px' }}>{meta?.icon ?? '\u26A0'}</span>
                <span
                  className="text-xs font-semibold"
                  style={{ color: 'var(--text-primary)' }}
                >
                  {n.title}
                </span>
              </div>
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                {n.body}
              </p>
            </div>
          )
        })}
      </div>
    </div>
  )
}
