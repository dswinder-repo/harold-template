import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { WarmthType, PriorityType } from '@/lib/types'

const WARMTH_COLORS: Record<string, string> = {
  Hot: '#C44E52',
  Warm: '#ffc107',
  Lukewarm: '#55A868',
  Cold: '#4C72B0',
  '': '#555',
}

const PRIORITY_SIZES: Record<PriorityType, number> = {
  high: 7,
  medium: 5,
  low: 4,
}

export interface ContactNodeData {
  name: string
  org: string
  warmth: WarmthType
  priority: PriorityType
  contactId: string
  [key: string]: unknown
}

function ContactNodeComponent({ data }: NodeProps) {
  const d = data as unknown as ContactNodeData
  const warmthColor = WARMTH_COLORS[d.warmth] ?? '#555'
  const dotSize = PRIORITY_SIZES[d.priority] ?? 5

  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 6,
        padding: '6px 10px',
        minWidth: 90,
        maxWidth: 160,
        cursor: 'pointer',
        transition: 'border-color 0.2s ease, filter 0.2s ease, transform 0.2s ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = warmthColor
        e.currentTarget.style.filter = `drop-shadow(0 0 6px ${warmthColor}50)`
        e.currentTarget.style.transform = 'scale(1.05)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--border-subtle)'
        e.currentTarget.style.filter = 'none'
        e.currentTarget.style.transform = 'scale(1)'
      }}
    >
      {/* Handles on all sides for radial layout */}
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Bottom} id="t-bottom" style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Left} id="t-left" style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Right} id="t-right" style={{ opacity: 0 }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <span
          style={{
            width: dotSize * 2,
            height: dotSize * 2,
            borderRadius: '50%',
            background: warmthColor,
            flexShrink: 0,
          }}
        />
        <span
          style={{
            color: 'var(--text-primary)',
            fontSize: 11,
            fontWeight: 500,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {d.name}
        </span>
      </div>
      {d.org && (
        <div
          style={{
            color: 'var(--text-muted)',
            fontSize: 9,
            marginTop: 2,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            paddingLeft: dotSize * 2 + 5,
          }}
        >
          {d.org}
        </div>
      )}
      <Handle type="source" position={Position.Top} id="s-top" style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Left} id="s-left" style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right} id="s-right" style={{ opacity: 0 }} />
    </div>
  )
}

export default memo(ContactNodeComponent)
