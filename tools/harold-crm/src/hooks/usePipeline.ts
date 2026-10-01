'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Contact } from '@/lib/types'

/**
 * One pipeline.
 *
 * There is no pipeline per contact type. A person is in the pipeline for a PURPOSE:
 * "raising the seed round", "distribution partner for the launch", "advisor for
 * the board". Each purpose is its own entry, so one person can be in play twice,
 * and the board shows entries rather than contacts.
 *
 * `contact_pipelines` is the only place pipeline state lives.
 */

export interface PipelineStage {
  stage_name: string
  stage_order: number
  description: string
  default_cadence: string
}

/** A card on the board: one reason one person is in the pipeline. */
export interface PipelineEntry {
  id: string
  contact_id: string
  stage: string
  purpose: string
  project: string | null
  entered_at: string
  outcome: string | null
  closed_at: string | null
  contact: Contact | null
}

interface UsePipelineOptions {
  /** Optional project name, to narrow the board to entries for one project. */
  project?: string | null
}

export function usePipeline({ project }: UsePipelineOptions = {}) {
  const supabase = createClient()
  const [entries, setEntries] = useState<PipelineEntry[]>([])
  const [stages, setStages] = useState<PipelineStage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)

    let entryQuery = supabase
      .from('contact_pipelines')
      .select('id, contact_id, stage, purpose, project, entered_at, outcome, closed_at, contacts (*)')
      .is('closed_at', null)
    if (project) entryQuery = entryQuery.eq('project', project)

    const [stagesResult, entriesResult] = await Promise.all([
      supabase
        .from('pipeline_stages')
        .select('*')
        .order('stage_order', { ascending: true }),
      entryQuery,
    ])

    if (stagesResult.error) {
      setError(stagesResult.error.message)
      setLoading(false)
      return
    }
    if (entriesResult.error) {
      setError(entriesResult.error.message)
      setLoading(false)
      return
    }

    setStages((stagesResult.data ?? []) as PipelineStage[])
    setEntries(
      ((entriesResult.data ?? []) as unknown as Array<Record<string, unknown>>).map((row) => ({
        id: row.id as string,
        contact_id: row.contact_id as string,
        stage: row.stage as string,
        purpose: (row.purpose as string) ?? '',
        project: (row.project as string) ?? null,
        entered_at: row.entered_at as string,
        outcome: (row.outcome as string) ?? null,
        closed_at: (row.closed_at as string) ?? null,
        contact: (row.contacts as Contact) ?? null,
      }))
    )
    setLoading(false)
  }, [project]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchData()

    const channel = supabase
      .channel('pipeline-entries')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'contact_pipelines' },
        () => { fetchData() }
      )
      .subscribe()

    channelRef.current = channel
    return () => { supabase.removeChannel(channel) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project])

  /** Move one entry to a new stage, and record the move in stage_changes. */
  const advanceStage = async (entryOrContactId: string, newStage: string, userId?: string) => {
    // Accepts an entry id, or a contact id when that contact has one open entry.
    const entry =
      entries.find((e) => e.id === entryOrContactId) ??
      (entries.filter((e) => e.contact_id === entryOrContactId).length === 1
        ? entries.find((e) => e.contact_id === entryOrContactId)
        : undefined)
    if (!entry) return { error: 'Pipeline entry not found (or this person has more than one: move the card itself)' }
    const entryId = entry.id

    const fromStage = entry.stage
    const now = new Date().toISOString()

    const { error: updateError } = await supabase
      .from('contact_pipelines')
      .update({ stage: newStage, entered_at: now })
      .eq('id', entryId)
    if (updateError) return { error: updateError.message }

    await supabase.from('stage_changes').insert({
      contact_id: entry.contact_id,
      entry_id: entryId,
      from_stage: fromStage,
      to_stage: newStage,
      changed_by: userId ?? null,
      notes: `${fromStage} → ${newStage}`,
    })

    setEntries((prev) => prev.map((e) => (e.id === entryId ? { ...e, stage: newStage, entered_at: now } : e)))
    return { error: null }
  }

  /** Put someone in the pipeline. A purpose is required: an entry without a reason is noise. */
  const addEntry = async (contactId: string, purpose: string, stage = 'Identified', entryProject?: string | null, userId?: string) => {
    if (!purpose.trim()) return { error: 'Say why this person is in the pipeline' }
    const { data, error: insertError } = await supabase
      .from('contact_pipelines')
      .insert({ contact_id: contactId, purpose: purpose.trim(), stage, project: entryProject ?? null })
      .select('id')
      .single()
    if (insertError) return { error: insertError.message }

    await supabase.from('stage_changes').insert({
      contact_id: contactId,
      entry_id: (data as { id: string }).id,
      from_stage: null,
      to_stage: stage,
      changed_by: userId ?? null,
      notes: purpose.trim(),
    })
    await fetchData()
    return { error: null }
  }

  /** Close an entry. The record stays; it leaves the open board. */
  const closeEntry = async (entryId: string, outcome: string) => {
    const { error: closeError } = await supabase
      .from('contact_pipelines')
      .update({ closed_at: new Date().toISOString(), outcome })
      .eq('id', entryId)
    if (closeError) return { error: closeError.message }
    setEntries((prev) => prev.filter((e) => e.id !== entryId))
    return { error: null }
  }

  const entriesByStage: Record<string, PipelineEntry[]> = {}
  for (const stage of stages) {
    entriesByStage[stage.stage_name] = entries.filter((e) => e.stage === stage.stage_name)
  }

  const totalEntries = entries.length
  const activeEntries = entries.filter((e) => e.stage !== 'Dormant').length

  const warmthCounts: Record<string, number> = {}
  for (const e of entries) {
    const w = e.contact?.warmth || 'Unknown'
    warmthCounts[w] = (warmthCounts[w] || 0) + 1
  }

  const projectCounts: Record<string, number> = {}
  for (const e of entries) {
    const p = e.project || '(no project)'
    projectCounts[p] = (projectCounts[p] || 0) + 1
  }

  const stageConversions: Record<string, { count: number; percentage: number }> = {}
  for (const stage of stages) {
    const stageCount = entriesByStage[stage.stage_name]?.length ?? 0
    stageConversions[stage.stage_name] = {
      count: stageCount,
      percentage: totalEntries > 0 ? Math.round((stageCount / totalEntries) * 100) : 0,
    }
  }

  // Each entry as a contact-shaped card: the contact, plus this entry's purpose,
  // stage, time in stage and entry id (used as the drag id).
  const contacts = entries
    .map((e) => (e.contact ? { ...e.contact, pipeline_stage: e.stage, pipeline: e.purpose, stage_entered_at: e.entered_at, pipeline_entry_id: e.id } : null))
    .filter(Boolean) as Contact[]
  const contactsByStage: Record<string, Contact[]> = {}
  for (const stage of stages) {
    contactsByStage[stage.stage_name] = (entriesByStage[stage.stage_name] ?? [])
      .map((e) => (e.contact ? { ...e.contact, pipeline_stage: e.stage, pipeline: e.purpose, stage_entered_at: e.entered_at, pipeline_entry_id: e.id } : null))
      .filter(Boolean) as Contact[]
  }

  return {
    entries,
    entriesByStage,
    stages,
    loading,
    error,
    advanceStage,
    addEntry,
    closeEntry,
    refetch: fetchData,
    contacts,
    contactsByStage,
    stats: {
      totalContacts: totalEntries,
      totalEntries,
      activeContacts: activeEntries,
      warmthCounts,
      projectCounts,
      stageConversions,
    },
  }
}
