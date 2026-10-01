'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { WarmthDecayThreshold } from '@/lib/types'
import { WARMTH_DECAY_THRESHOLDS } from '@/lib/types'

type CrmSettingsMap = Record<string, unknown>

export function useCrmSettings() {
  const supabase = createClient()
  const [settings, setSettings] = useState<CrmSettingsMap>({})
  const [loading, setLoading] = useState(true)
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  const fetchSettings = useCallback(async () => {
    const { data, error } = await supabase
      .from('crm_settings')
      .select('key, value')

    if (error) {
      console.error('Failed to fetch CRM settings:', error.message)
      setLoading(false)
      return
    }

    const map: CrmSettingsMap = {}
    for (const row of data ?? []) {
      map[row.key] = row.value
    }
    setSettings(map)
    setLoading(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    fetchSettings()
  }, [fetchSettings])

  // Realtime subscription
  useEffect(() => {
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current)
    }

    const channel = supabase
      .channel('crm_settings_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'crm_settings' },
        () => { fetchSettings() }
      )
      .subscribe()

    channelRef.current = channel

    return () => { supabase.removeChannel(channel) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const getSetting = useCallback(<T = unknown>(key: string, fallback?: T): T => {
    return (settings[key] as T) ?? (fallback as T)
  }, [settings])

  const updateSetting = useCallback(async (key: string, value: unknown) => {
    const { error } = await supabase
      .from('crm_settings')
      .upsert({
        key,
        value,
        updated_at: new Date().toISOString(),
      })

    if (error) return { error: error.message }

    setSettings((prev) => ({ ...prev, [key]: value }))
    return { error: null }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Get warmth decay thresholds from DB, falling back to hardcoded defaults */
  const getWarmthThresholds = useCallback((): Record<string, WarmthDecayThreshold> => {
    const stored = settings['warmth_decay_thresholds'] as Record<string, WarmthDecayThreshold> | undefined
    if (!stored) return WARMTH_DECAY_THRESHOLDS

    // Merge with defaults to ensure all keys exist
    return {
      Hot: stored.Hot ?? WARMTH_DECAY_THRESHOLDS.Hot,
      Warm: stored.Warm ?? WARMTH_DECAY_THRESHOLDS.Warm,
      Lukewarm: stored.Lukewarm ?? WARMTH_DECAY_THRESHOLDS.Lukewarm,
    }
  }, [settings])

  return {
    settings,
    loading,
    getSetting,
    updateSetting,
    getWarmthThresholds,
    refetch: fetchSettings,
  }
}
