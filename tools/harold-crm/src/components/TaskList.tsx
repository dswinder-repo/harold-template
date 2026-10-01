'use client'

import { useState } from 'react'
import type { Task, TaskPriority } from '@/lib/types'
import { getTaskPriorityStyle } from '@/lib/types'
import { useEnumOptions } from '@/hooks/useEnumOptions'
import { useShowMore } from '@/hooks/useShowMore'
import ShowMoreButton from './ShowMoreButton'
import { formatRelativeTime, getDueDateInfo } from '@/lib/utils'

interface TaskListProps {
  tasks: Task[]
  loading: boolean
  onAdd: (input: {
    title: string
    description?: string
    priority?: TaskPriority
    dueDate?: string
  }) => Promise<{ error?: unknown }>
  onUpdate: (taskId: string, updates: {
    title?: string
    description?: string
    priority?: TaskPriority
    dueDate?: string | null
  }) => Promise<{ error?: unknown }>
  onToggleComplete: (taskId: string, completed: boolean) => Promise<{ error?: unknown }>
  onDelete: (id: string) => Promise<{ error?: unknown }>
}

export default function TaskList({
  tasks,
  loading,
  onAdd,
  onUpdate,
  onToggleComplete,
  onDelete,
}: TaskListProps) {
  const [showForm, setShowForm] = useState(false)
  const [formTitle, setFormTitle] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formPriority, setFormPriority] = useState<TaskPriority>('medium')
  const [formDueDate, setFormDueDate] = useState('')
  const [saving, setSaving] = useState(false)
  const { getOptions } = useEnumOptions()
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editPriority, setEditPriority] = useState<TaskPriority>('medium')
  const [editDueDate, setEditDueDate] = useState('')
  const [editSaving, setEditSaving] = useState(false)

  const startEdit = (task: Task) => {
    setEditingId(task.id)
    setEditTitle(task.title)
    setEditDescription(task.description ?? '')
    setEditPriority(task.priority)
    setEditDueDate(task.due_date ? new Date(task.due_date).toISOString().slice(0, 16) : '')
    setDeleteConfirm(null)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditTitle('')
    setEditDescription('')
    setEditPriority('medium')
    setEditDueDate('')
  }

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingId || !editTitle.trim()) return

    setEditSaving(true)
    const { error } = await onUpdate(editingId, {
      title: editTitle.trim(),
      description: editDescription.trim(),
      priority: editPriority,
      dueDate: editDueDate || null,
    })

    if (!error) {
      cancelEdit()
    }
    setEditSaving(false)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formTitle.trim()) return

    setSaving(true)
    const { error } = await onAdd({
      title: formTitle.trim(),
      description: formDescription.trim(),
      priority: formPriority,
      dueDate: formDueDate || undefined,
    })

    if (!error) {
      setFormTitle('')
      setFormDescription('')
      setFormPriority('medium')
      setFormDueDate('')
      setShowForm(false)
    }
    setSaving(false)
  }

  const inputStyle = {
    background: 'var(--bg-input)',
    color: 'var(--text-primary)',
    border: '1px solid var(--border-input)',
  }

  // Separate open vs completed tasks
  const openTasks = tasks.filter((t) => t.status !== 'completed' && t.status !== 'cancelled')
  const completedTasks = tasks.filter((t) => t.status === 'completed')

  const { visible: visibleOpen, hasMore: hasMoreOpen, hiddenCount: hiddenOpen, showMore: showMoreOpen, showAll: showAllOpen } = useShowMore(openTasks)
  const { visible: visibleCompleted, hasMore: hasMoreCompleted, hiddenCount: hiddenCompleted, showMore: showMoreCompleted, showAll: showAllCompleted } = useShowMore(completedTasks, { initialSize: 5, pageSize: 5 })

  return (
    <div>
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
          Tasks
        </h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="rounded-md px-3 py-1 text-xs transition-colors"
          style={{
            background: showForm ? 'rgba(196,78,82,0.2)' : 'rgba(76,114,176,0.2)',
            color: showForm ? 'var(--danger)' : 'var(--accent)',
            border: 'none',
            cursor: 'pointer',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = showForm
              ? 'rgba(196,78,82,0.3)'
              : 'rgba(76,114,176,0.3)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = showForm
              ? 'rgba(196,78,82,0.2)'
              : 'rgba(76,114,176,0.2)'
          }}
        >
          {showForm ? 'Cancel' : '+ Add Task'}
        </button>
      </div>

      {/* Add task form */}
      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="mb-4 rounded-lg p-4"
          style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-subtle)' }}
        >
          <input
            type="text"
            placeholder="Task title (e.g. Follow up with Rick about Series A)"
            value={formTitle}
            onChange={(e) => setFormTitle(e.target.value)}
            className="mb-2 w-full rounded-md px-3 py-1.5 text-sm outline-none"
            style={inputStyle}
            autoFocus
          />

          <textarea
            placeholder="Details (optional)"
            value={formDescription}
            onChange={(e) => setFormDescription(e.target.value)}
            rows={2}
            className="mb-2 w-full rounded-md px-3 py-1.5 text-sm outline-none"
            style={inputStyle}
          />

          <div className="flex items-center gap-3 flex-wrap">
            {/* Priority */}
            <div className="flex items-center gap-2">
              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Priority:</span>
              <div className="flex gap-1">
                {getOptions('priority').map((p) => {
                  const style = getTaskPriorityStyle(p)
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setFormPriority(p as TaskPriority)}
                      className="rounded-full px-2.5 py-0.5 text-xs transition-colors"
                      style={{
                        background: formPriority === p ? style.bg : 'transparent',
                        color: formPriority === p ? style.color : 'var(--text-faint)',
                        border: `1px solid ${formPriority === p ? style.color : 'var(--border-subtle)'}`,
                        cursor: 'pointer',
                      }}
                    >
                      {p.charAt(0).toUpperCase() + p.slice(1)}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Due date */}
            <input
              type="datetime-local"
              value={formDueDate}
              onChange={(e) => setFormDueDate(e.target.value)}
              className="rounded-md px-3 py-1.5 text-xs outline-none"
              style={{ ...inputStyle, flex: '0 0 auto' }}
              title="Due date (optional)"
            />

            <div className="flex-1" />

            <button
              type="submit"
              disabled={saving || !formTitle.trim()}
              className="rounded-md px-4 py-1.5 text-sm font-medium transition-colors"
              style={{
                background: 'var(--accent)',
                color: '#ffffff',
                border: 'none',
                cursor: saving ? 'wait' : 'pointer',
                opacity: saving || !formTitle.trim() ? 0.5 : 1,
              }}
            >
              {saving ? 'Saving...' : 'Add Task'}
            </button>
          </div>
        </form>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-10">
          <div
            className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-solid border-current border-r-transparent"
            style={{ color: 'var(--accent)' }}
          />
        </div>
      )}

      {/* Empty state */}
      {!loading && tasks.length === 0 && (
        <div className="micro-fade-in flex flex-col items-center py-8">
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            {/* Rounded square checkbox */}
            <rect x="8" y="8" width="32" height="32" rx="6" stroke="var(--text-faint)" strokeWidth="2" fill="none" />
            {/* Self-drawing checkmark */}
            <path
              d="M16 24l6 6 10-12"
              stroke="var(--text-faint)"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
              strokeDasharray="32"
              strokeDashoffset="32"
              style={{ animation: 'empty-state-draw 0.8s ease-out 0.3s forwards' }}
            />
          </svg>
          <p className="mt-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
            No tasks yet. Click &quot;+ Add Task&quot; to create one.
          </p>
        </div>
      )}

      {/* Open tasks */}
      {!loading && openTasks.length > 0 && (
        <div className="flex flex-col gap-2">
          {visibleOpen.map((task) => {
            const priorityStyle = getTaskPriorityStyle(task.priority)
            const dueInfo = getDueDateInfo(task.due_date)
            const isEditing = editingId === task.id

            if (isEditing) {
              return (
                <form
                  key={task.id}
                  onSubmit={handleEditSubmit}
                  className="rounded-md p-3"
                  style={{ background: 'var(--bg-primary)', border: '1px solid var(--accent)' }}
                >
                  <input
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="mb-2 w-full rounded-md px-3 py-1.5 text-sm outline-none"
                    style={inputStyle}
                    autoFocus
                  />
                  <textarea
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    rows={2}
                    placeholder="Details (optional)"
                    className="mb-2 w-full rounded-md px-3 py-1.5 text-sm outline-none"
                    style={inputStyle}
                  />
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="flex items-center gap-2">
                      <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Priority:</span>
                      <div className="flex gap-1">
                        {getOptions('priority').map((p) => {
                          const style = getTaskPriorityStyle(p)
                          return (
                            <button
                              key={p}
                              type="button"
                              onClick={() => setEditPriority(p as TaskPriority)}
                              className="rounded-full px-2.5 py-0.5 text-xs transition-colors"
                              style={{
                                background: editPriority === p ? style.bg : 'transparent',
                                color: editPriority === p ? style.color : 'var(--text-faint)',
                                border: `1px solid ${editPriority === p ? style.color : 'var(--border-subtle)'}`,
                                cursor: 'pointer',
                              }}
                            >
                              {p.charAt(0).toUpperCase() + p.slice(1)}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                    <input
                      type="datetime-local"
                      value={editDueDate}
                      onChange={(e) => setEditDueDate(e.target.value)}
                      className="rounded-md px-3 py-1.5 text-xs outline-none"
                      style={{ ...inputStyle, flex: '0 0 auto' }}
                    />
                    <div className="flex-1" />
                    <button
                      type="button"
                      onClick={cancelEdit}
                      className="rounded-md px-3 py-1.5 text-xs"
                      style={{ background: 'var(--hover-light)', color: 'var(--text-secondary)', border: 'none', cursor: 'pointer' }}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={editSaving || !editTitle.trim()}
                      className="rounded-md px-4 py-1.5 text-sm font-medium transition-colors"
                      style={{
                        background: 'var(--accent)',
                        color: '#ffffff',
                        border: 'none',
                        cursor: editSaving ? 'wait' : 'pointer',
                        opacity: editSaving || !editTitle.trim() ? 0.5 : 1,
                      }}
                    >
                      {editSaving ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                </form>
              )
            }

            return (
              <div
                key={task.id}
                className="group flex items-start gap-3 rounded-md p-3 transition-colors"
                style={{ background: 'var(--hover-faint)' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--hover-subtle)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--hover-faint)' }}
              >
                {/* Checkbox */}
                <button
                  onClick={() => onToggleComplete(task.id, true)}
                  className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border transition-colors"
                  style={{
                    borderColor: 'var(--border-input)',
                    background: 'transparent',
                    cursor: 'pointer',
                    color: 'transparent',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'var(--success)'
                    e.currentTarget.style.color = 'var(--success)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'var(--border-input)'
                    e.currentTarget.style.color = 'transparent'
                  }}
                  title="Mark complete"
                >
                  {'\u2713'}
                </button>

                {/* Content — double-click to edit */}
                <div className="flex-1 min-w-0 cursor-pointer" onDoubleClick={() => startEdit(task)}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                      {task.title}
                    </span>
                    <span
                      className="rounded-full px-2 py-0.5 text-xs"
                      style={{ background: priorityStyle.bg, color: priorityStyle.color }}
                    >
                      {task.priority}
                    </span>
                  </div>
                  {task.description && (
                    <p className="mt-0.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {task.description}
                    </p>
                  )}
                  <div className="mt-1 flex items-center gap-2 text-xs" style={{ color: 'var(--text-faint)' }}>
                    {dueInfo && (
                      <>
                        <span style={{ color: dueInfo.color, fontWeight: dueInfo.overdue ? 600 : 400 }}>
                          {dueInfo.overdue ? '\u26A0 ' : ''}{dueInfo.label}
                        </span>
                        <span>&middot;</span>
                      </>
                    )}
                    <span>Created {formatRelativeTime(task.created_at)}</span>
                  </div>
                </div>

                {/* Edit + Delete buttons */}
                {deleteConfirm === task.id ? (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => { onDelete(task.id); setDeleteConfirm(null) }}
                      className="rounded px-2 py-0.5 text-xs"
                      style={{ background: 'var(--danger)', color: '#ffffff', border: 'none', cursor: 'pointer' }}
                    >
                      Yes
                    </button>
                    <button
                      onClick={() => setDeleteConfirm(null)}
                      className="rounded px-2 py-0.5 text-xs"
                      style={{ background: 'var(--hover-light)', color: 'var(--text-primary)', border: 'none', cursor: 'pointer' }}
                    >
                      No
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      onClick={() => startEdit(task)}
                      className="flex-shrink-0 rounded-md px-2 py-1 text-xs"
                      style={{
                        background: 'rgba(76,114,176,0.15)',
                        color: 'var(--accent)',
                        border: 'none',
                        cursor: 'pointer',
                      }}
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => setDeleteConfirm(task.id)}
                      className="flex-shrink-0 rounded-md px-2 py-1 text-xs"
                      style={{
                        background: 'rgba(196,78,82,0.15)',
                        color: 'var(--danger)',
                        border: 'none',
                        cursor: 'pointer',
                      }}
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            )
          })}
          {hasMoreOpen && <ShowMoreButton hiddenCount={hiddenOpen} pageSize={10} onShowMore={showMoreOpen} onShowAll={showAllOpen} />}
        </div>
      )}

      {/* Completed tasks */}
      {!loading && completedTasks.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 text-xs font-medium" style={{ color: 'var(--text-faint)' }}>
            Completed ({completedTasks.length})
          </div>
          <div className="flex flex-col gap-1">
            {visibleCompleted.map((task) => (
              <div
                key={task.id}
                className="group flex items-center gap-3 rounded-md px-3 py-2"
                style={{ background: 'var(--hover-faint)' }}
              >
                {/* Completed checkbox */}
                <button
                  onClick={() => onToggleComplete(task.id, false)}
                  className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border text-xs"
                  style={{
                    borderColor: 'var(--success)',
                    background: 'rgba(85,168,104,0.2)',
                    color: 'var(--success)',
                    cursor: 'pointer',
                  }}
                  title="Mark incomplete"
                >
                  {'\u2713'}
                </button>
                <span className="text-sm line-through" style={{ color: 'var(--text-faint)' }}>
                  {task.title}
                </span>
                {task.completed_at && (
                  <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
                    {formatRelativeTime(task.completed_at)}
                  </span>
                )}
              </div>
            ))}
            {hasMoreCompleted && <ShowMoreButton hiddenCount={hiddenCompleted} pageSize={5} onShowMore={showMoreCompleted} onShowAll={showAllCompleted} />}
          </div>
        </div>
      )}
    </div>
  )
}
