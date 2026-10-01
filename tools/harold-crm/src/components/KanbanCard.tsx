'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { Task } from '@/lib/types'
import { TASK_PRIORITY_STYLES } from '@/lib/types'
import { getDueDateInfo, isOverdueDate } from '@/lib/utils'

interface KanbanCardProps {
  task: Task
  onDelete?: (taskId: string) => void
}

export default function KanbanCard({ task, onDelete }: KanbanCardProps) {
  const dueInfo = getDueDateInfo(task.due_date)
  const [confirming, setConfirming] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [trashHovered, setTrashHovered] = useState(false)

  const isOverdue =
    task.status !== 'completed' &&
    task.status !== 'cancelled' &&
    isOverdueDate(task.due_date)

  const handleDelete = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!confirming) {
      setConfirming(true)
      // Auto-cancel confirmation after 3 seconds
      setTimeout(() => setConfirming(false), 3000)
      return
    }
    onDelete?.(task.id)
  }

  return (
    <div
      style={{
        position: 'relative',
        background: isOverdue ? 'rgba(196,78,82,0.06)' : 'var(--bg-card)',
        border: `1px solid ${hovered ? 'var(--accent)' : isOverdue ? 'rgba(196,78,82,0.4)' : 'var(--border-subtle)'}`,
        borderLeft: isOverdue ? '3px solid var(--danger)' : undefined,
        borderRadius: 8,
        padding: '10px 12px',
        cursor: 'grab',
        transition: 'border-color 0.15s, background 0.15s',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false)
        setConfirming(false)
      }}
    >
      {/* Trash button — appears on hover */}
      {onDelete && hovered && (
        <button
          onClick={handleDelete}
          onMouseEnter={() => setTrashHovered(true)}
          onMouseLeave={() => setTrashHovered(false)}
          title={confirming ? 'Click again to confirm delete' : 'Delete task'}
          style={{
            position: 'absolute',
            top: 6,
            right: 6,
            width: 22,
            height: 22,
            borderRadius: 4,
            border: 'none',
            background: confirming
              ? 'rgba(196,78,82,0.3)'
              : trashHovered
                ? 'rgba(196,78,82,0.2)'
                : 'var(--hover-subtle)',
            color: confirming ? 'var(--danger)' : trashHovered ? 'var(--danger)' : 'var(--text-muted)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
            transition: 'all 0.15s',
            zIndex: 5,
          }}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        </button>
      )}

      {/* Clickable area to navigate to contact */}
      <Link
        href={task.contacts ? `/contacts/${task.contacts.id}` : '#'}
        style={{
          display: 'block',
          textDecoration: 'none',
          color: 'inherit',
        }}
        onClick={(e) => {
          // Don't navigate if we're in confirm mode
          if (confirming) {
            e.preventDefault()
          }
        }}
      >
        {/* Title */}
        <div
          style={{
            color: 'var(--text-primary)',
            fontSize: 13,
            fontWeight: 500,
            lineHeight: 1.35,
            marginBottom: 6,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            paddingRight: hovered ? 24 : 0,
          }}
        >
          {task.title}
        </div>

        {/* Meta row: priority + due date */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              padding: '2px 6px',
              borderRadius: 4,
              color: TASK_PRIORITY_STYLES[task.priority].color,
              background: TASK_PRIORITY_STYLES[task.priority].bg,
            }}
          >
            {task.priority}
          </span>

          {dueInfo && (
            <span
              style={{
                fontSize: 11,
                color: dueInfo.color,
                fontWeight: dueInfo.overdue ? 600 : 400,
              }}
            >
              {dueInfo.label}
            </span>
          )}
        </div>

        {/* Contact + assignee row */}
        {(task.contacts || task.profiles) && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginTop: 8,
              gap: 6,
            }}
          >
            {task.contacts && (
              <span
                style={{
                  fontSize: 11,
                  color: 'var(--text-muted)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  maxWidth: '60%',
                }}
              >
                {task.contacts.name}
                {task.contacts.org ? ` · ${task.contacts.org}` : ''}
              </span>
            )}

            {task.profiles && (
              <div
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  background: 'rgba(76,114,176,0.3)',
                  color: 'var(--accent)',
                  fontSize: 9,
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
                title={task.profiles.full_name}
              >
                {task.profiles.full_name
                  .split(' ')
                  .map((n) => n[0])
                  .join('')
                  .toUpperCase()
                  .slice(0, 2)}
              </div>
            )}
          </div>
        )}
      </Link>
    </div>
  )
}
