'use client'

import { useState } from 'react'
import AuthGuard from '@/components/AuthGuard'
import Header from '@/components/Header'
import ActivityFeed from '@/components/ActivityFeed'
import { useAuditLog } from '@/hooks/useAuditLog'
import type { ActionType } from '@/lib/types'

const ACTION_LABELS: Record<string, string> = {
  all: 'All Actions',
  create: 'Created',
  update: 'Updated',
  delete: 'Deleted',
  status_change: 'Status Change',
  note_added: 'Note Added',
}

export default function ActivityClient() {
  const { entries, loading } = useAuditLog({ limit: 100 })
  const [actionFilter, setActionFilter] = useState<ActionType | 'all'>('all')

  const filteredEntries = actionFilter === 'all'
    ? entries
    : entries.filter((e) => e.action === actionFilter)

  return (
    <AuthGuard>
      <div className="min-h-screen">
        <Header />

        <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-gradient">
                Activity Feed
              </h1>
              <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
                All changes across the CRM
              </p>
            </div>

            <select
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value as ActionType | 'all')}
              className="rounded-md px-3 py-2 text-sm outline-none"
              style={{
                background: 'var(--bg-card)',
                color: 'var(--text-primary)',
                border: '1px solid var(--hover-light)',
              }}
            >
              {Object.entries(ACTION_LABELS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>

          <ActivityFeed entries={filteredEntries} loading={loading} showContactLink />
        </main>
      </div>
    </AuthGuard>
  )
}
