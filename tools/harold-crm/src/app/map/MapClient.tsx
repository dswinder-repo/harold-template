'use client'

import { useMemo, useState, useCallback } from 'react'
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useRouter } from 'next/navigation'
import AuthGuard from '@/components/AuthGuard'
import Header from '@/components/Header'
import { useContacts } from '@/hooks/useContacts'
import type { Contact } from '@/lib/types'
import { DEFAULT_CATEGORY_COLORS } from '@/lib/types'
import CategoryNode from '@/components/map/CategoryNode'
import StageNode from '@/components/map/StageNode'
import ContactNode from '@/components/map/ContactNode'

// Custom node types registered with React Flow
const nodeTypes = {
  category: CategoryNode,
  stage: StageNode,
  contact: ContactNode,
}

// Warmth groups, warmest first
const WARMTH_ORDER = ['Hot', 'Warm', 'Lukewarm', 'Cold', 'Not rated']

/**
 * Radial / spoke layout:
 *   - Root node at center (0, 0)
 *   - Type nodes spread evenly around the center
 *   - Warmth nodes spread in a sub-arc around each type
 *   - Contact nodes spread in an outer arc around each warmth group
 */
function buildRadialGraph(contacts: Contact[], visibleCategories: Set<string>) {
  const nodes: Node[] = []
  const edges: Edge[] = []

  // Root node at center
  nodes.push({
    id: 'root',
    type: 'category',
    position: { x: -70, y: -22 },
    data: { category: 'root', count: contacts.length, label: 'Harold CRM' },
  })

  // Group contacts by category
  const byCategory: Record<string, Contact[]> = {}
  for (const c of contacts) {
    if (!visibleCategories.has(c.category)) continue
    if (!byCategory[c.category]) byCategory[c.category] = []
    byCategory[c.category].push(c)
  }

  const categoryKeys = Object.keys(byCategory)
  if (categoryKeys.length === 0) return { nodes, edges }

  // Layout constants
  const CATEGORY_RADIUS = 320
  const STAGE_RADIUS = 200
  const CONTACT_RADIUS = 180

  // Distribute categories evenly around center
  const catAngleStep = (2 * Math.PI) / categoryKeys.length
  // Start from top (-π/2) to put first category above center
  const catAngleStart = -Math.PI / 2

  categoryKeys.forEach((cat, catIndex) => {
    const catContacts = byCategory[cat]
    const catAngle = catAngleStart + catIndex * catAngleStep
    const catX = Math.cos(catAngle) * CATEGORY_RADIUS
    const catY = Math.sin(catAngle) * CATEGORY_RADIUS
    const catId = `cat-${cat}`
    const catColor = DEFAULT_CATEGORY_COLORS[cat] ?? '#666'

    nodes.push({
      id: catId,
      type: 'category',
      position: { x: catX - 65, y: catY - 25 },
      data: { category: cat, count: catContacts.length },
    })
    edges.push({
      id: `root->${catId}`,
      source: 'root',
      target: catId,
      style: { stroke: catColor, strokeWidth: 2.5, opacity: 0.35 },
      type: 'straight',
    })

    // Group by warmth: it applies to every relationship, whatever the type
    const groups: Record<string, Contact[]> = {}
    for (const c of catContacts) {
      const key = c.warmth || 'Not rated'
      if (!groups[key]) groups[key] = []
      groups[key].push(c)
    }

    const groupKeys = Object.keys(groups).sort((a, b) => WARMTH_ORDER.indexOf(a) - WARMTH_ORDER.indexOf(b))
    // Stages fan out in a sub-arc centered on the category's outward direction
    const arcSpread = Math.min(catAngleStep * 0.8, Math.PI * 0.5)
    const stageAngleStart = catAngle - arcSpread / 2
    const stageAngleStep = groupKeys.length > 1 ? arcSpread / (groupKeys.length - 1) : 0

    groupKeys.forEach((groupName, stageIndex) => {
      const groupContacts = groups[groupName]
      const stageAngle = groupKeys.length === 1
        ? catAngle
        : stageAngleStart + stageIndex * stageAngleStep
      const stageX = catX + Math.cos(stageAngle) * STAGE_RADIUS
      const stageY = catY + Math.sin(stageAngle) * STAGE_RADIUS
      const stageId = `${catId}-${groupName}`

      nodes.push({
        id: stageId,
        type: 'stage',
        position: { x: stageX - 55, y: stageY - 20 },
        data: { label: groupName, count: groupContacts.length, color: catColor },
      })
      edges.push({
        id: `${catId}->${stageId}`,
        source: catId,
        target: stageId,
        style: { stroke: catColor, strokeWidth: 1.5, opacity: 0.25 },
        type: 'straight',
      })

      // Contacts spread in a fan around each stage
      const contactArcSpread = Math.min(
        stageAngleStep > 0 ? stageAngleStep * 0.8 : arcSpread * 0.6,
        Math.PI * 0.4
      )
      const contactAngleStart = stageAngle - contactArcSpread / 2
      const contactAngleStep = groupContacts.length > 1
        ? contactArcSpread / (groupContacts.length - 1)
        : 0

      groupContacts.forEach((contact, contactIndex) => {
        const contactAngle = groupContacts.length === 1
          ? stageAngle
          : contactAngleStart + contactIndex * contactAngleStep
        const contactX = stageX + Math.cos(contactAngle) * CONTACT_RADIUS
        const contactY = stageY + Math.sin(contactAngle) * CONTACT_RADIUS
        const contactNodeId = `contact-${contact.id}`

        nodes.push({
          id: contactNodeId,
          type: 'contact',
          position: { x: contactX - 70, y: contactY - 22 },
          data: {
            name: contact.name,
            org: contact.org,
            warmth: contact.warmth,
            priority: contact.priority,
            contactId: contact.id,
          },
        })
        edges.push({
          id: `${stageId}->${contactNodeId}`,
          source: stageId,
          target: contactNodeId,
          style: { stroke: '#333', strokeWidth: 1, opacity: 0.15 },
          type: 'straight',
        })
      })
    })
  })

  return { nodes, edges }
}

