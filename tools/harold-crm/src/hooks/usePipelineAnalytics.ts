'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'

/**
 * Raw row from the stage_changes table. Each row belongs to one pipeline entry
 * (entry_id); rows written before an entry existed fall back to the contact.
 */
interface StageChange {
  id: string
  contact_id: string
  entry_id: string | null
  from_stage: string | null
  to_stage: string
  notes: string | null
  /** Aliased from changed_at in the query below. */
  created_at: string
}

/** Stages that count as "converted": agreed in substance, or a live relationship. */
const CONVERTED_STAGES = ['Committed', 'Active']

/**
 * Computed analytics for a single pipeline stage.
 */
export interface StageAnalytics {
  stageName: string
  count: number
  /** Average days contacts spend in this stage before moving on. */
  avgDaysInStage: number | null
  /** Number of contacts that moved OUT of this stage. */
  exitCount: number
  /** Conversion rate: contacts that moved to the NEXT stage vs total exits. */
  conversionRate: number | null
}

/**
 * Overall pipeline velocity + funnel metrics.
 */
export interface PipelineAnalyticsData {
  /** Per-stage breakdown. */
  stages: StageAnalytics[]
  /** Average days from entering the pipeline to Committed or Active. */
  avgCycleDays: number | null
  /** Pipeline entries that ever entered (with recorded history). */
  totalEntered: number
  /** Entries that reached Committed or Active. */
  totalConverted: number
  /** Overall conversion rate. */
  overallConversion: number | null
  /** Stage changes in the last 30 days (activity indicator). */
  recentMoves: number
}

