'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/AuthProvider'
import type { NotificationType } from '@/lib/types'

export interface UserPreferences {
  theme: 'dark' | 'light'
  notification_settings: Partial<Record<NotificationType, boolean>>
}

const DEFAULTS: UserPreferences = {
  theme: 'dark',
  notification_settings: {},
}

export function usePreferences() {
  const supabase = createClient()
  const { user } = useAuth()
  const [preferences, setPreferences] = useState<UserPreferences>(DEFAULTS)
  const [loading, setLoading] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  const userId = user?.id

  const fetchPreferences = useCallback(async () => {
    if (!userId) {
      setPreferences(DEFAULTS)
      setLoading(false)
      return
    }

    const { data, error } = await supabase
      .from('user_preferences')
      .select('*')
      .eq('user_id', userId)
      .single()

    if (error && error.code !== 'PGRST116') {
      // PGRST116 = no rows — that's fine, use defaults
      console.error('Failed to fetch preferences:', error.message)
    }

    if (data) {
      setPreferences({
        theme: data.theme ?? 'dark',
        notification_settings: (data.notification_settings as Record<string, boolean>) ?? {},
      })
    } else {
      // Read theme from localStorage as initial default
      const stored = typeof window !== 'undefined'
        ? localStorage.getItem('harold-theme')
        : null
      setPreferences({
        ...DEFAULTS,
        theme: (stored === 'light' ? 'light' : 'dark'),
      })
    }

    setLoading(false)
    setLoaded(true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  useEffect(() => {
    fetchPreferences()
  }, [fetchPreferences])

  // Realtime subscription
  useEffect(() => {
    if (!userId) return

    if (channelRef.current) {
      supabase.removeChannel(channelRef.current)
    }

    const channel = supabase
      .channel(`user_preferences-${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'user_preferences',
          filter: `user_id=eq.${userId}`,
        },
        () => { fetchPreferences() }
      )
      .subscribe()

    channelRef.current = channel

    return () => { supabase.removeChannel(channel) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  const savePreferences = useCallback(async (updates: Partial<UserPreferences>) => {
    if (!userId) return { error: 'Not authenticated' }

    const merged = { ...preferences, ...updates }

    const { error } = await supabase
      .from('user_preferences')
      .upsert({
        user_id: userId,
        theme: merged.theme,
        notification_settings: merged.notification_settings,
        updated_at: new Date().toISOString(),
      })

    if (error) return { error: error.message }

    setPreferences(merged)
    return { error: null }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, preferences])

  const updateNotificationSetting = useCallback(async (type: NotificationType, enabled: boolean) => {
    const next = { ...preferences.notification_settings, [type]: enabled }
    return savePreferences({ notification_settings: next })
  }, [preferences.notification_settings, savePreferences])

  /** Check if a notification type is enabled (default: true — opt-out model) */
  const isNotificationEnabled = useCallback((type: NotificationType): boolean => {
    const val = preferences.notification_settings[type]
    return val !== false // undefined or true → enabled
  }, [preferences.notification_settings])

  return {
    preferences,
    loading,
    loaded,
    savePreferences,
    updateNotificationSetting,
    isNotificationEnabled,
    refetch: fetchPreferences,
  }
}
