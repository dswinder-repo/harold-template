'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Task, TaskStatus, TaskPriority } from '@/lib/types'
import { isOverdueDate } from '@/lib/utils'

interface UseTasksOptions {
  contactId?: string
  limit?: number
}

const SELECT_QUERY = `
  *,
  profiles:assigned_to ( id, full_name, email, avatar_url ),
  contacts:contact_id ( id, name, org )
`

export function useTasks({ contactId, limit = 100 }: UseTasksOptions = {}) {
  const supabase = createClient()
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  const fetchTasks = useCallback(async () => {
    setLoading(true)
    setError(null)

    let query = supabase
      .from('tasks')
      .select(SELECT_QUERY)
      .is('archived_at', null)                    // exclude soft-archived tasks
      .order('status', { ascending: true })      // pending first, completed last
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(limit)

    if (contactId) {
      query = query.eq('contact_id', contactId)
    }

    const { data, error: fetchError } = await query

    if (fetchError) {
      setError(fetchError.message)
      setTasks([])
    } else {
      setTasks((data ?? []) as Task[])
    }
    setLoading(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- supabase is a module-level singleton
  }, [contactId, limit])

  // Initial fetch
  useEffect(() => {
    fetchTasks()
  }, [fetchTasks])

  // Realtime subscription
  useEffect(() => {
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current)
    }

    const filter = contactId ? `contact_id=eq.${contactId}` : undefined

    const channel = supabase
      .channel(`tasks-${contactId ?? 'all'}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tasks',
          ...(filter ? { filter } : {}),
        },
        async (payload: { eventType: string; new: Record<string, unknown>; old: Record<string, unknown> }) => {
          if (payload.eventType === 'DELETE') {
            setTasks((prev) => prev.filter((t) => t.id !== (payload.old as unknown as { id: string }).id))
            return
          }

          // For INSERT or UPDATE, fetch the full entry with joins
          const { data } = await supabase
            .from('tasks')
            .select(SELECT_QUERY)
            .eq('id', (payload.new as unknown as { id: string }).id)
            .single()

          if (data) {
            const task = data as Task
            setTasks((prev) => {
              const exists = prev.find((t) => t.id === task.id)
              if (exists) {
                return prev.map((t) => (t.id === task.id ? task : t))
              }
              return [task, ...prev].slice(0, limit)
            })
          }
        }
      )
      .subscribe()

    channelRef.current = channel

    return () => {
      supabase.removeChannel(channel)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- supabase is a module-level singleton
  }, [contactId, limit])

  // Create a new task
  const createTask = async (input: {
    title: string
    description?: string
    priority?: TaskPriority
    dueDate?: string
    userId?: string
    contactId?: string
  }) => {
    const { data, error } = await supabase
      .from('tasks')
      .insert({
        contact_id: input.contactId ?? contactId ?? null,
        assigned_to: input.userId ?? null,
        created_by: input.userId ?? null,
        title: input.title,
        description: input.description ?? '',
        priority: input.priority ?? 'medium',
        due_date: input.dueDate ? new Date(input.dueDate).toISOString() : null,
      })
      .select(SELECT_QUERY)
      .single()

    if (error) return { error }
    return { data: data as Task }
  }

  // Update task status (toggle completion, etc.) — optimistic
  const updateTaskStatus = async (taskId: string, status: TaskStatus) => {
    // Optimistic: apply immediately, rollback on error
    const snapshot = tasks.find((t) => t.id === taskId)
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, status, updated_at: new Date().toISOString() } : t))
    )

    const { error } = await supabase
      .from('tasks')
      .update({ status })
      .eq('id', taskId)

    if (error && snapshot) {
      // Rollback
      setTasks((prev) => prev.map((t) => (t.id === taskId ? snapshot : t)))
    }

    return { error }
  }

  // Update a task (title, description, priority, due_date)
  const updateTask = async (
    taskId: string,
    updates: {
      title?: string
      description?: string
      priority?: TaskPriority
      dueDate?: string | null
    }
  ) => {
    const patch: Record<string, unknown> = {}
    if (updates.title !== undefined) patch.title = updates.title
    if (updates.description !== undefined) patch.description = updates.description
    if (updates.priority !== undefined) patch.priority = updates.priority
    if (updates.dueDate !== undefined) {
      patch.due_date = updates.dueDate ? new Date(updates.dueDate).toISOString() : null
    }

    // Optimistic update
    const snapshot = tasks.find((t) => t.id === taskId)
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId
          ? {
              ...t,
              ...(updates.title !== undefined && { title: updates.title }),
              ...(updates.description !== undefined && { description: updates.description }),
              ...(updates.priority !== undefined && { priority: updates.priority }),
              ...(updates.dueDate !== undefined && { due_date: updates.dueDate ? new Date(updates.dueDate).toISOString() : null }),
              updated_at: new Date().toISOString(),
            }
          : t
      )
    )

    const { error } = await supabase
      .from('tasks')
      .update(patch)
      .eq('id', taskId)

    if (error && snapshot) {
      // Rollback
      setTasks((prev) => prev.map((t) => (t.id === taskId ? snapshot : t)))
    }

    return { error }
  }

  // Delete a task
  const deleteTask = async (id: string) => {
    const { error } = await supabase
      .from('tasks')
      .delete()
      .eq('id', id)

    if (!error) {
      setTasks((prev) => prev.filter((t) => t.id !== id))
    }
    return { error }
  }

  // Computed: overdue tasks (strictly before today, not including today)
  const overdueTasks = tasks.filter(
    (t) =>
      t.status !== 'completed' &&
      t.status !== 'cancelled' &&
      isOverdueDate(t.due_date)
  )

  return {
    tasks,
    loading,
    error,
    createTask,
    updateTask,
    updateTaskStatus,
    deleteTask,
    overdueTasks,
    refetch: fetchTasks,
  }
}
