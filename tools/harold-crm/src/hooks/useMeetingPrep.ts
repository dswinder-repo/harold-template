'use client'

import { useState, useCallback, useRef } from 'react'
import type { PrepResult, PrepAPIResponse } from '@/lib/meetingPrep'

export function useMeetingPrep() {
  const [prep, setPrep] = useState<PrepResult | null>(null)
  const [interactionId, setInteractionId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inflightRef = useRef(false)

  const startPrep = useCallback(async (contactId: string) => {
    if (inflightRef.current) return

    inflightRef.current = true
    setLoading(true)
    setError(null)
    setPrep(null)
    setInteractionId(null)

    try {
      const res = await fetch('/api/meeting-prep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId }),
      })

      const data: PrepAPIResponse = await res.json()

      if (data.success) {
        setPrep(data.prep)
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

  const clearPrep = useCallback(() => {
    setPrep(null)
    setInteractionId(null)
    setError(null)
  }, [])

  return {
    prep,
    interactionId,
    loading,
    error,
    startPrep,
    clearPrep,
    isPrepping: loading,
  }
}
