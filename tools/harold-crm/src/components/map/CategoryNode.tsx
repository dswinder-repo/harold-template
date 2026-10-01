import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { DEFAULT_CATEGORY_COLORS, DEFAULT_CATEGORY_LABELS } from '@/lib/types'

export interface CategoryNodeData {
  category: string
  count: number
  label?: string
  [key: string]: unknown
}

function CategoryNodeComponent({ data }: NodeProps) {
  const d = data as unknown as CategoryNodeData
  const color = DEFAULT_CATEGORY_COLORS[d.category] ?? '#666'
  const label = d.label ?? DEFAULT_CATEGORY_LABELS[d.category] ?? d.category

  return (
    <div
      style={{
        background: color,
        borderRadius: 12,
        padding: '12px 20px',
        minWidth: 120,
        textAlign: 'center',
        boxShadow: `0 4px 16px ${color}44`,
        transition: 'filter 0.2s ease, transform 0.2s ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.filter = `drop-shadow(0 0 10px ${color}80)`
        e.currentTarget.style.transform = 'scale(1.05)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.filter = 'none'
        e.currentTarget.style.transform = 'scale(1)'
      }}
    >
      {/* Handles on all sides for radial layout */}
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Bottom} id="t-bottom" style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Left} id="t-left" style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Right} id="t-right" style={{ opacity: 0 }} />
      <div style={{ color: '#fff', fontSize: 14, fontWeight: 700 }}>{label}</div>
      <div style={{ color: 'rgba(255,255,255,0.75)', fontSize: 11, marginTop: 2 }}>
        {d.count} contacts
      </div>
      <Handle type="source" position={Position.Top} id="s-top" style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Left} id="s-left" style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right} id="s-right" style={{ opacity: 0 }} />
    </div>
  )
}

export default memo(CategoryNodeComponent)
