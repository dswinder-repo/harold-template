'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Contact, StatusType } from '@/lib/types'
import { sortContacts, contactMatchesSearch } from '@/lib/utils'
import { cacheGet, cacheSet, cacheInvalidate, CACHE_TTL } from '@/lib/cache'
import { PIPELINE_EMBED, withPipelineSummary } from '@/lib/pipeline'

interface ContactFilters {
  category?: string | 'all'
  status?: StatusType | 'all'
  search?: string
}

export function useContacts(initialFilters?: ContactFilters) {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState<ContactFilters>(initialFilters ?? {})
  const [totalCount, setTotalCount] = useState<number | null>(null)
  const supabase = createClient()
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  const fetchContacts = useCallback(async () => {
    const cacheKey = `contacts:${filters.category ?? 'all'}:${filters.status ?? 'all'}`

    // Check cache first
    const cached = cacheGet<Contact[]>(cacheKey)
    if (cached) {
      let result = cached.data
      if (filters.search) {
        result = result.filter(c => contactMatchesSearch(c, filters.search!))
      }
      setContacts(result)
      if (cached.fresh) {
        setLoading(false)
        return
      }
    }

    setLoading(true)
    setError(null)

    // Build query — fetch all contacts (no pagination limit)
    let query = supabase.from('contacts').select(`*, ${PIPELINE_EMBED}`, { count: 'exact' })

    if (filters.category && filters.category !== 'all') {
      query = query.eq('category', filters.category)
    }
    if (filters.status && filters.status !== 'all') {
      query = query.eq('status', filters.status)
    }

    const { data, error: fetchError, count } = await query
      .order('updated_at', { ascending: false })

    if (fetchError) {
      setError(fetchError.message)
      setContacts([])
    } else {
      const fetched = ((data ?? []) as Contact[]).map(withPipelineSummary)
      cacheSet(cacheKey, fetched, CACHE_TTL.CONTACTS)
      let result = fetched
      if (filters.search) {
        result = result.filter(c => contactMatchesSearch(c, filters.search!))
      }
      setContacts(result)
      if (count !== null && count !== undefined) setTotalCount(count)
    }
    setLoading(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- supabase is a module-level singleton
  }, [filters])

  // Initial fetch and refetch on filter change
  useEffect(() => {
    fetchContacts()
  }, [fetchContacts])

  // Realtime subscription
  useEffect(() => {
    // Clean up previous subscription
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current)
    }

    const channel = supabase
      .channel('contacts-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'contacts' },
        async (payload: { eventType: string; new: Record<string, unknown>; old: Record<string, unknown> }) => {
          if (payload.eventType === 'INSERT') {
            // Re-fetch the contact to get complete data (payload.new lacks joined fields)
            const newId = (payload.new as unknown as { id: string }).id
            const { data } = await supabase
              .from('contacts')
              .select(`*, ${PIPELINE_EMBED}`)
              .eq('id', newId)
              .single()
            if (data) {
              setContacts(prev => [withPipelineSummary(data as Contact), ...prev])
            }
          } else if (payload.eventType === 'UPDATE') {
            // The payload carries columns only; keep the pipeline summary already derived.
            const updated = payload.new as unknown as Contact
            setContacts(prev =>
              prev.map(c => (c.id === updated.id ? { ...c, ...updated } : c))
            )
          } else if (payload.eventType === 'DELETE') {
            const deleted = payload.old as unknown as { id: string }
            setContacts(prev => prev.filter(c => c.id !== deleted.id))
          }
        }
      )
      .subscribe()

    channelRef.current = channel

    return () => {
      supabase.removeChannel(channel)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- supabase is a module-level singleton
  }, [])

  const createContact = async (contact: Partial<Contact>) => {
    const { data, error } = await supabase
      .from('contacts')
      .insert(contact)
      .select()
      .single()

    if (error) return { data: null, error: error.message }
    cacheInvalidate(`contacts:${filters.category ?? 'all'}:${filters.status ?? 'all'}`)
    return { data: data as Contact, error: null }
  }

  const updateContact = async (id: string, updates: Partial<Contact>) => {
    // Optimistic: apply immediately, rollback on error
    const snapshot = contacts.find((c) => c.id === id)
    setContacts((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...updates, updated_at: new Date().toISOString() } : c))
    )

    const { data, error } = await supabase
      .from('contacts')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      // Rollback
      if (snapshot) {
        setContacts((prev) => prev.map((c) => (c.id === id ? snapshot : c)))
      }
      return { data: null, error: error.message }
    }
    return { data: data as Contact, error: null }
  }

  const deleteContact = async (id: string) => {
    const { error } = await supabase
      .from('contacts')
      .delete()
      .eq('id', id)

    if (error) return { error: error.message }
    return { error: null }
  }

  return {
    contacts,
    loading,
    error,
    filters,
    setFilters,
    refetch: fetchContacts,
    totalCount,
    createContact,
    updateContact,
    deleteContact,
    sortedContacts: (field?: Parameters<typeof sortContacts>[1], dir?: Parameters<typeof sortContacts>[2]) =>
      sortContacts(contacts, field, dir),
  }
}