/** Analytics for the one pipeline, optionally narrowed to one project ('all' or null for everything). */
export function usePipelineAnalytics(project: string | null) {
  const projectFilter = project && project !== 'all' ? project : null
  const [analytics, setAnalytics] = useState<PipelineAnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const supabase = createClient()

  const fetchAnalytics = useCallback(async () => {
    setLoading(true)
    setError(null)

    // Fetch stages, entries and all stage changes in parallel
    let entriesQuery = supabase.from('contact_pipelines').select('id, stage, project, closed_at')
    if (projectFilter) entriesQuery = entriesQuery.eq('project', projectFilter)
    const [stagesRes, entriesRes, changesRes] = await Promise.all([
      supabase
        .from('pipeline_stages')
        .select('stage_name, stage_order')
        .order('stage_order', { ascending: true }),
      entriesQuery,
      supabase
        .from('stage_changes')
        .select('id, contact_id, entry_id, from_stage, to_stage, notes, created_at:changed_at')
        .order('changed_at', { ascending: true }),
    ])

    if (stagesRes.error || entriesRes.error || changesRes.error) {
      setError(stagesRes.error?.message ?? entriesRes.error?.message ?? changesRes.error?.message ?? 'Unknown error')
      setLoading(false)
      return
    }

    const stageRows = (stagesRes.data ?? []) as { stage_name: string; stage_order: number }[]
    const entryRows = (entriesRes.data ?? []) as { id: string; stage: string; closed_at: string | null }[]
    const entryIds = new Set(entryRows.map((e) => e.id))
    const changes = ((changesRes.data ?? []) as StageChange[])
      .filter((c) => !projectFilter || (c.entry_id && entryIds.has(c.entry_id)))

    const stageNames = stageRows.map(s => s.stage_name)
    const stageOrder = Object.fromEntries(stageRows.map(s => [s.stage_name, s.stage_order]))
    const firstStage = stageNames[0] ?? ''

    // ----- Per-stage time-in-stage -----
    // For each pipeline entry, build ordered list of stage transitions
    const byContact = new Map<string, StageChange[]>()
    for (const ch of changes) {
      const key = ch.entry_id ?? `contact:${ch.contact_id}`
      const arr = byContact.get(key) ?? []
      arr.push(ch)
      byContact.set(key, arr)
    }

    // Compute time-in-stage: for each consecutive pair (enter stage N, leave stage N) record the diff
    const stageDurations: Record<string, number[]> = {}
    const stageExits: Record<string, number> = {}
    const stageNextAdvances: Record<string, number> = {} // moved to the NEXT stage (forward)

    for (const name of stageNames) {
      stageDurations[name] = []
      stageExits[name] = 0
      stageNextAdvances[name] = 0
    }

    // Track full-pipeline cycle times (first entry → last stage)
    const cycleDays: number[] = []

    for (const [, contactChanges] of byContact) {
      // Sort by time
      contactChanges.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())

      let firstEntry: Date | null = null

      for (let i = 0; i < contactChanges.length; i++) {
        const ch = contactChanges[i]

        // Track first pipeline entry
        if (ch.to_stage === firstStage && !firstEntry) {
          firstEntry = new Date(ch.created_at)
        }
        // If they entered the first stage from outside, that's also a first entry
        if (ch.from_stage === null && !firstEntry) {
          firstEntry = new Date(ch.created_at)
        }

        // Track reaching a converted stage (first time only)
        if (CONVERTED_STAGES.includes(ch.to_stage) && !contactChanges.slice(0, i).some((p) => CONVERTED_STAGES.includes(p.to_stage))) {
          if (firstEntry) {
            const diff = (new Date(ch.created_at).getTime() - firstEntry.getTime()) / (1000 * 60 * 60 * 24)
            cycleDays.push(diff)
          }
        }

        // Time in from_stage (how long they were there before this move)
        if (ch.from_stage && stageNames.includes(ch.from_stage)) {
          stageExits[ch.from_stage]++

          // Check if this is a forward move to the next stage
          const fromOrder = stageOrder[ch.from_stage] ?? 0
          const toOrder = stageOrder[ch.to_stage] ?? 0
          if (toOrder > fromOrder) {
            stageNextAdvances[ch.from_stage]++
          }

          // Find the previous transition INTO this from_stage to calculate duration
          for (let j = i - 1; j >= 0; j--) {
            if (contactChanges[j].to_stage === ch.from_stage) {
              const entered = new Date(contactChanges[j].created_at)
              const exited = new Date(ch.created_at)
              const days = (exited.getTime() - entered.getTime()) / (1000 * 60 * 60 * 24)
              stageDurations[ch.from_stage].push(days)
              break
            }
          }
        }
      }
    }

    // ----- Current counts per stage (open entries) -----
    const currentCounts: Record<string, number> = {}
    for (const name of stageNames) currentCounts[name] = 0
    for (const e of entryRows) {
      if (!e.closed_at && currentCounts[e.stage] !== undefined) currentCounts[e.stage]++
    }

    // ----- Assemble per-stage analytics -----
    const stageAnalytics: StageAnalytics[] = stageNames.map((name) => {
      const durations = stageDurations[name]
      const avgDays = durations.length > 0
        ? Math.round((durations.reduce((s, d) => s + d, 0) / durations.length) * 10) / 10
        : null
      const exits = stageExits[name]
      const advances = stageNextAdvances[name]
      const rate = exits > 0 ? Math.round((advances / exits) * 100) : null

      return {
        stageName: name,
        count: currentCounts[name] ?? 0,
        avgDaysInStage: avgDays,
        exitCount: exits,
        conversionRate: rate,
      }
    })

    // ----- Overall metrics -----
    const totalEntered = byContact.size
    const totalConverted = [...byContact.values()].filter(
      moves => moves.some(m => CONVERTED_STAGES.includes(m.to_stage))
    ).length
    const overallConversion = totalEntered > 0 ? Math.round((totalConverted / totalEntered) * 100) : null
    const avgCycleDays = cycleDays.length > 0
      ? Math.round((cycleDays.reduce((s, d) => s + d, 0) / cycleDays.length) * 10) / 10
      : null

    // Recent moves (last 30 days)
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
    const recentMoves = changes.filter(c => new Date(c.created_at) >= thirtyDaysAgo).length

    setAnalytics({
      stages: stageAnalytics,
      avgCycleDays,
      totalEntered,
      totalConverted,
      overallConversion,
      recentMoves,
    })
    setLoading(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectFilter])

  useEffect(() => {
    fetchAnalytics()
  }, [fetchAnalytics])

  return { analytics, loading, error, refetch: fetchAnalytics }
}
