'use client'

import { useState, useMemo } from 'react'
import { DragDropContext, type DropResult } from '@hello-pangea/dnd'
import AuthGuard from '@/components/AuthGuard'
import Header from '@/components/Header'
import KanbanColumn from '@/components/KanbanColumn'
import { useTasks } from '@/hooks/useTasks'
import { useToast } from '@/hooks/useToast'
import type { Task, TaskStatus, TaskPriority } from '@/lib/types'

const COLUMN_ORDER: TaskStatus[] = ['pending', 'in_progress', 'completed', 'cancelled']

const PRIORITY_FILTER_OPTIONS: { value: '' | TaskPriority; label: string }[] = [
  { value: '', label: 'All priorities' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
]

export default function TasksClient() {
  const { tasks, loading, error, updateTaskStatus, deleteTask, overdueTasks } = useTasks({ limit: 500 })
  const { toast } = useToast()

  // Filters
  const [priorityFilter, setPriorityFilter] = useState<'' | TaskPriority>('')
  const [search, setSearch] = useState('')

  // Apply filters
  const filtered = useMemo(() => {
    let result = tasks
    if (priorityFilter) {
      result = result.filter((t) => t.priority === priorityFilter)
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          t.contacts?.name?.toLowerCase().includes(q) ||
          t.contacts?.org?.toLowerCase().includes(q) ||
          t.profiles?.full_name?.toLowerCase().includes(q)
      )
    }
    return result
  }, [tasks, priorityFilter, search])

  // Group by status
  const columns: Record<TaskStatus, Task[]> = useMemo(() => {
    const groups: Record<TaskStatus, Task[]> = {
      pending: [],
      in_progress: [],
      completed: [],
      cancelled: [],
    }
    for (const task of filtered) {
      if (groups[task.status]) {
        groups[task.status].push(task)
      }
    }
    return groups
  }, [filtered])

  // Delete handler
  const handleDelete = async (taskId: string) => {
    const { error: deleteError } = await deleteTask(taskId)
    if (deleteError) {
      toast({ title: 'Failed to delete task', type: 'error' })
    }
  }

  // Drag handler
  const handleDragEnd = async (result: DropResult) => {
    const { draggableId, destination, source } = result
    if (!destination) return
    if (destination.droppableId === source.droppableId && destination.index === source.index) return

    const newStatus = destination.droppableId as TaskStatus
    const { error: updateError } = await updateTaskStatus(draggableId, newStatus)
    if (updateError) {
      toast({ title: 'Failed to update task status', type: 'error' })
    }
  }

  const selectStyle: React.CSSProperties = {
    background: 'var(--bg-card)',
    border: '1px solid var(--hover-medium)',
    borderRadius: 6,
    color: 'var(--text-soft, #ccc)',
    fontSize: 13,
    padding: '6px 10px',
    outline: 'none',
    cursor: 'pointer',
  }

  return (
    <AuthGuard>
      <div style={{ minHeight: '100vh' }}>
        <Header />

        <div style={{ maxWidth: 1400, margin: '0 auto', padding: '24px 20px' }}>
          {/* Page heading + stats */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 20,
              flexWrap: 'wrap',
              gap: 12,
            }}
          >
            <div>
              <h1 className="text-gradient" style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Tasks</h1>
              <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '4px 0 0' }}>
                {tasks.length} total tasks
                {overdueTasks.length > 0 && (
                  <span style={{ color: 'var(--danger)', marginLeft: 8 }}>
                    · {overdueTasks.length} overdue
                  </span>
                )}
              </p>
            </div>
          </div>

          {/* Filter bar */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              marginBottom: 20,
              flexWrap: 'wrap',
            }}
          >
            <input
              type="text"
              placeholder="Search tasks, contacts…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                ...selectStyle,
                width: 220,
                padding: '7px 12px',
              }}
            />

            <select
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value as '' | TaskPriority)}
              style={selectStyle}
            >
              {PRIORITY_FILTER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>

            {(priorityFilter || search) && (
              <button
                onClick={() => {
                  setPriorityFilter('')
                  setSearch('')
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--accent)',
                  fontSize: 12,
                  cursor: 'pointer',
                  padding: '4px 8px',
                }}
              >
                Clear filters
              </button>
            )}

            <span style={{ fontSize: 12, color: 'var(--text-faint)', marginLeft: 'auto' }}>
              {filtered.length} of {tasks.length} shown
            </span>
          </div>

          {/* Loading / Error states */}
          {loading && (
            <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 40 }}>
              Loading tasks…
            </div>
          )}

          {error && (
            <div
              style={{
                color: 'var(--danger)',
                background: 'rgba(196,78,82,0.1)',
                padding: '12px 16px',
                borderRadius: 8,
                marginBottom: 16,
                fontSize: 13,
              }}
            >
              {error}
            </div>
          )}

          {/* Kanban board */}
          {!loading && (
            <DragDropContext onDragEnd={handleDragEnd}>
              <div
                style={{
                  display: 'flex',
                  gap: 16,
                  overflowX: 'auto',
                  paddingBottom: 20,
                }}
              >
                {COLUMN_ORDER.map((status) => (
                  <KanbanColumn
                    key={status}
                    status={status}
                    tasks={columns[status]}
                    onDelete={handleDelete}
                  />
                ))}
              </div>
            </DragDropContext>
          )}
        </div>
      </div>
    </AuthGuard>
  )
}
