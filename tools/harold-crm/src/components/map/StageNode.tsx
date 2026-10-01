import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'

export interface StageNodeData {
  label: string
  count: number
  color: string
  [key: string]: unknown
}

function StageNodeComponent({ data }: NodeProps) {
  const d = data as unknown as StageNodeData

  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: `1px solid ${d.color}66`,
        borderRadius: 8,
        padding: '8px 14px',
        minWidth: 100,
        textAlign: 'center',
        transition: 'filter 0.2s ease, transform 0.2s ease, border-color 0.2s ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.filter = `drop-shadow(0 0 8px ${d.color}60)`
        e.currentTarget.style.transform = 'scale(1.05)'
        e.currentTarget.style.borderColor = d.color
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.filter = 'none'
        e.currentTarget.style.transform = 'scale(1)'
        e.currentTarget.style.borderColor = `${d.color}66`
      }}
    >
      {/* Handles on all sides for radial layout */}
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Bottom} id="t-bottom" style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Left} id="t-left" style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Right} id="t-right" style={{ opacity: 0 }} />
      <div style={{ color: d.color, fontSize: 12, fontWeight: 600 }}>{d.label}</div>
      <div style={{ color: 'var(--text-muted)', fontSize: 10, marginTop: 2 }}>{d.count}</div>
      <Handle type="source" position={Position.Top} id="s-top" style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Left} id="s-left" style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right} id="s-right" style={{ opacity: 0 }} />
    </div>
  )
}

export default memo(StageNodeComponent)
