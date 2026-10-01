'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import AuthGuard from '@/components/AuthGuard'
import Header from '@/components/Header'
import { useContacts } from '@/hooks/useContacts'
import { useCategories } from '@/hooks/useCategories'
import { useContactCategories } from '@/hooks/useContactCategories'
import { createClient } from '@/lib/supabase/client'
import { formatRelativeTime } from '@/lib/utils'
import type { Interaction, Task } from '@/lib/types'

// ── Colors ──────────────────────────────────────────────────────────
const WARMTH_COLORS: Record<string, string> = {
  Hot: '#C44E52',
  Warm: '#DD8452',
  Lukewarm: '#4C72B0',
  Cold: '#a0a0a0',
}

// The seven stages of the one pipeline (see supabase/migrations/001).
const STAGE_COLORS: Record<string, string> = {
  Identified: '#a0a0a0',
  'Reached Out': '#4C72B0',
  'In Conversation': '#14B8A6',
  Advancing: '#DD8452',
  Committed: '#F5D623',
  Active: '#55A868',
  Dormant: '#666666',
}
const STAGE_ORDER = ['Identified', 'Reached Out', 'In Conversation', 'Advancing', 'Committed', 'Active', 'Dormant', 'Not in pipeline']

const INTERACTION_ICONS: Record<string, string> = {
  call: '\u{1F4DE}',
  email: '\u2709\uFE0F',
  meeting: '\u{1F91D}',
  note: '\u{1F4DD}',
  linkedin: '\u{1F517}',
  other: '\u{1F4AC}',
}

function getStageColor(stage: string): string {
  return STAGE_COLORS[stage] ?? '#937860'
}

// ── Stat Card (interactive) ──────────────────────────────────────────
function StatCard({ label, value, color, sub }: { label: string; value: number; color: string; sub?: string }) {
  return (
    <div
      className="flex min-w-[120px] flex-1 flex-col gap-1 rounded-md px-4 py-3"
      style={{
        background: 'var(--bg-card)',
        borderLeft: `3px solid ${color}`,
        transition: 'transform 0.2s ease, box-shadow 0.2s ease',
        cursor: 'default',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-3px) scale(1.02)'
        e.currentTarget.style.boxShadow = `0 8px 24px ${color}30`
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateY(0) scale(1)'
        e.currentTarget.style.boxShadow = 'none'
      }}
    >
      <div className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
        {value}
      </div>
      <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
        {label}
      </div>
      {sub && (
        <div className="text-[10px]" style={{ color: 'var(--text-secondary)', opacity: 0.7 }}>
          {sub}
        </div>
      )}
    </div>
  )
}

// ── Section wrapper ─────────────────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      className="rounded-lg p-5"
      style={{ background: 'var(--bg-card)', border: '1px solid rgba(255,255,255,0.06)' }}
    >
      <h3
        className="mb-4 text-sm font-semibold uppercase tracking-wider"
        style={{ color: 'var(--text-secondary)' }}
      >
        {title}
      </h3>
      {children}
    </div>
  )
}

