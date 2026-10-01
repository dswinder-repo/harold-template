'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { PIPELINE_STAGE_ORDER } from '@/lib/types'
import { formatRelativeTime } from '@/lib/utils'
import { useToast } from '@/hooks/useToast'
import type { PipelineEntryRow } from '@/lib/pipeline'

/**
 * A contact's place in the one pipeline.
 *
 * Every entry states a purpose: why this person is in the pipeline ("raising the
 * seed round", "distribution partner for the launch"). The same person can hold
 * several entries for different reasons, each with its own stage. Nothing is put
 * in the pipeline automatically; an entry exists because you said why.
 */
export default function ContactPipelineEntries({
  contactId,
  userId,
}: {
  contactId: string
  userId?: string
}) {
  const supabase = createClient()
  const { toast } = useToast()
  const [entries, setEntries] = useState<PipelineEntryRow[]>([])
  const [stages, setStages] = useState<string[]>([...PIPELINE_STAGE_ORDER])
  const [showClosed, setShowClosed] = useState(false)
  const [adding, setAdding] = useState(false)
  const [purpose, setPurpose] = useState('')
  const [project, setProject] = useState('')

  const fetchEntries = useCallback(async () => {
    const [{ data: rows }, { data: stageRows }] = await Promise.all([
      supabase
        .from('contact_pipelines')
        .select('id, contact_id, stage, purpose, project, entered_at, outcome, closed_at')
        .eq('contact_id', contactId)
        .order('entered_at', { ascending: false }),
      supabase.from('pipeline_stages').select('stage_name, stage_order').order('stage_order', { ascending: true }),
    ])
    setEntries((rows ?? []) as PipelineEntryRow[])
    if (stageRows?.length) setStages((stageRows as { stage_name: string }[]).map((s) => s.stage_name))
  // eslint-disable-next-line react-hooks/exhaustive-deps -- supabase is a module-level singleton
  }, [contactId])

  useEffect(() => {
    fetchEntries()
    const channel = supabase
      .channel(`contact-pipelines-${contactId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'contact_pipelines', filter: `contact_id=eq.${contactId}` },
        () => { fetchEntries() }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- supabase is a module-level singleton
  }, [contactId, fetchEntries])

  const addEntry = async () => {
    const p = purpose.trim()
    if (!p) {
      toast({ title: 'Say why this person is in the pipeline', type: 'warning' })
      return
    }
    const stage = stages[0] ?? 'Identified'
    const { data, error } = await supabase
      .from('contact_pipelines')
      .insert({ contact_id: contactId, purpose: p, stage, project: project.trim() || null })
      .select('id')
      .single()
    if (error) {
      toast({ title: `Could not add to pipeline: ${error.message}`, type: 'error' })
      return
    }
    await supabase.from('stage_changes').insert({
      contact_id: contactId,
      entry_id: (data as { id: string }).id,
      from_stage: null,
      to_stage: stage,
      changed_by: userId ?? null,
      notes: p,
    })
    setPurpose('')
    setProject('')
    setAdding(false)
    toast({ title: 'Added to the pipeline', type: 'success' })
    fetchEntries()
  }

  const moveEntry = async (entry: PipelineEntryRow, stage: string) => {
    if (stage === entry.stage) return
    const now = new Date().toISOString()
    setEntries((prev) => prev.map((e) => (e.id === entry.id ? { ...e, stage, entered_at: now } : e)))
    const { error } = await supabase
      .from('contact_pipelines')
      .update({ stage, entered_at: now })
      .eq('id', entry.id)
    if (error) {
      toast({ title: 'Failed to move the entry', type: 'error' })
      fetchEntries()
      return
    }
    await supabase.from('stage_changes').insert({
      contact_id: contactId,
      entry_id: entry.id,
      from_stage: entry.stage,
      to_stage: stage,
      changed_by: userId ?? null,
      notes: `${entry.stage} → ${stage}`,
    })
  }

  const closeEntry = async (entry: PipelineEntryRow) => {
    const outcome = window.prompt(`Close "${entry.purpose}". How did it end?`, '')
    if (outcome === null) return
    const { error } = await supabase
      .from('contact_pipelines')
      .update({ closed_at: new Date().toISOString(), outcome: outcome.trim() })
      .eq('id', entry.id)
    if (error) toast({ title: 'Failed to close the entry', type: 'error' })
    fetchEntries()
  }

  const open = entries.filter((e) => !e.closed_at)
  const closed = entries.filter((e) => e.closed_at)

  return (
    <div className="mt-6 border-t pt-4" style={{ borderColor: 'var(--border-subtle)' }}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
          Pipeline
        </h2>
        {!adding && (
          <button
            onClick={() => setAdding(true)}
            className="rounded-md px-3 py-1 text-xs transition-colors"
            style={{ background: 'var(--hover-light)', color: 'var(--text-primary)', border: 'none', cursor: 'pointer' }}
          >
            + Add to pipeline
          </button>
        )}
      </div>

      {adding && (
        <div className="mb-3 flex flex-col gap-2 rounded-md p-3 sm:flex-row" style={{ background: 'var(--hover-faint)' }}>
          <input
            autoFocus
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addEntry() }}
            placeholder="Purpose (required): why is this person in the pipeline?"
            className="flex-1 rounded-md px-3 py-1.5 text-sm outline-none"
            style={{ background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border-input)' }}
          />
          <input
            value={project}
            onChange={(e) => setProject(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addEntry() }}
            placeholder="Project (optional)"
            className="rounded-md px-3 py-1.5 text-sm outline-none sm:w-40"
            style={{ background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border-input)' }}
          />
          <div className="flex gap-2">
            <button
              onClick={addEntry}
              className="rounded-md px-3 py-1.5 text-xs font-medium"
              style={{ background: 'var(--accent)', color: '#fff', border: 'none', cursor: 'pointer' }}
            >
              Add
            </button>
            <button
              onClick={() => { setAdding(false); setPurpose(''); setProject('') }}
              className="rounded-md px-3 py-1.5 text-xs"
              style={{ background: 'var(--hover-light)', color: 'var(--text-primary)', border: 'none', cursor: 'pointer' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {open.length === 0 && !adding && (
        <p className="text-xs italic" style={{ color: 'var(--text-faint)' }}>
          Not in the pipeline. Add an entry when a conversation gives this person a purpose there.
        </p>
      )}

      <div className="flex flex-col gap-2">
        {open.map((entry) => (
          <div
            key={entry.id}
            className="flex flex-col gap-2 rounded-md p-3 sm:flex-row sm:items-center"
            style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-subtle)' }}
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{entry.purpose}</p>
              <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
                {entry.project ? `${entry.project} · ` : ''}in {entry.stage} {formatRelativeTime(entry.entered_at)}
              </p>
            </div>
            <select
              value={entry.stage}
              onChange={(e) => moveEntry(entry, e.target.value)}
              className="rounded-md px-2 py-1 text-xs outline-none"
              style={{ background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border-input)' }}
            >
              {stages.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <button
              onClick={() => closeEntry(entry)}
              className="rounded-md px-2 py-1 text-xs"
              style={{ background: 'transparent', color: 'var(--text-faint)', border: '1px solid var(--hover-light)', cursor: 'pointer' }}
              title="Close this entry. The record stays."
            >
              Close
            </button>
          </div>
        ))}
      </div>

      {closed.length > 0 && (
        <div className="mt-2">
          <button
            onClick={() => setShowClosed((v) => !v)}
            className="text-xs"
            style={{ color: 'var(--text-faint)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            {showClosed ? '▾' : '▸'} {closed.length} closed {closed.length === 1 ? 'entry' : 'entries'}
          </button>
          {showClosed && (
            <ul className="mt-1 space-y-1">
              {closed.map((e) => (
                <li key={e.id} className="text-xs" style={{ color: 'var(--text-faint)' }}>
                  {e.purpose}: {e.outcome || 'closed'} ({formatRelativeTime(e.closed_at!)})
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
