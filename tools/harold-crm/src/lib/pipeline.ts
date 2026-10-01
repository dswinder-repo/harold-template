import type { Contact } from '@/lib/types'
import { PIPELINE_STAGE_ORDER } from '@/lib/types'

/**
 * One pipeline, purpose-bound entries.
 *
 * A contact is in the pipeline only through rows in `contact_pipelines`, and
 * each row says why (its purpose). One person can hold several entries for
 * different reasons, each at its own stage.
 *
 * Many screens only need a one-line answer to "where is this person in the
 * pipeline?". This module derives that from the contact's OPEN entries: the
 * furthest-advanced one wins. Nothing here is stored on the contact.
 */

export interface PipelineEntryRow {
  id: string
  contact_id?: string
  stage: string
  purpose: string
  project?: string | null
  entered_at: string
  outcome?: string | null
  closed_at: string | null
}

/** The select fragment that embeds a contact's pipeline entries. */
export const PIPELINE_EMBED = 'contact_pipelines(id, stage, purpose, project, entered_at, closed_at)'

export function stageRank(stage: string | null | undefined): number {
  const i = PIPELINE_STAGE_ORDER.indexOf((stage ?? '') as (typeof PIPELINE_STAGE_ORDER)[number])
  return i === -1 ? PIPELINE_STAGE_ORDER.length : i
}

/** The furthest-advanced open entry, ignoring Dormant unless that is all there is. */
export function leadingEntry(entries: PipelineEntryRow[] | null | undefined): PipelineEntryRow | null {
  const open = (entries ?? []).filter((e) => !e.closed_at)
  if (!open.length) return null
  const live = open.filter((e) => e.stage !== 'Dormant')
  const pool = live.length ? live : open
  return [...pool].sort((a, b) => stageRank(b.stage) - stageRank(a.stage))[0]
}

/** Attach pipeline / pipeline_stage / stage_entered_at to a contact row from its embedded entries. */
export function withPipelineSummary<T extends Partial<Contact> & { contact_pipelines?: PipelineEntryRow[] | null }>(
  row: T
): T {
  const lead = leadingEntry(row.contact_pipelines)
  return {
    ...row,
    pipeline: lead?.purpose ?? null,
    pipeline_stage: lead?.stage ?? null,
    stage_entered_at: lead?.entered_at ?? null,
    pipeline_entry_id: lead?.id ?? null,
  }
}
