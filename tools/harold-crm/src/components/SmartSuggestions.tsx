'use client'

import { useState, useMemo } from 'react'
import type { Contact, Interaction, Task } from '@/lib/types'
import { getSuggestions, type SuggestionRule } from '@/lib/suggestionRules'

interface SmartSuggestionsProps {
  contact: Contact
  interactions: Interaction[]
  tasks: Task[]
  categories: string[]
  /** Optional callback when an action button is clicked */
  onAction?: (ruleId: string) => void
}

export default function SmartSuggestions({
  contact,
  interactions,
  tasks,
  categories,
  onAction,
}: SmartSuggestionsProps) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())

  const suggestions = useMemo(() => {
    const ctx = { contact, interactions, tasks, categories }
    return getSuggestions(ctx, 5) // get top 5, we'll filter dismissed
  }, [contact, interactions, tasks, categories])

  const visible = suggestions.filter((s) => !dismissed.has(s.id)).slice(0, 3)

  if (visible.length === 0) return null

  const handleDismiss = (id: string) => {
    setDismissed((prev) => new Set(prev).add(id))
  }

  return (
    <div
      className="mt-4 rounded-lg border-t pt-4"
      style={{ borderColor: 'var(--border-subtle)' }}
    >
      <h3
        className="mb-3 text-xs font-semibold uppercase tracking-wider"
        style={{ color: 'var(--text-secondary)' }}
      >
        💡 Suggested Next Steps
      </h3>
      <div className="flex flex-col gap-2">
        {visible.map((rule) => (
          <SuggestionCard
            key={rule.id}
            rule={rule}
            onDismiss={() => handleDismiss(rule.id)}
            onAction={() => onAction?.(rule.id)}
          />
        ))}
      </div>
    </div>
  )
}

function SuggestionCard({
  rule,
  onDismiss,
  onAction,
}: {
  rule: SuggestionRule
  onDismiss: () => void
  onAction?: () => void
}) {
  return (
    <div
      className="flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors"
      style={{
        background: 'var(--hover-subtle)',
        border: '1px solid var(--border-subtle)',
      }}
    >
      <span className="mt-0.5 flex-shrink-0 text-base">{rule.icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
          {rule.suggestion}
        </p>
        {rule.action && onAction && (
          <button
            onClick={onAction}
            className="mt-1 rounded px-2 py-0.5 text-xs font-medium transition-colors"
            style={{
              background: 'rgba(76,114,176,0.15)',
              color: 'var(--accent)',
              border: 'none',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(76,114,176,0.25)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(76,114,176,0.15)')}
          >
            {rule.action}
          </button>
        )}
      </div>
      <button
        onClick={onDismiss}
        className="flex-shrink-0 rounded-full p-0.5 text-xs transition-opacity"
        style={{
          background: 'transparent',
          color: 'var(--text-faint)',
          border: 'none',
          cursor: 'pointer',
          opacity: 0.6,
        }}
        onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
        onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.6')}
        title="Dismiss suggestion"
      >
        ✕
      </button>
    </div>
  )
}