// ── Horizontal bar (interactive) ────────────────────────────────────
function HBar({ label, value, max, color, total }: { label: string; value: number; max: number; color: string; total?: number }) {
  const pct = max > 0 ? (value / max) * 100 : 0
  const sharePct = total && total > 0 ? ((value / total) * 100).toFixed(1) : null
  const [hovered, setHovered] = useState(false)

  return (
    <div
      className="flex items-center gap-3 rounded-md px-2 py-1.5"
      style={{
        transition: 'background 0.2s ease',
        background: hovered ? 'rgba(255,255,255,0.04)' : 'transparent',
        cursor: 'default',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span className="w-24 shrink-0 text-right text-xs" style={{ color: hovered ? 'var(--text-primary)' : 'var(--text-secondary)', transition: 'color 0.2s' }}>
        {label}
      </span>
      <div className="relative flex-1 overflow-hidden rounded-full" style={{ height: hovered ? 12 : 8, transition: 'height 0.2s ease', background: 'rgba(255,255,255,0.06)' }}>
        <div
          className="h-full rounded-full"
          style={{
            width: `${pct}%`,
            background: color,
            transition: 'width 0.5s ease, box-shadow 0.2s ease',
            boxShadow: hovered ? `0 0 12px ${color}88` : 'none',
          }}
        />
      </div>
      <div className="flex w-16 items-center justify-end gap-1">
        <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
          {value}
        </span>
        {hovered && sharePct && (
          <span
            className="text-[10px] font-medium"
            style={{ color, opacity: 0.9, animation: 'fadeIn 0.15s ease' }}
          >
            {sharePct}%
          </span>
        )}
      </div>
    </div>
  )
}

// ── Donut chart (interactive SVG) ────────────────────────────────────
function DonutChart({ data, colorMap }: { data: [string, number][]; colorMap: Record<string, string> }) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)
  const total = data.reduce((sum, [, v]) => sum + v, 0)
  if (total === 0) return null

  const size = 180
  const cx = size / 2
  const cy = size / 2
  const outerR = 70
  const innerR = 42
  const hoverGrow = 8

  // Build cumulative start angles (immutable — no reassignment)
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const angles = data.reduce<number[]>((acc, [,], i) => {
    const prev = i === 0 ? -90 : acc[i - 1] + (data[i - 1][1] / total) * 360
    acc.push(prev)
    return acc
  }, [])

  const segments = data.map(([label, value], i) => {
    const angle = (value / total) * 360
    const startAngle = angles[i]
    const endAngle = startAngle + angle
    const isHovered = hoveredIdx === i
    const r = isHovered ? outerR + hoverGrow : outerR
    const ir = isHovered ? innerR - 2 : innerR

    const x1 = cx + r * Math.cos(toRad(startAngle))
    const y1 = cy + r * Math.sin(toRad(startAngle))
    const x2 = cx + r * Math.cos(toRad(endAngle))
    const y2 = cy + r * Math.sin(toRad(endAngle))
    const ix1 = cx + ir * Math.cos(toRad(endAngle))
    const iy1 = cy + ir * Math.sin(toRad(endAngle))
    const ix2 = cx + ir * Math.cos(toRad(startAngle))
    const iy2 = cy + ir * Math.sin(toRad(startAngle))
    const large = angle > 180 ? 1 : 0
    const color = colorMap[label] ?? '#555'

    const d = [
      `M ${x1} ${y1}`,
      `A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`,
      `L ${ix1} ${iy1}`,
      `A ${ir} ${ir} 0 ${large} 0 ${ix2} ${iy2}`,
      'Z',
    ].join(' ')

    return { d, color, label, value, i, isHovered, startAngle, endAngle }
  })

  const hovered = hoveredIdx !== null ? data[hoveredIdx] : null
  const hoveredPct = hovered ? ((hovered[1] / total) * 100).toFixed(1) : null

  return (
    <div className="flex flex-col items-center gap-2">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ overflow: 'visible' }}
      >
        {segments.map((seg) => (
          <path
            key={seg.i}
            d={seg.d}
            fill={seg.color}
            stroke="var(--bg-card)"
            strokeWidth={2}
            style={{
              transition: 'all 0.2s ease',
              filter: seg.isHovered ? `drop-shadow(0 0 8px ${seg.color}88)` : 'none',
              opacity: hoveredIdx !== null && !seg.isHovered ? 0.5 : 1,
              cursor: 'pointer',
            }}
            onMouseEnter={() => setHoveredIdx(seg.i)}
            onMouseLeave={() => setHoveredIdx(null)}
          />
        ))}
        {/* Center text */}
        <text x={cx} y={cy - 6} textAnchor="middle" fontSize="20" fontWeight="bold" fill="var(--text-primary)">
          {hoveredIdx !== null ? hovered![1] : total}
        </text>
        <text x={cx} y={cy + 12} textAnchor="middle" fontSize="10" fill="var(--text-secondary)">
          {hoveredIdx !== null ? hovered![0] : 'Total'}
        </text>
        {hoveredPct && (
          <text x={cx} y={cy + 24} textAnchor="middle" fontSize="9" fill="var(--text-secondary)" opacity={0.7}>
            {hoveredPct}%
          </text>
        )}
      </svg>
    </div>
  )
}

