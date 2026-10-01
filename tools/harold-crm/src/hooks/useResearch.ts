'use client'

import { useState, useCallback, useRef } from 'react'
import type { Contact } from '@/lib/types'
import type { ResearchResult, ResearchAPIResponse } from '@/lib/research'

export function useResearch() {
  const [research, setResearch] = useState<ResearchResult | null>(null)
  const [interactionId, setInteractionId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inflightRef = useRef(false)

  const startResearch = useCallback(async (contact: Contact, category: string) => {
    if (inflightRef.current) return

    inflightRef.current = true
    setLoading(true)
    setError(null)
    setResearch(null)
    setInteractionId(null)

    try {
      const res = await fetch('/api/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contactId: contact.id,
          contactName: contact.name,
          org: contact.org,
          category,
        }),
      })

      const data: ResearchAPIResponse = await res.json()

      if (data.success) {
        setResearch(data.research)
        setInteractionId(data.interactionId)
      } else {
        setError(data.error)
      }
    } catch {
      setError('Failed to connect. Please try again.')
    } finally {
      setLoading(false)
      inflightRef.current = false
    }
  }, [])

  const clearResearch = useCallback(() => {
    setResearch(null)
    setInteractionId(null)
    setError(null)
  }, [])

  return {
    research,
    interactionId,
    loading,
    error,
    startResearch,
    clearResearch,
    isResearching: loading,
  }
}
