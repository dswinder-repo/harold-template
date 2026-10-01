'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Interaction, InteractionType, InteractionAttachment } from '@/lib/types'

interface UseInteractionsOptions {
  contactId: string
  limit?: number
}

export function useInteractions({ contactId, limit = 50 }: UseInteractionsOptions) {
  const supabase = createClient()
  const [interactions, setInteractions] = useState<Interaction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  const fetchInteractions = useCallback(async () => {
    setLoading(true)
    setError(null)

    const { data, error: fetchError } = await supabase
      .from('interactions')
      .select(`
        *,
        profiles:user_id ( id, full_name, email, avatar_url )
      `)
      .eq('contact_id', contactId)
      .order('occurred_at', { ascending: false })
      .limit(limit)

    if (fetchError) {
      setError(fetchError.message)
      setInteractions([])
    } else {
      setInteractions((data ?? []) as Interaction[])
    }
    setLoading(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- supabase is a module-level singleton
  }, [contactId, limit])

  // Initial fetch
  useEffect(() => {
    fetchInteractions()
  }, [fetchInteractions])

  // Realtime subscription
  useEffect(() => {
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current)
    }

    const channel = supabase
      .channel(`interactions-${contactId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'interactions',
          filter: `contact_id=eq.${contactId}`,
        },
        async (payload: { eventType: string; new: Record<string, unknown>; old: Record<string, unknown> }) => {
          if (payload.eventType === 'DELETE') {
            setInteractions((prev) =>
              prev.filter((i) => i.id !== (payload.old as unknown as { id: string }).id)
            )
            return
          }

          // For INSERT or UPDATE, fetch the full entry with joins
          const { data } = await supabase
            .from('interactions')
            .select(`
              *,
              profiles:user_id ( id, full_name, email, avatar_url )
            `)
            .eq('id', (payload.new as unknown as { id: string }).id)
            .single()

          if (data) {
            if (payload.eventType === 'INSERT') {
              setInteractions((prev) =>
                [data as Interaction, ...prev].slice(0, limit)
              )
            } else {
              setInteractions((prev) =>
                prev.map((i) => (i.id === data.id ? (data as Interaction) : i))
              )
            }
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

  // Create a new interaction
  const createInteraction = async (input: {
    type: InteractionType
    subject: string
    body: string
    occurredAt?: string
    userId?: string
    attachments?: InteractionAttachment[]
  }) => {
    const { data, error } = await supabase
      .from('interactions')
      .insert({
        contact_id: contactId,
        user_id: input.userId ?? null,
        type: input.type,
        subject: input.subject,
        body: input.body,
        occurred_at: input.occurredAt ?? new Date().toISOString(),
        attachments: input.attachments ?? [],
      })
      .select(`
        *,
        profiles:user_id ( id, full_name, email, avatar_url )
      `)
      .single()

    if (error) return { error }
    return { data: data as Interaction }
  }

  // Update an interaction
  const updateInteraction = async (
    id: string,
    updates: {
      type?: InteractionType
      subject?: string
      body?: string
      occurredAt?: string
      attachments?: InteractionAttachment[]
    }
  ) => {
    const patch: Record<string, unknown> = {}
    if (updates.type !== undefined) patch.type = updates.type
    if (updates.subject !== undefined) patch.subject = updates.subject
    if (updates.body !== undefined) patch.body = updates.body
    if (updates.occurredAt !== undefined) patch.occurred_at = updates.occurredAt
    if (updates.attachments !== undefined) patch.attachments = updates.attachments

    // Optimistic update
    const snapshot = interactions.find((i) => i.id === id)
    setInteractions((prev) =>
      prev.map((i) =>
        i.id === id
          ? {
              ...i,
              ...(updates.type !== undefined && { type: updates.type }),
              ...(updates.subject !== undefined && { subject: updates.subject }),
              ...(updates.body !== undefined && { body: updates.body }),
              ...(updates.occurredAt !== undefined && { occurred_at: updates.occurredAt }),
              ...(updates.attachments !== undefined && { attachments: updates.attachments }),
            }
          : i
      )
    )

    const { error } = await supabase
      .from('interactions')
      .update(patch)
      .eq('id', id)

    if (error && snapshot) {
      // Rollback
      setInteractions((prev) => prev.map((i) => (i.id === id ? snapshot : i)))
    }

    return { error }
  }

  // Delete an interaction
  const deleteInteraction = async (id: string) => {
    const { error } = await supabase
      .from('interactions')
      .delete()
      .eq('id', id)

    if (!error) {
      setInteractions((prev) => prev.filter((i) => i.id !== id))
    }
    return { error }
  }

  return {
    interactions,
    loading,
    error,
    createInteraction,
    updateInteraction,
    deleteInteraction,
    refetch: fetchInteractions,
  }
}
