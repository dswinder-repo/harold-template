'use client'

import { useRef, useEffect, useState } from 'react'
import { Droppable, Draggable } from '@hello-pangea/dnd'
import type { Contact } from '@/lib/types'
import PipelineCard from '@/components/PipelineCard'

interface PipelineColumnProps {
  stageName: string
  stageOrder: number
  contacts: Contact[]
  onSelectContact?: (contactId: string) => void
  /** Set by parent after a successful drag-drop into this column */
  celebrating?: boolean
  /** Show quick-advance arrow button on cards in this column */
  showQuickAdvance?: boolean
  /** Called with the pipeline entry id and the stage it is in */
  onQuickAdvance?: (entryId: string, currentStage: string) => void
}

const STAGE_COLORS: Record<string, string> = {
  Identified: '#8da0cb',
  'Reached Out': '#4C72B0',
  'In Conversation': '#14B8A6',
  Advancing: '#DD8452',
  Committed: '#ffc107',
  Active: '#55a868',
  Dormant: '#777777',
}

export default function PipelineColumn({
  stageName,
  stageOrder: _stageOrder,
  contacts,
  onSelectContact,
  celebrating = false,
  showQuickAdvance = false,
  onQuickAdvance,
}: PipelineColumnProps) {
  void _stageOrder // kept for future ordering logic
  const accentColor = STAGE_COLORS[stageName] ?? '#555'

  // ── Feature 3: Count badge pulse on change ────────────────────────────────
  const prevCountRef = useRef<number>(contacts.length)
  const [countPulsing, setCountPulsing] = useState(false)

  useEffect(() => {
    if (contacts.length !== prevCountRef.current) {
      prevCountRef.current = contacts.length
      setCountPulsing(true)
    }
  }, [contacts.length])

  const handleCountAnimationEnd = () => {
    setCountPulsing(false)
  }

  // ── Feature 14: Celebration flash ────────────────────────────────────────
  // `celebrating` prop is controlled by the parent; we apply the CSS class
  // whenever it is truthy. The parent clears it after a timeout.

  return (
    <div
      style={{
        minWidth: 240,
        maxWidth: 280,
        flex: '1 1 240px',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
      }}
    >
      {/* Column header — receives both the count-pulse and the celebrate-flash */}
      <div
        className={celebrating ? 'animate-celebrate-flash' : undefined}
        style={{
          padding: '10px 12px',
          borderBottom: `2px solid ${accentColor}`,
          marginBottom: 8,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderRadius: '4px 4px 0 0',
        }}
      >
        <span style={{ color: 'var(--text-primary)', fontSize: 13, fontWeight: 600 }}>
          {stageName}
        </span>

        {/* Feature 3: count badge with pulse animation */}
        <span
          className={countPulsing ? 'animate-count-pulse' : undefined}
          onAnimationEnd={handleCountAnimationEnd}
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: accentColor,
            background: `${accentColor}20`,
            padding: '2px 8px',
            borderRadius: 10,
            display: 'inline-block', // required for transform to work on inline elements
          }}
        >
          {contacts.length}
        </span>
      </div>

      {/* Droppable area */}
      <Droppable droppableId={stageName}>
        {(provided, snapshot) => {
          // ── Feature 8: drag-over glow ───────────────────────────────────
          // Build a box-shadow using the stage accent color when a card hovers over this column.
          const glowShadow = snapshot.isDraggingOver
            ? `0 0 0 2px ${accentColor}55, 0 0 16px 2px ${accentColor}33`
            : 'none'

          return (
            <div
              ref={provided.innerRef}
              {...provided.droppableProps}
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: '0 2px',
                background: snapshot.isDraggingOver
                  ? `${accentColor}0d` // ~5% opacity tint
                  : 'transparent',
                borderRadius: 6,
                // Feature 8: smooth glow transition
                boxShadow: glowShadow,
                transition: 'background 0.2s ease, box-shadow 0.2s ease',
                minHeight: 60,
              }}
            >
              {/* One card per pipeline entry; the draggable id is the entry id */}
              {contacts.map((contact, index) => (
                <Draggable
                  key={contact.pipeline_entry_id ?? contact.id}
                  draggableId={contact.pipeline_entry_id ?? contact.id}
                  index={index}
                >
                  {(dragProvided, dragSnapshot) => (
                    <div
                      ref={dragProvided.innerRef}
                      {...dragProvided.draggableProps}
                      {...dragProvided.dragHandleProps}
                      style={{
                        marginBottom: 8,
                        opacity: dragSnapshot.isDragging ? 0.8 : 1,
                        ...dragProvided.draggableProps.style,
                      }}
                    >
                      <PipelineCard
                        contact={contact}
                        onSelect={onSelectContact}
                        showQuickAdvance={showQuickAdvance}
                        onQuickAdvance={onQuickAdvance ? (id) => onQuickAdvance(id, stageName) : undefined}
                      />
                    </div>
                  )}
                </Draggable>
              ))}
              {provided.placeholder}
            </div>
          )
        }}
      </Droppable>
    </div>
  )
}
