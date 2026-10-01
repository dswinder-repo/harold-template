import { useState, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Contact } from '@/lib/types'
import type { SuggestedUpdate } from '@/lib/research'

export interface EnrichProgress {
  done: number
  total: number
  current: string
}

export interface EnrichResult {
  contactId: string
  contactName: string
  applied: SuggestedUpdate[]
  needsReview: SuggestedUpdate[]
}

export function useEnrichment() {
  const [enriching, setEnriching] = useState(false)
  const [progress, setProgress] = useState<EnrichProgress>({ done: 0, total: 0, current: '' })
  const [results, setResults] = useState<EnrichResult[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const cancelRef = useRef(false)

  const cancel = useCallback(() => {
    cancelRef.current = true
  }, [])

  const startBulkEnrich = useCallback(
    async (contacts: Contact[], fields: string[], userId: string) => {
      cancelRef.current = false
      setEnriching(true)
      setResults([])
      setErrors([])
      setProgress({ done: 0, total: contacts.length, current: '' })

      const supabase = createClient()

      for (let i = 0; i < contacts.length; i++) {
        if (cancelRef.current) break

        const contact = contacts[i]
        setProgress({ done: i, total: contacts.length, current: contact.name })

        try {
          const res = await fetch('/api/enrich', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contactId: contact.id,
              name: contact.name,
              org: contact.org || '',
              category: contact.category,
              missingFields: fields.filter((f) => !contact[f as keyof Contact]),
            }),
          })

          if (!res.ok) {
            const errData = await res.json().catch(() => ({ error: 'Unknown error' }))
            if (res.status === 429) {
              // Rate limit — wait 5s and retry once
              await sleep(5000)
              if (cancelRef.current) break
              const retry = await fetch('/api/enrich', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  contactId: contact.id,
                  name: contact.name,
                  org: contact.org || '',
                  category: contact.category,
                  missingFields: fields.filter((f) => !contact[f as keyof Contact]),
                }),
              })
              if (!retry.ok) {
                setErrors((prev) => [...prev, `${contact.name}: rate limited`])
                continue
              }
              const retryData = await retry.json()
              await processResult(retryData, contact, supabase, userId)
            } else {
              setErrors((prev) => [...prev, `${contact.name}: ${errData.error}`])
            }
            continue
          }

          const data = await res.json()
          await processResult(data, contact, supabase, userId)
        } catch (err) {
          setErrors((prev) => [...prev, `${contact.name}: ${err instanceof Error ? err.message : 'Failed'}`])
        }

        // Throttle: 1.5s between requests to stay within Gemini rate limits
        if (i < contacts.length - 1 && !cancelRef.current) {
          await sleep(1500)
        }
      }

      setProgress((prev) => ({ ...prev, done: contacts.length, current: '' }))
      setEnriching(false)
    },
    []
  )

  async function processResult(
    data: { success: boolean; suggestions?: SuggestedUpdate[] },
    contact: Contact,
    supabase: ReturnType<typeof createClient>,
    userId: string
  ) {
    if (!data.success || !data.suggestions || data.suggestions.length === 0) return

    const highConfidence = data.suggestions.filter((s) => s.confidence === 'high')
    const needsReview = data.suggestions.filter((s) => s.confidence !== 'high')

    // Auto-apply high confidence updates
    if (highConfidence.length > 0) {
      const updates: Record<string, string> = {}
      for (const s of highConfidence) {
        updates[s.field] = s.suggestedValue
      }
      updates.updated_by = userId

      await supabase.from('contacts').update(updates).eq('id', contact.id)
    }

    setResults((prev) => [
      ...prev,
      {
        contactId: contact.id,
        contactName: contact.name,
        applied: highConfidence,
        needsReview,
      },
    ])
  }

  const applyUpdate = useCallback(
    async (contactId: string, field: string, value: string, userId: string) => {
      const supabase = createClient()
      await supabase
        .from('contacts')
        .update({ [field]: value, updated_by: userId })
        .eq('id', contactId)

      // Move from needsReview to applied in results
      setResults((prev) =>
        prev.map((r) => {
          if (r.contactId !== contactId) return r
          const updated = r.needsReview.find((s) => s.field === field)
          if (!updated) return r
          return {
            ...r,
            applied: [...r.applied, updated],
            needsReview: r.needsReview.filter((s) => s.field !== field),
          }
        })
      )
    },
    []
  )

  const dismissUpdate = useCallback((contactId: string, field: string) => {
    setResults((prev) =>
      prev.map((r) => {
        if (r.contactId !== contactId) return r
        return {
          ...r,
          needsReview: r.needsReview.filter((s) => s.field !== field),
        }
      })
    )
  }, [])

  return {
    enriching,
    progress,
    results,
    errors,
    startBulkEnrich,
    cancel,
    applyUpdate,
    dismissUpdate,
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
