'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { EnumOption } from '@/lib/types'
import {
  STATUS_OPTIONS,
  PRIORITY_OPTIONS,
  WARMTH_OPTIONS,
  INVESTOR_TYPE_OPTIONS,
  REGION_OPTIONS,
} from '@/lib/types'
import { cacheGet, cacheSet, cacheInvalidate, CACHE_TTL } from '@/lib/cache'

const CACHE_KEY = 'enum_options:all'

// Fallback defaults until DB loads
const FALLBACK_OPTIONS: Record<string, string[]> = {
  status: STATUS_OPTIONS,
  priority: PRIORITY_OPTIONS,
  warmth: WARMTH_OPTIONS,
  investor_type: INVESTOR_TYPE_OPTIONS,
  region: REGION_OPTIONS,
}

export function useEnumOptions() {
  const supabase = createClient()
  const [allOptions, setAllOptions] = useState<EnumOption[]>([])
  const [loading, setLoading] = useState(true)
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  const fetchOptions = useCallback(async () => {
    // Check cache first
    const cached = cacheGet<EnumOption[]>(CACHE_KEY)
    if (cached) {
      setAllOptions(cached.data)
      if (cached.fresh) {
        setLoading(false)
        return
      }
    }

    const { data } = await supabase
      .from('enum_options')
      .select('*')
      .order('group_name', { ascending: true })
      .order('sort_order', { ascending: true })

    if (data) {
      const opts = data as EnumOption[]
      cacheSet(CACHE_KEY, opts, CACHE_TTL.ENUM_OPTIONS)
      setAllOptions(opts)
    }
    setLoading(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- supabase is a module-level singleton
  }, [])

  useEffect(() => {
    fetchOptions()
  }, [fetchOptions])

  // Realtime subscription
  useEffect(() => {
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current)
    }

    const channel = supabase
      .channel('enum-options-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'enum_options' },
        () => { fetchOptions() }
      )
      .subscribe()

    channelRef.current = channel

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- supabase is a module-level singleton
  }, [fetchOptions])

  /**
   * Get option values for a group as a string array.
   * Prepends empty string for "none" selection (warmth, investor_type, region).
   * Falls back to hardcoded defaults if DB hasn't loaded yet.
   */
  const getOptions = useCallback((group: string): string[] => {
    const groupOpts = allOptions.filter(o => o.group_name === group)
    if (groupOpts.length === 0) {
      return FALLBACK_OPTIONS[group] ?? []
    }
    const values = groupOpts.map(o => o.value)
    // Prepend empty string for optional fields (warmth, investor_type, region)
    if (['warmth', 'investor_type', 'region'].includes(group)) {
      return ['', ...values]
    }
    return values
  }, [allOptions])

  /**
   * Get full EnumOption objects for a group.
   */
  const getOptionsRaw = useCallback((group: string): EnumOption[] => {
    return allOptions.filter(o => o.group_name === group)
  }, [allOptions])

  /**
   * Add a new option to a group.
   */
  const addOption = async (
    group: string,
    value: string,
    label: string,
    userId: string
  ) => {
    const groupOpts = allOptions.filter(o => o.group_name === group)
    const maxSort = groupOpts.length > 0
      ? Math.max(...groupOpts.map(o => o.sort_order))
      : 0

    const { data, error } = await supabase
      .from('enum_options')
      .insert({
        group_name: group,
        value,
        label,
        sort_order: maxSort + 1,
        is_default: false,
        created_by: userId,
      })
      .select()
      .single()

    if (error) return { error }
    cacheInvalidate(CACHE_KEY)
    setAllOptions(prev => [...prev, data as EnumOption])
    return { data }
  }

  /**
   * Update an existing option (label, value, sort_order).
   */
  const updateOption = async (
    id: string,
    updates: { value?: string; label?: string; sort_order?: number }
  ) => {
    const { data, error } = await supabase
      .from('enum_options')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) return { error }
    cacheInvalidate(CACHE_KEY)
    setAllOptions(prev => prev.map(o => o.id === id ? (data as EnumOption) : o))
    return { data }
  }

  /**
   * Delete an option. Only non-default options can be deleted (enforced by RLS).
   */
  const deleteOption = async (id: string) => {
    const opt = allOptions.find(o => o.id === id)
    if (opt?.is_default) {
      return { error: { message: 'Default options cannot be deleted' } }
    }

    const { error } = await supabase
      .from('enum_options')
      .delete()
      .eq('id', id)

    if (error) return { error }
    cacheInvalidate(CACHE_KEY)
    setAllOptions(prev => prev.filter(o => o.id !== id))
    return { error: null }
  }

  return {
    allOptions,
    loading,
    getOptions,
    getOptionsRaw,
    addOption,
    updateOption,
    deleteOption,
    refetch: fetchOptions,
  }
}
