'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Notification } from '@/lib/types'

const SELECT_QUERY = `
  *,
  contacts:contact_id ( id, name, org, category )
`

export function useNotifications(userId?: string) {
  const supabase = createClient()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const fetchNotifications = useCallback(async () => {
    if (!userId) {
      setNotifications([])
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    const { data, error: fetchError } = await supabase
      .from('notifications')
      .select(SELECT_QUERY)
      .eq('user_id', userId)
      .eq('dismissed', false)
      .order('created_at', { ascending: false })
      .limit(50)

    if (fetchError) {
      setError(fetchError.message)
      setNotifications([])
    } else {
      setNotifications((data ?? []) as Notification[])
    }
    setLoading(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- supabase is a module-level singleton
  }, [userId])

  useEffect(() => {
    fetchNotifications()
  }, [fetchNotifications])

  // Realtime subscription
  useEffect(() => {
    if (!userId) return

    if (channelRef.current) {
      supabase.removeChannel(channelRef.current)
    }

    const channel = supabase
      .channel(`notifications-${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        async (payload: { eventType: string; new: Record<string, unknown>; old: Record<string, unknown> }) => {
          if (payload.eventType === 'DELETE') {
            setNotifications((prev) =>
              prev.filter((n) => n.id !== (payload.old as unknown as { id: string }).id)
            )
            return
          }

          // For INSERT or UPDATE, fetch the full entry with joins
          const { data } = await supabase
            .from('notifications')
            .select(SELECT_QUERY)
            .eq('id', (payload.new as unknown as { id: string }).id)
            .single()

          if (data) {
            const notif = data as Notification
            // If dismissed, remove from list
            if (notif.dismissed) {
              setNotifications((prev) => prev.filter((n) => n.id !== notif.id))
              return
            }
            setNotifications((prev) => {
              const exists = prev.find((n) => n.id === notif.id)
              if (exists) {
                return prev.map((n) => (n.id === notif.id ? notif : n))
              }
              return [notif, ...prev].slice(0, 50)
            })
          }
        }
      )
      .subscribe()

    channelRef.current = channel

    return () => {
      supabase.removeChannel(channel)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- supabase is a module-level singleton
  }, [userId])

  const markRead = async (id: string) => {
    const { error } = await supabase
      .from('notifications')
      .update({ read: true })
      .eq('id', id)

    if (!error) {
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)))
    }
    return { error }
  }

  const markAllRead = async () => {
    if (!userId) return { error: 'Not authenticated' }
    const { error } = await supabase
      .from('notifications')
      .update({ read: true })
      .eq('user_id', userId)
      .eq('read', false)
      .eq('dismissed', false)

    if (!error) {
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
    }
    return { error }
  }

  const dismiss = async (id: string) => {
    const { error } = await supabase
      .from('notifications')
      .update({ dismissed: true })
      .eq('id', id)

    if (!error) {
      setNotifications((prev) => prev.filter((n) => n.id !== id))
    }
    return { error }
  }

  const dismissAll = async () => {
    if (!userId) return { error: 'Not authenticated' }
    const { error } = await supabase
      .from('notifications')
      .update({ dismissed: true })
      .eq('user_id', userId)
      .eq('dismissed', false)

    if (!error) {
      setNotifications([])
    }
    return { error }
  }

  const unreadCount = notifications.filter((n) => !n.read).length

  return {
    notifications,
    loading,
    error,
    unreadCount,
    markRead,
    markAllRead,
    dismiss,
    dismissAll,
    refetch: fetchNotifications,
  }
}
