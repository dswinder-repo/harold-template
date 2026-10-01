'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { AuditLogEntry } from '@/lib/types'

interface UseAuditLogOptions {
  contactId?: string
  limit?: number
}

export function useAuditLog(options: UseAuditLogOptions = {}) {
  const { contactId, limit = 50 } = options
  const [entries, setEntries] = useState<AuditLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const supabase = createClient()
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  useEffect(() => {
    const fetchLog = async () => {
      setLoading(true)
      setError(null)

      let query = supabase
        .from('audit_log')
        .select(`
          *,
          profiles:user_id ( id, full_name, email, avatar_url ),
          contacts:contact_id ( id, name, org )
        `)
        .order('created_at', { ascending: false })
        .limit(limit)

      if (contactId) {
        query = query.eq('contact_id', contactId)
      }

      const { data, error: fetchError } = await query

      if (fetchError) {
        setError(fetchError.message)
        setEntries([])
      } else {
        setEntries((data ?? []) as AuditLogEntry[])
      }
      setLoading(false)
    }

    fetchLog()
  // eslint-disable-next-line react-hooks/exhaustive-deps -- supabase is a module-level singleton
  }, [contactId, limit])

  // Realtime subscription for new audit entries
  useEffect(() => {
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current)
    }

    const filter = contactId
      ? `contact_id=eq.${contactId}`
      : undefined

    const channel = supabase
      .channel('audit-log-realtime')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'audit_log',
          ...(filter ? { filter } : {}),
        },
        async (payload: { new: Record<string, unknown> }) => {
          // Fetch the full entry with joins
          const { data } = await supabase
            .from('audit_log')
            .select(`
              *,
              profiles:user_id ( id, full_name, email, avatar_url ),
              contacts:contact_id ( id, name, org )
            `)
            .eq('id', (payload.new as unknown as { id: string }).id)
            .single()

          if (data) {
            setEntries(prev => [data as AuditLogEntry, ...prev].slice(0, limit))
          }
        }
      )
      .subscribe()

    channelRef.current = channel

    return () => {
      supabase.removeChannel(channel)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- supabase is a module-level singleton
  }, [contactId, limit])

  return { entries, loading, error }
}