// ── Interactive pill ────────────────────────────────────────────────
function InteractivePill({ label, count, total, bgColor, textColor }: { label: string; count: number; total: number; bgColor: string; textColor: string }) {
  const [hovered, setHovered] = useState(false)
  const pct = total > 0 ? ((count / total) * 100).toFixed(1) : '0'

  return (
    <div
      className="relative flex items-center gap-2 rounded-full px-3 py-1.5"
      style={{
        background: bgColor,
        transition: 'transform 0.2s ease, box-shadow 0.2s ease',
        transform: hovered ? 'scale(1.1)' : 'scale(1)',
        boxShadow: hovered ? `0 4px 16px ${textColor}40` : 'none',
        cursor: 'default',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span className="text-xs font-medium" style={{ color: textColor }}>
        {label}
      </span>
      <span
        className="flex h-5 items-center justify-center rounded-full px-1.5 text-[10px] font-bold"
        style={{ background: `${textColor}30`, color: textColor, minWidth: 20 }}
      >
        {hovered ? `${pct}%` : count}
      </span>
    </div>
  )
}

// ── CSS keyframes (injected once) ───────────────────────────────────
function ChartStyles() {
  return (
    <style>{`
      @keyframes fadeIn { from { opacity: 0; transform: translateX(-4px); } to { opacity: 1; transform: translateX(0); } }
      @keyframes slideUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
    `}</style>
  )
}

// ── Main Component ──────────────────────────────────────────────────
export default function InvestorsClient() {
  const { contacts: allContacts, loading } = useContacts()
  useCategories() // ensure categories are loaded for getCategoriesForContact
  const { getCategoriesForContact } = useContactCategories()
  const supabase = createClient()

  const [interactions, setInteractions] = useState<Interaction[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [dataLoading, setDataLoading] = useState(true)

  // ── Investor contacts: the type is investor, or a label says so ──
  const investors = useMemo(() => {
    return allContacts.filter((c) => {
      const labels = getCategoriesForContact(c.id)
      return c.category === 'investor' || labels.includes('investor')
    })
  }, [allContacts, getCategoriesForContact])

  const investorIds = useMemo(() => investors.map((c) => c.id), [investors])

  // ── Fetch interactions + tasks for investors ────────────────────
  useEffect(() => {
    if (investorIds.length === 0) {
      setDataLoading(false)
      return
    }

    const fetchData = async () => {
      setDataLoading(true)

      const thirtyDaysAgo = new Date()
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

      const [interactionsRes, tasksRes] = await Promise.all([
        supabase
          .from('interactions')
          .select('*, profiles:user_id(id, full_name, email, avatar_url)')
          .in('contact_id', investorIds)
          .gte('occurred_at', thirtyDaysAgo.toISOString())
          .order('occurred_at', { ascending: false })
          .limit(100),
        supabase
          .from('tasks')
          .select('*, contacts(id, name, org)')
          .in('contact_id', investorIds)
          .in('status', ['pending', 'in_progress'])
          .order('due_date', { ascending: true })
          .limit(50),
      ])

      if (interactionsRes.data) setInteractions(interactionsRes.data as Interaction[])
      if (tasksRes.data) setTasks(tasksRes.data as Task[])
      setDataLoading(false)
    }

    fetchData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [investorIds.join(',')])

  // ── Computed metrics ────────────────────────────────────────────
  const stats = useMemo(() => {
    const activeConvos = investors.filter((c) => c.warmth === 'Hot').length
    const meetings30d = interactions.filter((i) => i.type === 'meeting').length
    const emails30d = interactions.filter((i) => i.type === 'email').length
    const openTasks = tasks.length

    // Stale = warm+ investors with no recent interaction
    // We check last interaction from our fetched data
    const interactionsByContact = new Map<string, Interaction[]>()
    for (const i of interactions) {
      const arr = interactionsByContact.get(i.contact_id) ?? []
      arr.push(i)
      interactionsByContact.set(i.contact_id, arr)
    }

    const needAttention = investors.filter((c) => {
      if (!c.warmth || c.warmth === 'Cold') return false
      const contactInteractions = interactionsByContact.get(c.id)
      return !contactInteractions || contactInteractions.length === 0
    })

    return { total: investors.length, activeConvos, meetings30d, emails30d, openTasks, needAttention }
  }, [investors, interactions, tasks])

  // ── Pipeline breakdown ──────────────────────────────────────────
  const pipelineBreakdown = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const c of investors) {
      // pipeline_stage is the stage of the contact's furthest-advanced open entry
      const stage = c.pipeline_stage || 'Not in pipeline'
      counts[stage] = (counts[stage] ?? 0) + 1
    }
    return Object.entries(counts).sort(([a], [b]) => {
      const ai = STAGE_ORDER.indexOf(a)
      const bi = STAGE_ORDER.indexOf(b)
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
    })
  }, [investors])

  const maxPipelineCount = Math.max(...pipelineBreakdown.map(([, v]) => v), 1)

  // ── Warmth breakdown ────────────────────────────────────────────
  const warmthBreakdown = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const c of investors) {
      const w = c.warmth || 'Unset'
      counts[w] = (counts[w] ?? 0) + 1
    }
    const order = ['Hot', 'Warm', 'Lukewarm', 'Cold', 'Unset']
    return Object.entries(counts).sort(([a], [b]) => {
      return order.indexOf(a) - order.indexOf(b)
    })
  }, [investors])

  const maxWarmthCount = Math.max(...warmthBreakdown.map(([, v]) => v), 1)

  // ── Investor type breakdown ─────────────────────────────────────
  const typeBreakdown = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const c of investors) {
      const t = c.investor_type || 'Other'
      counts[t] = (counts[t] ?? 0) + 1
    }
    return Object.entries(counts).sort(([, a], [, b]) => b - a)
  }, [investors])

  // ── Region breakdown ────────────────────────────────────────────
  const regionBreakdown = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const c of investors) {
      const r = c.region || 'Unknown'
      counts[r] = (counts[r] ?? 0) + 1
    }
    return Object.entries(counts).sort(([, a], [, b]) => b - a)
  }, [investors])

  // ── Recent activity (last 15) ───────────────────────────────────
  const recentActivity = useMemo(() => {
    return interactions.slice(0, 15).map((i) => {
      const contact = investors.find((c) => c.id === i.contact_id)
      return { ...i, contactName: contact?.name ?? 'Unknown', contactOrg: contact?.org ?? '' }
    })
  }, [interactions, investors])

  // ── Loading skeleton ────────────────────────────────────────────
  if (loading) {
    return (
      <AuthGuard>
        <div className="min-h-screen">
          <Header />
          <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
            <div className="flex flex-wrap gap-2.5">
              {[...Array(6)].map((_, i) => (
                <div
                  key={i}
                  className="h-20 min-w-[120px] flex-1 animate-pulse rounded-md"
                  style={{ background: 'var(--bg-card)' }}
                />
              ))}
            </div>
            <div className="mt-6 grid grid-cols-2 gap-4">
              {[...Array(4)].map((_, i) => (
                <div
                  key={i}
                  className="h-48 animate-pulse rounded-lg"
                  style={{ background: 'var(--bg-card)' }}
                />
              ))}
            </div>
          </main>
        </div>
      </AuthGuard>
    )
  }

  return (
    <AuthGuard>
      <div className="min-h-screen">
        <Header />

        <ChartStyles />
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
          {/* ── Page Title ──────────────────────────────────────── */}
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-gradient">
                Investors
              </h1>
              <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
                Every investor contact: where they stand in the pipeline, how warm, and what is due
              </p>
            </div>
            <Link
              href="/pipeline"
              className="rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
              style={{
                background: 'rgba(76,114,176,0.15)',
                color: '#4C72B0',
                textDecoration: 'none',
              }}
            >
              View Full Pipeline →
            </Link>
          </div>

          {/* ── KPI Stats Row ──────────────────────────────────── */}
          <div className="mb-6 flex flex-wrap gap-2.5">
            <StatCard label="Total Investors" value={stats.total} color="#DD8452" />
            <StatCard label="Active Convos" value={stats.activeConvos} color="#F5D623" sub="Hot" />
            <StatCard label="Meetings (30d)" value={stats.meetings30d} color="#55A868" />
            <StatCard label="Emails (30d)" value={stats.emails30d} color="#4C72B0" />
            <StatCard label="Open Tasks" value={stats.openTasks} color="#8172B3" />
            <StatCard label="Need Attention" value={stats.needAttention.length} color="#C44E52" sub="No contact in 30d" />
          </div>

          {/* ── Pipeline + Warmth charts ───────────────────────── */}
          <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2">
            <Section title="Pipeline Stages">
              {pipelineBreakdown.length === 0 ? (
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>No investors yet.</p>
              ) : (
                <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start sm:gap-6">
                  <DonutChart data={pipelineBreakdown} colorMap={STAGE_COLORS} />
                  <div className="flex w-full flex-1 flex-col gap-1">
                    {pipelineBreakdown.map(([stage, count], i) => (
                      <div key={stage} style={{ animation: `slideUp 0.3s ease ${i * 0.05}s both` }}>
                        <HBar label={stage} value={count} max={maxPipelineCount} color={getStageColor(stage)} total={investors.length} />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Section>

            <Section title="Warmth Distribution">
              {warmthBreakdown.length === 0 ? (
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>No investors found.</p>
              ) : (
                <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start sm:gap-6">
                  <DonutChart data={warmthBreakdown} colorMap={WARMTH_COLORS} />
                  <div className="flex w-full flex-1 flex-col gap-1">
                    {warmthBreakdown.map(([warmth, count], i) => (
                      <div key={warmth} style={{ animation: `slideUp 0.3s ease ${i * 0.05}s both` }}>
                        <HBar
                          label={warmth}
                          value={count}
                          max={maxWarmthCount}
                          color={WARMTH_COLORS[warmth] ?? '#555'}
                          total={investors.length}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Section>
          </div>

          {/* ── Type + Region breakdown ─────────────────────────── */}
          <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2">
            <Section title="Investor Types">
              <div className="flex flex-wrap gap-2">
                {typeBreakdown.map(([type, count], i) => (
                  <div key={type} style={{ animation: `slideUp 0.3s ease ${i * 0.06}s both` }}>
                    <InteractivePill
                      label={type}
                      count={count}
                      total={investors.length}
                      bgColor="rgba(221,132,82,0.12)"
                      textColor="#DD8452"
                    />
                  </div>
                ))}
                {typeBreakdown.length === 0 && (
                  <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>No investor types set.</p>
                )}
              </div>
            </Section>

            <Section title="Regions">
              <div className="flex flex-wrap gap-2">
                {regionBreakdown.map(([region, count], i) => (
                  <div key={region} style={{ animation: `slideUp 0.3s ease ${i * 0.06}s both` }}>
                    <InteractivePill
                      label={region}
                      count={count}
                      total={investors.length}
                      bgColor="rgba(76,114,176,0.12)"
                      textColor="#4C72B0"
                    />
                  </div>
                ))}
                {regionBreakdown.length === 0 && (
                  <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>No regions set.</p>
                )}
              </div>
            </Section>
          </div>

          {/* ── Needs Attention table ──────────────────────────── */}
          <div className="mb-6">
            <Section title={`Needs Attention (${stats.needAttention.length})`}>
              {stats.needAttention.length === 0 ? (
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  All warm+ investors have been contacted in the last 30 days.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                        <th className="pb-2 text-left text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Name</th>
                        <th className="pb-2 text-left text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Org</th>
                        <th className="pb-2 text-left text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Warmth</th>
                        <th className="pb-2 text-left text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Stage</th>
                        <th className="pb-2 text-right text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Last Updated</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.needAttention.slice(0, 10).map((c) => (
                        <tr
                          key={c.id}
                          style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', transition: 'background 0.15s ease', cursor: 'pointer' }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(196,78,82,0.08)')}
                          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                        >
                          <td className="py-2">
                            <Link
                              href={`/contacts/${c.id}`}
                              className="text-sm font-medium hover:underline"
                              style={{ color: '#DD8452', textDecoration: 'none' }}
                            >
                              {c.name}
                            </Link>
                          </td>
                          <td className="py-2 text-xs" style={{ color: 'var(--text-secondary)' }}>{c.org}</td>
                          <td className="py-2">
                            <span
                              className="inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold"
                              style={{
                                background: `${WARMTH_COLORS[c.warmth ?? ''] ?? '#555'}22`,
                                color: WARMTH_COLORS[c.warmth ?? ''] ?? '#555',
                              }}
                            >
                              {c.warmth}
                            </span>
                          </td>
                          <td className="py-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                            {c.pipeline_stage || '—'}
                          </td>
                          <td className="py-2 text-right text-xs" style={{ color: 'var(--text-secondary)' }}>
                            {formatRelativeTime(c.updated_at)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {stats.needAttention.length > 10 && (
                    <p className="mt-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                      +{stats.needAttention.length - 10} more
                    </p>
                  )}
                </div>
              )}
            </Section>
          </div>

          {/* ── Recent Investor Activity ───────────────────────── */}
          <div className="mb-6">
            <Section title="Recent Investor Activity (30d)">
              {dataLoading ? (
                <div className="flex flex-col gap-3">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="h-8 animate-pulse rounded" style={{ background: 'rgba(255,255,255,0.04)' }} />
                  ))}
                </div>
              ) : recentActivity.length === 0 ? (
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  No investor interactions in the last 30 days.
                </p>
              ) : (
                <div className="flex flex-col gap-1">
                  {recentActivity.map((a) => (
                    <div
                      key={a.id}
                      className="flex items-center gap-3 rounded px-2 py-1.5 transition-colors"
                      style={{ background: 'transparent' }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
                      <span className="text-sm">{INTERACTION_ICONS[a.type] ?? '\u{1F4AC}'}</span>
                      <Link
                        href={`/contacts/${a.contact_id}`}
                        className="shrink-0 text-xs font-medium hover:underline"
                        style={{ color: '#DD8452', textDecoration: 'none', minWidth: 100 }}
                      >
                        {a.contactName}
                      </Link>
                      <span className="flex-1 truncate text-xs" style={{ color: 'var(--text-secondary)' }}>
                        {a.subject}
                      </span>
                      <span className="shrink-0 text-[10px]" style={{ color: 'var(--text-secondary)', opacity: 0.7 }}>
                        {formatRelativeTime(a.occurred_at)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Section>
          </div>

          {/* ── Open Tasks ─────────────────────────────────────── */}
          {tasks.length > 0 && (
            <div className="mb-6">
              <Section title={`Open Investor Tasks (${tasks.length})`}>
                <div className="flex flex-col gap-1">
                  {tasks.slice(0, 8).map((t) => {
                    const contact = (t as Task & { contacts?: { id: string; name: string; org: string } }).contacts
                    const isOverdue = t.due_date && new Date(t.due_date) < new Date()
                    return (
                      <div
                        key={t.id}
                        className="flex items-center gap-3 rounded px-2 py-1.5"
                        style={{ background: 'transparent' }}
                      >
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{
                            background: t.priority === 'high' ? '#C44E52' : t.priority === 'medium' ? '#ffc107' : '#a0a0a0',
                          }}
                        />
                        <span className="flex-1 truncate text-xs" style={{ color: 'var(--text-primary)' }}>
                          {t.title}
                        </span>
                        {contact && (
                          <Link
                            href={`/contacts/${contact.id}`}
                            className="shrink-0 text-[10px] hover:underline"
                            style={{ color: '#DD8452', textDecoration: 'none' }}
                          >
                            {contact.name}
                          </Link>
                        )}
                        {t.due_date && (
                          <span
                            className="shrink-0 text-[10px]"
                            style={{ color: isOverdue ? '#C44E52' : 'var(--text-secondary)' }}
                          >
                            {isOverdue ? 'Overdue' : `Due ${formatRelativeTime(t.due_date)}`}
                          </span>
                        )}
                      </div>
                    )
                  })}
                  {tasks.length > 8 && (
                    <Link
                      href="/tasks"
                      className="mt-2 text-xs hover:underline"
                      style={{ color: '#4C72B0', textDecoration: 'none' }}
                    >
                      View all {tasks.length} tasks →
                    </Link>
                  )}
                </div>
              </Section>
            </div>
          )}
        </main>
      </div>
    </AuthGuard>
  )
}
