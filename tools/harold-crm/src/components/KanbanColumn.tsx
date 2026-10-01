'use client'

import { Droppable, Draggable } from '@hello-pangea/dnd'
import type { Task, TaskStatus } from '@/lib/types'
import { useShowMore } from '@/hooks/useShowMore'
import ShowMoreButton from './ShowMoreButton'
import KanbanCard from './KanbanCard'

const STATUS_META: Record<TaskStatus, { label: string; color: string; accent: string }> = {
  pending:     { label: 'Pending',     color: '#ffc107', accent: 'rgba(255,193,7,0.25)' },
  in_progress: { label: 'In Progress', color: '#4C72B0', accent: 'rgba(76,114,176,0.25)' },
  completed:   { label: 'Completed',   color: '#55A868', accent: 'rgba(85,168,104,0.25)' },
  cancelled:   { label: 'Cancelled',   color: '#777',    accent: 'rgba(120,120,120,0.2)' },
}

interface KanbanColumnProps {
  status: TaskStatus
  tasks: Task[]
  onDelete?: (taskId: string) => void
}

export default function KanbanColumn({ status, tasks, onDelete }: KanbanColumnProps) {
  const meta = STATUS_META[status]
  const { visible: visibleTasks, hasMore, hiddenCount, showMore, showAll } = useShowMore(tasks)

  return (
    <div
      style={{
        flex: '1 1 0',
        minWidth: 260,
        maxWidth: 340,
        display: 'flex',
        flexDirection: 'column',
        gap: 0,
      }}
    >
      {/* Column header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          marginBottom: 8,
          borderRadius: 8,
          background: meta.accent,
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: meta.color,
            flexShrink: 0,
          }}
        />
        <span style={{ fontSize: 13, fontWeight: 600, color: meta.color }}>
          {meta.label}
        </span>
        <span
          style={{
            fontSize: 11,
            color: 'var(--text-muted)',
            marginLeft: 'auto',
            fontWeight: 500,
          }}
        >
          {tasks.length}
        </span>
      </div>

      {/* Droppable area */}
      <Droppable droppableId={status}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              padding: 4,
              borderRadius: 8,
              minHeight: 80,
              transition: 'background 0.15s',
              background: snapshot.isDraggingOver ? 'rgba(76,114,176,0.08)' : 'transparent',
            }}
          >
            {tasks.length === 0 && (
              <div
                className="micro-fade-in"
                style={{
                  border: '2px dashed var(--text-faint)',
                  borderRadius: 8,
                  padding: '20px 12px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minHeight: 60,
                  animation: 'empty-state-dashed-pulse 2.5s ease-in-out infinite',
                }}
              >
                <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>
                  Drop tasks here
                </span>
              </div>
            )}
            {visibleTasks.map((task, index) => (
              <Draggable key={task.id} draggableId={task.id} index={index}>
                {(dragProvided, dragSnapshot) => (
                  <div
                    ref={dragProvided.innerRef}
                    {...dragProvided.draggableProps}
                    {...dragProvided.dragHandleProps}
                    style={{
                      ...dragProvided.draggableProps.style,
                      opacity: dragSnapshot.isDragging ? 0.85 : 1,
                      transform: dragProvided.draggableProps.style?.transform,
                    }}
                  >
                    <KanbanCard task={task} onDelete={onDelete} />
                  </div>
                )}
              </Draggable>
            ))}
            {provided.placeholder}
            {hasMore && <ShowMoreButton hiddenCount={hiddenCount} onShowMore={showMore} onShowAll={showAll} />}
          </div>
        )}
      </Droppable>
    </div>
  )
}
