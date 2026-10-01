'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useEnumOptions } from '@/hooks/useEnumOptions'

/**
 * Shows a contact's labels and lets you add or remove them.
 *
 * Labels are free text: anything worth tagging someone with at a glance (a board
 * seat, a government body, a region). Suggestions come from the label list in
 * Settings plus every label already in use. The contact's type is never offered
 * as a label.
 */
export default function LabelPicker({
  labels,
  type,
  onToggle,
  colorFor,
}: {
  labels: string[]
  type: string
  onToggle: (label: string) => Promise<unknown>
  colorFor: (label: string) => string
}) {
  const { getOptionsRaw } = useEnumOptions()
  const [inUse, setInUse] = useState<string[]>([])
  const [adding, setAdding] = useState(false)
  const [value, setValue] = useState('')

  useEffect(() => {
    if (!adding) return
    let cancelled = false
    createClient()
      .from('contact_categories')
      .select('category_name')
      .then(({ data }: { data: { category_name: string }[] | null }) => {
        if (!cancelled) setInUse([...new Set((data ?? []).map((r) => r.category_name))])
      })
    return () => { cancelled = true }
  }, [adding])

  const suggestions = useMemo(() => {
    const listed = getOptionsRaw('label').map((o) => o.value)
    return [...new Set([...listed, ...inUse])]
      .filter((l) => l !== type && !labels.includes(l))
      .sort((a, b) => a.localeCompare(b))
  }, [getOptionsRaw, inUse, labels, type])

  const submit = async () => {
    const label = value.trim().toLowerCase()
    setValue('')
    setAdding(false)
    if (!label || label === type || labels.includes(label)) return
    await onToggle(label)
  }

  const visible = labels.filter((l) => l !== type)

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {visible.map((label) => {
        const color = colorFor(label)
        return (
          <button
            key={label}
            onClick={() => onToggle(label)}
            title="Click to remove"
            className="rounded-full px-2.5 py-1 text-xs font-medium transition-all"
            style={{ background: 'transparent', color, border: `1px solid ${color}80`, cursor: 'pointer' }}
          >
            {label} ×
          </button>
        )
      })}
      {visible.length === 0 && !adding && (
        <span className="text-xs" style={{ color: 'var(--text-faint)' }}>None</span>
      )}
      {adding ? (
        <>
          <input
            autoFocus
            list="label-suggestions"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); submit() }
              if (e.key === 'Escape') { setValue(''); setAdding(false) }
            }}
            onBlur={submit}
            placeholder="label"
            className="w-32 rounded-full px-2.5 py-1 text-xs outline-none"
            style={{ background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border-input)' }}
          />
          <datalist id="label-suggestions">
            {suggestions.map((s) => <option key={s} value={s} />)}
          </datalist>
        </>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="rounded-full px-2.5 py-1 text-xs transition-colors"
          style={{ background: 'var(--hover-faint)', color: 'var(--text-secondary)', border: '1px dashed var(--hover-strong)', cursor: 'pointer' }}
        >
          + label
        </button>
      )}
    </div>
  )
}
