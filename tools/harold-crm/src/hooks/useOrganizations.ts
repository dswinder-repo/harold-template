'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Organization } from '@/lib/types'
import { cacheGet, cacheSet, cacheInvalidate, CACHE_TTL } from '@/lib/cache'

export interface OrgSearchResult extends Organization {
  contact_count?: number
}

export function useOrganizations() {
  const supabase = createClient()
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [loading, setLoading] = useState(true)
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  const fetchOrganizations = useCallback(async () => {
    const cacheKey = 'organizations:all'

    const cached = cacheGet<Organization[]>(cacheKey)
    if (cached) {
      setOrganizations(cached.data)
      if (cached.fresh) {
        setLoading(false)
        return
      }
    }

    setLoading(true)
    const { data, error } = await supabase
      .from('organizations')
      .select('*')
      .order('name', { ascending: true })

    if (!error && data) {
      const orgs = data as Organization[]
      cacheSet(cacheKey, orgs, CACHE_TTL.CONTACTS)
      setOrganizations(orgs)
    }
    setLoading(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- supabase is a module-level singleton
  }, [])

  useEffect(() => {
    fetchOrganizations()
  }, [fetchOrganizations])

  // Realtime subscription
  useEffect(() => {
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current)
    }

    const channel = supabase
      .channel('organizations-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'organizations' },
        () => { fetchOrganizations() }
      )
      .subscribe()

    channelRef.current = channel

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- supabase is a module-level singleton
  }, [fetchOrganizations])

  /**
   * Search organizations by name (fuzzy, ilike match).
   * Returns results with contact_count.
   */
  const searchOrgs = useCallback(async (query: string): Promise<OrgSearchResult[]> => {
    if (!query.trim()) return []

    const { data, error } = await supabase
      .from('organizations')
      .select('*, contacts(count)')
      .ilike('name', `%${query.trim()}%`)
      .order('name', { ascending: true })
      .limit(10)

    if (error || !data) return []

    return data.map((row: Record<string, unknown>) => {
      const contactArr = row.contacts as Array<{ count: number }> | undefined
      const contactCount = contactArr?.[0]?.count ?? 0
      const { contacts: _contacts, ...org } = row // eslint-disable-line @typescript-eslint/no-unused-vars
      return { ...org, contact_count: contactCount } as OrgSearchResult
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps -- supabase is a module-level singleton
  }, [])

  /**
   * Create a new organization. Returns the created org or an error.
   */
  const createOrg = async (
    name: string,
    fields?: Partial<Omit<Organization, 'id' | 'name' | 'name_normalized' | 'created_at' | 'updated_at'>>
  ) => {
    const { data, error } = await supabase
      .from('organizations')
      .insert({ name: name.trim(), ...fields })
      .select()
      .single()

    if (error) return { data: null, error: error.message }
    cacheInvalidate('organizations:all')
    setOrganizations(prev => [...prev, data as Organization].sort((a, b) => a.name.localeCompare(b.name)))
    return { data: data as Organization, error: null }
  }

  /**
   * Get a single organization by ID with contact count.
   */
  const getOrg = async (id: string) => {
    const { data, error } = await supabase
      .from('organizations')
      .select('*, contacts(count)')
      .eq('id', id)
      .single()

    if (error || !data) return null

    const row = data as Record<string, unknown>
    const contactArr = row.contacts as Array<{ count: number }> | undefined
    const contactCount = contactArr?.[0]?.count ?? 0
    const { contacts: _contacts, ...org } = row // eslint-disable-line @typescript-eslint/no-unused-vars
    return { ...org, contact_count: contactCount } as OrgSearchResult
  }

  /**
   * Update an organization. Optimistic update with rollback.
   */
  const updateOrg = async (id: string, updates: Partial<Organization>) => {
    const snapshot = organizations.find(o => o.id === id)
    setOrganizations(prev =>
      prev.map(o => (o.id === id ? { ...o, ...updates, updated_at: new Date().toISOString() } : o))
    )

    const { data, error } = await supabase
      .from('organizations')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      if (snapshot) {
        setOrganizations(prev => prev.map(o => (o.id === id ? snapshot : o)))
      }
      return { data: null, error: error.message }
    }
    cacheInvalidate('organizations:all')
    return { data: data as Organization, error: null }
  }

  /**
   * Find an organization by exact normalized name match.
   * Useful for checking if an org already exists before creating.
   */
  const findOrgByName = useCallback((name: string): Organization | undefined => {
    const normalized = name.trim().toLowerCase()
    return organizations.find(o => o.name_normalized === normalized)
  }, [organizations])

  return {
    organizations,
    loading,
    searchOrgs,
    createOrg,
    getOrg,
    updateOrg,
    findOrgByName,
    refetch: fetchOrganizations,
  }
}