export default function MapClient() {
  const { contacts, loading } = useContacts()
  const router = useRouter()

  // Every type in use, so types you add yourself appear too
  const allCategories = useMemo(
    () => [...new Set(contacts.map((c) => c.category))].sort(),
    [contacts]
  )

  // Type filter toggles (tracks hidden types, so new types show by default)
  const [hiddenCategories, setHiddenCategories] = useState<Set<string>>(new Set())
  const visibleCategories = useMemo(
    () => new Set(allCategories.filter((c) => !hiddenCategories.has(c))),
    [allCategories, hiddenCategories]
  )

  const toggleCategory = (cat: string) => {
    setHiddenCategories((prev) => {
      const next = new Set(prev)
      if (next.has(cat)) {
        next.delete(cat)
      } else {
        next.add(cat)
      }
      return next
    })
  }

  // Build and layout graph
  const { layoutNodes, layoutEdges } = useMemo(() => {
    if (!contacts.length) return { layoutNodes: [], layoutEdges: [] }
    const { nodes, edges } = buildRadialGraph(contacts, visibleCategories)
    return { layoutNodes: nodes, layoutEdges: edges }
  }, [contacts, visibleCategories])

  const [nodes, setNodes, onNodesChange] = useNodesState(layoutNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(layoutEdges)

  // Sync when layoutNodes/layoutEdges change (filter toggles)
  useMemo(() => {
    setNodes(layoutNodes)
    setEdges(layoutEdges)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutNodes, layoutEdges])

  // Click contact node → navigate
  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      if (node.type === 'contact') {
        const contactId = (node.data as Record<string, unknown>).contactId as string
        if (contactId) router.push(`/contacts/${contactId}`)
      }
    },
    [router]
  )

  const pillStyle = (cat: string, active: boolean): React.CSSProperties => ({
    padding: '4px 12px',
    borderRadius: 20,
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    border: `1px solid ${DEFAULT_CATEGORY_COLORS[cat] ?? '#555'}`,
    background: active ? (DEFAULT_CATEGORY_COLORS[cat] ?? '#555') : 'transparent',
    color: active ? '#fff' : (DEFAULT_CATEGORY_COLORS[cat] ?? '#999'),
    transition: 'all 0.15s',
  })

  return (
    <AuthGuard>
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
        <Header />

        {/* Filter bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 20px',
            borderBottom: '1px solid var(--bg-card)',
            flexWrap: 'wrap',
          }}
        >
          <span style={{ color: 'var(--text-muted)', fontSize: 12, marginRight: 4 }}>Filter:</span>
          {allCategories.map((cat) => (
            <button
              key={cat}
              className="btn-press"
              onClick={() => toggleCategory(cat)}
              style={pillStyle(cat, visibleCategories.has(cat))}
            >
              {cat}
            </button>
          ))}
          <span style={{ color: 'var(--text-faint)', fontSize: 11, marginLeft: 'auto' }}>
            {contacts.length} contacts · {nodes.length} nodes
          </span>
        </div>

        {/* Graph area */}
        <div style={{ flex: 1, position: 'relative' }}>
          {loading ? (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--text-muted)',
              }}
            >
              Loading contacts…
            </div>
          ) : (
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeClick={onNodeClick}
              nodeTypes={nodeTypes}
              fitView
              fitViewOptions={{ padding: 0.15 }}
              minZoom={0.05}
              maxZoom={2}
              proOptions={{ hideAttribution: true }}
              style={{ background: 'var(--bg-primary)' }}
            >
              <Controls
                position="bottom-left"
                style={{ background: 'var(--bg-card)', border: '1px solid var(--hover-medium)', borderRadius: 8 }}
              />
              <MiniMap
                nodeColor={(node) => {
                  if (node.type === 'category') {
                    const cat = (node.data as Record<string, unknown>).category as string
                    return DEFAULT_CATEGORY_COLORS[cat] ?? '#555'
                  }
                  return '#333'
                }}
                style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 8 }}
                maskColor="rgba(0,0,0,0.7)"
              />
              <Background variant={BackgroundVariant.Cross} gap={24} size={3} color="rgba(255,255,255,0.03)" />
            </ReactFlow>
          )}
        </div>
      </div>
    </AuthGuard>
  )
}
