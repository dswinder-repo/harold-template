'use client'

import { useState } from 'react'
import { usePipelineAnalytics } from '@/hooks/usePipelineAnalytics'
import type { StageAnalytics } from '@/hooks/usePipelineAnalytics'

interface PipelineAnalyticsPanelProps {
  /** Project to narrow to, or 'all'. */
  project: string
}

export default function PipelineAnalyticsPanel({ project }: PipelineAnalyticsPanelProps) {
  const { analytics, loading, error } = usePipelineAnalytics(project)
  const [expanded, setExpanded] = useState(false)

  if (loading) {
    return (
      <div style={{ padding: '12px 0' }}>
        <ToggleHeader expanded={false} onToggle={() => {}} loading />
      </div>
    )
  }

  if (error || !analytics) return null

  const { stages, avgCycleDays, totalEntered, totalConverted, overallConversion, recentMoves } = analytics

  return (
    <div style={{ marginBottom: 20 }}>
      <ToggleHeader expanded={expanded} onToggle={() => setExpanded((p) => !p)} />

      {expanded && (
        <div
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 10,
            padding: 20,
            marginTop: 8,
            animation: 'fadeIn 0.2s ease',
          }}
        >
          {/* Summary cards */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: 12,
              marginBottom: 20,
            }}
          >
            <MetricCard label="Total Entered" value={totalEntered} />
            <MetricCard label="Total Converted" value={totalConverted} />
            <MetricCard
              label="Overall Conversion"
              value={overallConversion !== null ? `${overallConversion}%` : '—'}
              accent={overallConversion !== null && overallConversion >= 10}
            />
            <MetricCard
              label="Avg Cycle Time"
              value={avgCycleDays !== null ? `${avgCycleDays}d` : '—'}
            />
            <MetricCard label="Recent Moves (30d)" value={recentMoves} />
          </div>

          {/* Stage breakdown table */}
          {stages.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: 13,
                }}
              >
                <thead>
                  <tr>
                    <Th align="left">Stage</Th>
                    <Th>Current</Th>
                    <Th>Avg Days</Th>
                    <Th>Exits</Th>
                    <Th>Conversion</Th>
                    <Th align="left">Funnel</Th>
                  </tr>
                </thead>
                <tbody>
                  {stages.map((s, i) => (
                    <StageRow key={s.stageName} stage={s} isLast={i === stages.length - 1} maxCount={Math.max(...stages.map(st => st.count), 1)} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ToggleHeader({
  expanded,
  onToggle,
  loading,
}: {
  expanded: boolean
  onToggle: () => void
  loading?: boolean
}) {
  return (
    <button
      onClick={loading ? undefined : onToggle}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        background: 'none',
        border: 'none',
        cursor: loading ? 'default' : 'pointer',
        padding: '4px 0',
        color: 'var(--text-secondary)',
        fontSize: 13,
        fontWeight: 500,
        transition: 'color 0.15s',
      }}
    >
      <ChartIcon />
      <span>{loading ? 'Loading analytics…' : 'Pipeline Analytics'}</span>
      {!loading && (
        <span
          style={{
            display: 'inline-block',
            transition: 'transform 0.2s',
            transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
            fontSize: 10,
            marginLeft: 2,
          }}
        >
          ▼
        </span>
      )}
    </button>
  )
}

function MetricCard({
  label,
  value,
  accent,
}: {
  label: string
  value: string | number
  accent?: boolean
}) {
  return (
    <div
      style={{
        background: 'var(--bg-primary)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 8,
        padding: '12px 14px',
        textAlign: 'center',
      }}
    >
      <div
        style={{
          fontSize: 20,
          fontWeight: 700,
          color: accent ? 'var(--accent)' : 'var(--text-primary)',
          lineHeight: 1.2,
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: 10,
          color: 'var(--text-muted)',
          marginTop: 4,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          fontWeight: 600,
        }}
      >
        {label}
      </div>
    </div>
  )
}

function Th({ children, align = 'center' }: { children: React.ReactNode; align?: 'left' | 'center' | 'right' }) {
  return (
    <th
      style={{
        textAlign: align,
        padding: '8px 10px',
        fontSize: 10,
        fontWeight: 600,
        color: 'var(--text-muted)',
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        borderBottom: '1px solid var(--border-subtle)',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </th>
  )
}

function StageRow({
  stage,
  isLast,
  maxCount,
}: {
  stage: StageAnalytics
  isLast: boolean
  maxCount: number
}) {
  const barWidth = maxCount > 0 ? Math.max(4, (stage.count / maxCount) * 100) : 0

  return (
    <tr>
      <td
        style={{
          padding: '10px 10px',
          color: 'var(--text-primary)',
          fontWeight: 500,
          borderBottom: '1px solid var(--hover-faint)',
          whiteSpace: 'nowrap',
        }}
      >
        {stage.stageName}
      </td>
      <td style={{ ...cellStyle, fontVariantNumeric: 'tabular-nums' }}>
        {stage.count}
      </td>
      <td style={{ ...cellStyle, fontVariantNumeric: 'tabular-nums' }}>
        {stage.avgDaysInStage !== null ? (
          <span>
            {stage.avgDaysInStage}
            <span style={{ fontSize: 10, color: 'var(--text-faint)', marginLeft: 2 }}>d</span>
          </span>
        ) : (
          <span style={{ color: 'var(--text-faint)' }}>—</span>
        )}
      </td>
      <td style={{ ...cellStyle, fontVariantNumeric: 'tabular-nums' }}>
        {stage.exitCount}
      </td>
      <td style={cellStyle}>
        {stage.conversionRate !== null && !isLast ? (
          <ConversionBadge rate={stage.conversionRate} />
        ) : (
          <span style={{ color: 'var(--text-faint)' }}>—</span>
        )}
      </td>
      <td style={{ ...cellStyle, textAlign: 'left', minWidth: 100 }}>
        <div
          style={{
            height: 6,
            borderRadius: 3,
            background: 'var(--hover-faint)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${barWidth}%`,
              background: 'var(--accent)',
              borderRadius: 3,
              opacity: 0.7,
              transition: 'width 0.3s ease',
            }}
          />
        </div>
      </td>
    </tr>
  )
}

function ConversionBadge({ rate }: { rate: number }) {
  const color =
    rate >= 50 ? '#4ade80' : rate >= 25 ? '#fbbf24' : rate >= 10 ? '#fb923c' : '#f87171'

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 8px',
        borderRadius: 10,
        fontSize: 12,
        fontWeight: 600,
        background: `${color}18`,
        color,
      }}
    >
      {rate}%
    </span>
  )
}

function ChartIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 3v18h18" />
      <path d="m19 9-5 5-4-4-3 3" />
    </svg>
  )
}

const cellStyle: React.CSSProperties = {
  padding: '10px 10px',
  textAlign: 'center',
  color: 'var(--text-secondary)',
  borderBottom: '1px solid var(--hover-faint)',
}
