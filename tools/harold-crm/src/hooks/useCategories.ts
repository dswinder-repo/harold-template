'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Category } from '@/lib/types'
import { DEFAULT_CATEGORY_COLORS } from '@/lib/types'
import { cacheGet, cacheSet, cacheInvalidate, CACHE_TTL } from '@/lib/cache'

export function useCategories() {
  const supabase = createClient()
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  const fetchCategories = useCallback(async () => {
    const cacheKey = 'categories:all'

    // Check cache first
    const cached = cacheGet<Category[]>(cacheKey)
    if (cached) {
      setCategories(cached.data)
      if (cached.fresh) {
        setLoading(false)
        return
      }
    }

    const { data } = await supabase
      .from('categories')
      .select('*')
      .order('sort_order', { ascending: true })

    if (data) {
      const cats = data as Category[]
      cacheSet(cacheKey, cats, CACHE_TTL.CATEGORIES)
      setCategories(cats)
    }
    setLoading(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- supabase is a module-level singleton
  }, [])

  useEffect(() => {
    fetchCategories()
  }, [fetchCategories])

  // Realtime subscription
  useEffect(() => {
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current)
    }

    const channel = supabase
      .channel('categories-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'categories' },
        () => { fetchCategories() }
      )
      .subscribe()

    channelRef.current = channel

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- supabase is a module-level singleton
  }, [fetchCategories])

  // Create a new category
  const createCategory = async (
    name: string,
    label: string,
    color: string,
    userId: string
  ) => {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
    const maxSort = categories.length > 0
      ? Math.max(...categories.map(c => c.sort_order))
      : 0

    const { data, error } = await supabase
      .from('categories')
      .insert({
        name: slug,
        label,
        color,
        sort_order: maxSort + 1,
        is_default: false,
        created_by: userId,
      })
      .select()
      .single()

    if (error) return { error }
    cacheInvalidate('categories:all')
    setCategories(prev => [...prev, data as Category])
    return { data }
  }

  // Derived helpers
  const categoryNames = categories.map(c => c.name)
  const categoryColors: Record<string, string> = {}
  const categoryLabels: Record<string, string> = {}
  for (const c of categories) {
    categoryColors[c.name] = c.color
    categoryLabels[c.name] = c.label
  }

  // Merge with defaults for safety
  const getColor = (name: string) =>
    categoryColors[name] ?? DEFAULT_CATEGORY_COLORS[name] ?? '#937860'
  const getLabel = (name: string) =>
    categoryLabels[name] ?? name.charAt(0).toUpperCase() + name.slice(1)

  return {
    categories,
    loading,
    categoryNames,
    categoryColors,
    categoryLabels,
    getColor,
    getLabel,
    createCategory,
    refetch: fetchCategories,
  }
}
