'use client'

import { useState, useMemo, useRef, useCallback } from 'react'
import { DragDropContext, type DropResult } from '@hello-pangea/dnd'
import AuthGuard from '@/components/AuthGuard'
import Header from '@/components/Header'
import PipelineColumn from '@/components/PipelineColumn'
import PipelineAnalyticsPanel from '@/components/PipelineAnalyticsPanel'
import ContactSidebar from '@/components/ContactSidebar'
import { usePipeline } from '@/hooks/usePipeline'
import { useAuth } from '@/hooks/useAuth'
import type { Contact } from '@/lib/types'

const WARMTH_COLORS: Record<string, string> = {
  Hot: '#C44E52',
  Warm: '#DD8452',
  Lukewarm: '#ffc107',
  Cold: '#8da0cb',
}

export default function PipelineClient() {
  const { profile } = useAuth()

  // There is one pipeline. Every card is one entry: one person, one stated purpose.
  // The tabs narrow the board to a project when entries carry one.
  const [activeProject, setActiveProject] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [warmthFilter, setWarmthFilter] = useState('')
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null)
  // Feature 14: track which column header is currently celebrating
  const [celebratingColumn, setCelebratingColumn] = useState<string | null>(null)
  const celebrateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { stages, contactsByStage, loading, error, advanceStage, stats } =
    usePipeline({ project: activeProject === 'all' ? null : activeProject })

  const pipelineOptions = useMemo(() => {
    const projects = Object.keys(stats.projectCounts ?? {})
      .filter((p) => p !== '(no project)')
      .sort()
    return [
      { value: 'all', label: `All (${stats.totalEntries ?? 0})` },
      ...projects.map((p) => ({ value: p, label: `${p} (${stats.projectCounts[p]})` })),
    ]
  }, [stats.projectCounts, stats.totalEntries])

  // Apply filters
  const filteredByStage = useMemo(() => {
    const filtered: Record<string, Contact[]> = {}
    for (const stage of stages) {
      let stageContacts = contactsByStage[stage.stage_name] ?? []

      if (search.trim()) {
        const q = search.toLowerCase()
        stageContacts = stageContacts.filter(
          (c) =>
            c.name.toLowerCase().includes(q) ||
            c.org.toLowerCase().includes(q) ||
            (c.pipeline ?? '').toLowerCase().includes(q) ||
            (c.investor_type ?? '').toLowerCase().includes(q)
        )
      }

      if (warmthFilter) {
        stageContacts = stageContacts.filter((c) => c.warmth === warmthFilter)
      }

      filtered[stage.stage_name] = stageContacts
    }
    return filtered
  }, [stages, contactsByStage, search, warmthFilter])

  const filteredTotal = Object.values(filteredByStage).reduce((sum, arr) => sum + arr.length, 0)

  // Feature 14: trigger a celebration flash on the destination column header
  const triggerCelebration = useCallback((stageName: string) => {
    // Clear any in-flight timer so rapid moves don't stack
    if (celebrateTimerRef.current) clearTimeout(celebrateTimerRef.current)
    setCelebratingColumn(stageName)
    celebrateTimerRef.current = setTimeout(() => {
      setCelebratingColumn(null)
      celebrateTimerRef.current = null
    }, 550) // slightly longer than the 500ms animation so it fully completes
  }, [])

  // Quick advance: move an entry to the next stage in order (never into Dormant)
  const nextStageOf = useCallback((currentStage: string): string | null => {
    const idx = stages.findIndex((s) => s.stage_name === currentStage)
    const next = idx >= 0 ? stages[idx + 1]?.stage_name : undefined
    return next && next !== 'Dormant' ? next : null
  }, [stages])

  const handleQuickAdvance = useCallback(async (entryId: string, currentStage: string) => {
    const nextStage = nextStageOf(currentStage)
    if (!nextStage || !profile) return
    const { error: advanceError } = await advanceStage(entryId, nextStage, profile.id)
    if (advanceError) {
      console.error('Failed to quick-advance:', advanceError)
    } else {
      triggerCelebration(nextStage)
    }
  }, [advanceStage, nextStageOf, profile, triggerCelebration])

  // Drag handler — advance stage
  const handleDragEnd = async (result: DropResult) => {
    const { draggableId, destination, source } = result
    if (!destination) return
    if (destination.droppableId === source.droppableId && destination.index === source.index) return

    const newStage = destination.droppableId
    if (!profile) return

    const { error: advanceError } = await advanceStage(draggableId, newStage, profile.id)
    if (advanceError) {
      console.error('Failed to advance stage:', advanceError)
    } else {
      // Feature 14: flash the destination column header on success
      triggerCelebration(newStage)
    }
  }

  const selectStyle: React.CSSProperties = {
    background: 'var(--bg-card)',
    border: '1px solid var(--hover-medium)',
    borderRadius: 6,
    color: 'var(--text-soft, #ccc)',
    fontSize: 13,
    padding: '6px 10px',
    outline: 'none',
    cursor: 'pointer',
  }

  return (
    <AuthGuard>
      <div style={{ minHeight: '100vh' }}>
        <Header />

        <div style={{ maxWidth: 1600, margin: '0 auto', padding: '24px 20px' }}>
          {/* Page heading */}
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              marginBottom: 20,
              flexWrap: 'wrap',
              gap: 12,
            }}
          >
            <div>
              <h1 className="text-gradient" style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>
                Pipeline
              </h1>
              <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '4px 0 0' }}>
                {stats.totalEntries} {stats.totalEntries === 1 ? 'entry' : 'entries'} · {stats.activeContacts} not dormant · every entry has a purpose
              </p>
            </div>

            {/* Pipeline selector */}
            <div style={{ display: 'flex', gap: 4, background: 'var(--bg-card)', borderRadius: 8, padding: 3 }}>
              {pipelineOptions.map((opt) => (
                <button
                  key={opt.value}
                  data-testid={`pipeline-tab-${opt.value}`}
                  onClick={() => {
                    setActiveProject(opt.value)
                    setSearch('')
                    setWarmthFilter('')
                  }}
                  style={{
                    background: activeProject === opt.value ? 'var(--accent)' : 'transparent',
                    color: activeProject === opt.value ? '#fff' : 'var(--text-secondary)',
                    border: 'none',
                    borderRadius: 6,
                    padding: '6px 14px',
                    fontSize: 13,
                    fontWeight: 500,
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Funnel stats */}
          {!loading && stages.length > 0 && (
            <div
              style={{
                display: 'flex',
                gap: 2,
                marginBottom: 20,
                alignItems: 'flex-end',
                height: 60,
              }}
            >
              {stages.map((stage) => {
                const conversion = stats.stageConversions[stage.stage_name]
                const count = conversion?.count ?? 0
                const pct = conversion?.percentage ?? 0
                const barHeight = Math.max(8, pct * 0.55)

                return (
                  <div
                    key={stage.stage_name}
                    style={{
                      flex: 1,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                      {count > 0 ? `${count} (${pct}%)` : '—'}
                    </span>
                    <div
                      style={{
                        width: '100%',
                        height: barHeight,
                        background: count > 0 ? 'rgba(76,114,176,0.19)' : 'var(--hover-faint)',
                        borderRadius: 3,
                        position: 'relative',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          position: 'absolute',
                          inset: 0,
                          background: 'var(--accent)',
                          opacity: 0.4 + (pct / 100) * 0.6,
                          borderRadius: 3,
                        }}
                      />
                    </div>
                    <span
                      style={{
                        fontSize: 9,
                        color: 'var(--text-faint)',
                        textAlign: 'center',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        width: '100%',
                      }}
                    >
                      {stage.stage_name}
                    </span>
                  </div>
                )
              })}
            </div>
          )}

          {/* Warmth distribution */}
          {!loading && stats.totalContacts > 0 && (
            <div
              style={{
                display: 'flex',
                gap: 10,
                marginBottom: 20,
                flexWrap: 'wrap',
              }}
            >
              {Object.entries(stats.warmthCounts)
                .sort(([, a], [, b]) => b - a)
                .map(([warmth, count]) => (
                  <button
                    key={warmth}
                    onClick={() =>
                      setWarmthFilter((prev) => (prev === warmth ? '' : warmth))
                    }
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '4px 10px',
                      borderRadius: 6,
                      border: warmthFilter === warmth ? `1px solid ${WARMTH_COLORS[warmth] ?? 'var(--text-faint)'}` : '1px solid var(--border-subtle)',
                      background: warmthFilter === warmth
                        ? `${WARMTH_COLORS[warmth] ?? 'var(--text-faint)'}15`
                        : 'var(--bg-card)',
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                    }}
                  >
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: WARMTH_COLORS[warmth] ?? '#555',
                      }}
                    />
                    <span style={{ fontSize: 12, color: 'var(--text-soft, #ccc)' }}>{warmth}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{count}</span>
                  </button>
                ))}
            </div>
          )}

          {/* Pipeline analytics (collapsible) */}
          {!loading && <PipelineAnalyticsPanel project={activeProject} />}

          {/* Filter bar */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              marginBottom: 20,
              flexWrap: 'wrap',
            }}
          >
            <input
              type="text"
              placeholder="Search names, orgs, purposes…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                ...selectStyle,
                width: 220,
                padding: '7px 12px',
              }}
            />

            {(warmthFilter || search) && (
              <button
                onClick={() => {
                  setWarmthFilter('')
                  setSearch('')
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--accent)',
                  fontSize: 12,
                  cursor: 'pointer',
                  padding: '4px 8px',
                }}
              >
                Clear filters
              </button>
            )}

            <span style={{ fontSize: 12, color: 'var(--text-faint)', marginLeft: 'auto' }}>
              {filteredTotal} of {stats.totalContacts} shown
            </span>
          </div>

          {/* Loading / Error states */}
          {loading && (
            <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 40 }}>
              Loading pipeline…
            </div>
          )}

          {error && (
            <div
              style={{
                color: 'var(--danger)',
                background: 'rgba(196,78,82,0.1)',
                padding: '12px 16px',
                borderRadius: 8,
                marginBottom: 16,
                fontSize: 13,
              }}
            >
              {error}
            </div>
          )}

          {/* Pipeline columns */}
          {!loading && (
            <DragDropContext onDragEnd={handleDragEnd}>
              <div
                style={{
                  display: 'flex',
                  gap: 12,
                  overflowX: 'auto',
                  paddingBottom: 20,
                  height: 'calc(100vh - 380px)',
                  minHeight: 400,
                }}
              >
                {stages.map((stage) => (
                  <PipelineColumn
                    key={stage.stage_name}
                    stageName={stage.stage_name}
                    stageOrder={stage.stage_order}
                    contacts={filteredByStage[stage.stage_name] ?? []}
                    onSelectContact={setSelectedContactId}
                    celebrating={celebratingColumn === stage.stage_name}
                    showQuickAdvance={nextStageOf(stage.stage_name) !== null}
                    onQuickAdvance={handleQuickAdvance}
                  />
                ))}
              </div>
            </DragDropContext>
          )}
        </div>

        {/* Contact sidebar */}
        <ContactSidebar
          contactId={selectedContactId}
          onClose={() => setSelectedContactId(null)}
          userId={profile?.id}
        />
      </div>
    </AuthGuard>
  )
}
