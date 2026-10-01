'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import type { Contact, TaskPriority } from '@/lib/types'
import { STATUS_STYLES } from '@/lib/types'
import { useContactCategories } from '@/hooks/useContactCategories'
import { useCategories } from '@/hooks/useCategories'
import { createClient } from '@/lib/supabase/client'
import { useInteractions } from '@/hooks/useInteractions'
import { useTasks } from '@/hooks/useTasks'
import { useAuditLog } from '@/hooks/useAuditLog'
import { useResearch } from '@/hooks/useResearch'
import { useToast } from '@/hooks/useToast'
import InteractionTimeline from './InteractionTimeline'
import TaskList from './TaskList'
import ActivityFeed from './ActivityFeed'
import UnifiedTimeline from './UnifiedTimeline'
import ResearchButton from './ResearchButton'
import ResearchPanel from './ResearchPanel'
import OutreachButton from './OutreachButton'
import OutreachEmailPanel from './OutreachEmailPanel'
import LabelPicker from '@/components/LabelPicker'
import { PIPELINE_EMBED, withPipelineSummary } from '@/lib/pipeline'
import { useAuth } from '@/hooks/useAuth'

interface ContactSidebarProps {
  contactId: string | null
  onClose: () => void
  userId?: string
}

type TabKey = 'timeline' | 'interactions' | 'tasks' | 'activity'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'timeline', label: 'Timeline' },
  { key: 'interactions', label: 'Interactions' },
  { key: 'tasks', label: 'Tasks' },
  { key: 'activity', label: 'Activity' },
]

function SidebarContent({ contactId, userId }: { contactId: string; userId?: string }) {
  const [activeTab, setActiveTab] = useState<TabKey>('timeline')
  const sidebarTabRefs = useRef<(HTMLButtonElement | null)[]>([])
  const sidebarTabContainerRef = useRef<HTMLDivElement>(null)
  const [sidebarTabIndicator, setSidebarTabIndicator] = useState({ left: 0, width: 0 })

  useEffect(() => {
    const idx = TABS.findIndex((t) => t.key === activeTab)
    const btn = sidebarTabRefs.current[idx]
    const container = sidebarTabContainerRef.current
    if (btn && container) {
      const containerRect = container.getBoundingClientRect()
      const btnRect = btn.getBoundingClientRect()
      setSidebarTabIndicator({ left: btnRect.left - containerRect.left, width: btnRect.width })
    }
  }, [activeTab])

  const [contact, setContact] = useState<Contact | null>(null)
  const [contactLoading, setContactLoading] = useState(true)
  const [showResearchPanel, setShowResearchPanel] = useState(false)
  const [showOutreachPanel, setShowOutreachPanel] = useState(false)
  const { user, profile } = useAuth()
  const { toast } = useToast()
  const { getCategoriesForContact, toggleCategory, setPrimaryCategory } = useContactCategories(contactId)
  const { categories: allCategories, getColor, getLabel } = useCategories()

  const { interactions, loading: interactionsLoading, createInteraction, updateInteraction, deleteInteraction } =
    useInteractions({ contactId })
  const { research, loading: researchLoading, error: researchError, startResearch, clearResearch } =
    useResearch()
  const { tasks, loading: tasksLoading, createTask, updateTask, updateTaskStatus, deleteTask } =
    useTasks({ contactId })
  const { entries: auditEntries, loading: auditLoading } =
    useAuditLog({ contactId })

  // Fetch contact details
  useEffect(() => {
    const supabase = createClient()
    setContactLoading(true)
    supabase
      .from('contacts')
      .select(`*, ${PIPELINE_EMBED}`)
      .eq('id', contactId)
      .single()
      .then((result: { data: unknown }) => {
        setContact(result.data ? withPipelineSummary(result.data as Contact) : null)
        setContactLoading(false)
      })
  }, [contactId])

  // Labels only; the type is contact.category
  const contactCats = getCategoriesForContact(contactId).filter((c) => c !== contact?.category)
  const statusStyle = contact ? (STATUS_STYLES[contact.status] ?? STATUS_STYLES.pending) : STATUS_STYLES.pending

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b px-5 py-4" style={{ borderColor: 'var(--border-subtle)' }}>
        {contactLoading ? (
          <div className="h-10 animate-pulse rounded" style={{ background: 'var(--hover-subtle)' }} />
        ) : contact ? (
          <>
            <div className="mb-2 flex items-start justify-between">
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {contact.name}
                </h2>
                {contact.org && (
                  contact.organization_id ? (
                    <Link
                      href={`/org/${contact.organization_id}`}
                      className="truncate text-xs hover:underline"
                      style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}
                    >
                      {contact.org}
                    </Link>
                  ) : (
                    <div className="truncate text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {contact.org}
                    </div>
                  )
                )}
              </div>
              <div className="ml-3 flex shrink-0 items-center gap-1">
                {contact && (
                  <OutreachButton
                    onClick={() => setShowOutreachPanel(true)}
                    variant="icon"
                  />
                )}
                {contact && (
                  <ResearchButton
                    contact={contact}
                    category={contact.category}
                    loading={researchLoading}
                    onClick={() => {
                      setShowResearchPanel(true)
                      startResearch(contact, contact.category)
                    }}
                    variant="icon"
                  />
                )}
                <Link
                  href={`/contacts/${contactId}`}
                  className="shrink-0 rounded px-2 py-1 text-xs transition-colors"
                  style={{ background: 'var(--hover-light)', color: 'var(--text-primary)', textDecoration: 'none' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--hover-strong)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--hover-light)')}
                >
                  Open Full
                </Link>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="rounded-full px-2 py-0.5 text-xs font-medium"
                style={{ background: statusStyle.bg, color: statusStyle.text }}
              >
                {contact.status}
              </span>
              {/* Type: exactly one */}
              <select
                value={contact.category}
                onChange={async (e) => {
                  const next = e.target.value
                  setContact((prev) => (prev ? { ...prev, category: next } : prev))
                  const { error } = await setPrimaryCategory(contactId, next)
                  if (error) toast({ title: 'Failed to change type', type: 'error' })
                }}
                title="Type"
                className="rounded-full px-2 py-0.5 text-xs font-medium outline-none"
                style={{
                  background: `${getColor(contact.category)}30`,
                  color: getColor(contact.category),
                  border: `1px solid ${getColor(contact.category)}`,
                  cursor: 'pointer',
                }}
              >
                {allCategories.map((cat) => (
                  <option key={cat.name} value={cat.name}>{cat.label}</option>
                ))}
                {!allCategories.some((c) => c.name === contact.category) && (
                  <option value={contact.category}>{getLabel(contact.category)}</option>
                )}
              </select>
              {contact.warmth && (
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  {contact.warmth}
                </span>
              )}
              {contact.priority === 'high' && (
                <span className="text-xs font-bold" style={{ color: 'var(--danger)' }}>
                  ★ HIGH
                </span>
              )}
            </div>
            {/* Labels: any number, independent of the type */}
            <div className="mt-2">
              <LabelPicker
                labels={contactCats}
                type={contact.category}
                onToggle={async (label) => {
                  const result = await toggleCategory(contactId, label)
                  if (result?.error) toast({ title: 'Failed to update label', type: 'error' })
                }}
                colorFor={getColor}
              />
            </div>
          </>
        ) : (
          <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>Contact not found</div>
        )}
      </div>

      {/* Tabs */}
      <div
        ref={sidebarTabContainerRef}
        className="relative flex border-b"
        style={{ borderColor: 'var(--border-subtle)' }}
      >
        {/* Sliding indicator */}
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: sidebarTabIndicator.left,
            width: sidebarTabIndicator.width,
            height: '2px',
            borderRadius: '1px',
            background: 'var(--accent)',
            boxShadow: '0 0 8px rgba(76,114,176,0.4)',
            transition: 'left 250ms ease, width 250ms ease',
            pointerEvents: 'none',
          }}
        />
        {TABS.map((tab, idx) => (
          <button
            key={tab.key}
            ref={(el) => { sidebarTabRefs.current[idx] = el }}
            onClick={() => setActiveTab(tab.key)}
            className="btn-press flex-1 px-3 py-2.5 text-xs font-medium transition-colors"
            style={{
              background: 'transparent',
              color: activeTab === tab.key ? 'var(--accent)' : 'var(--text-secondary)',
              border: 'none',
              borderBottom: '2px solid transparent',
              cursor: 'pointer',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {activeTab === 'timeline' && (
          <UnifiedTimeline
            interactions={interactions}
            tasks={tasks}
            auditEntries={auditEntries}
            onToggleTaskComplete={async (taskId, completed) => {
              const result = await updateTaskStatus(taskId, completed ? 'completed' : 'pending')
              if (result.error) toast({ title: 'Failed to update task', type: 'error' })
              return result
            }}
            onDeleteTask={async (id) => {
              const result = await deleteTask(id)
              if (result.error) toast({ title: 'Failed to delete task', type: 'error' })
              return result
            }}
            onDeleteInteraction={async (id) => {
              const result = await deleteInteraction(id)
              if (result.error) toast({ title: 'Failed to delete interaction', type: 'error' })
              return result
            }}
          />
        )}
        {activeTab === 'interactions' && (
          <InteractionTimeline
            interactions={interactions}
            loading={interactionsLoading}
            contactId={contactId}
            onAdd={async (input) => {
              const result = await createInteraction({ ...input, userId })
              if (result.error) toast({ title: 'Failed to log interaction', type: 'error' })
              return result
            }}
            onUpdate={async (id, updates) => {
              const result = await updateInteraction(id, updates)
              if (result.error) toast({ title: 'Failed to update interaction', type: 'error' })
              return result
            }}
            onDelete={async (id: string) => {
              const result = await deleteInteraction(id)
              if (result.error) toast({ title: 'Failed to delete interaction', type: 'error' })
              return result
            }}
            contactName={contact?.name}
            contactOrg={contact?.org}
            contactCategory={contact?.category}
            inSidebar
          />
        )}
        {activeTab === 'tasks' && (
          <TaskList
            tasks={tasks}
            loading={tasksLoading}
            onAdd={async (input: { title: string; description?: string; priority?: TaskPriority; dueDate?: string }) => {
              const result = await createTask({ ...input, userId, contactId })
              if (result.error) toast({ title: 'Failed to create task', type: 'error' })
              return result
            }}
            onUpdate={async (taskId: string, updates: { title?: string; description?: string; priority?: TaskPriority; dueDate?: string | null }) => {
              const result = await updateTask(taskId, updates)
              if (result.error) toast({ title: 'Failed to update task', type: 'error' })
              return result
            }}
            onToggleComplete={async (taskId: string, completed: boolean) => {
              const result = await updateTaskStatus(taskId, completed ? 'completed' : 'pending')
              if (result.error) toast({ title: 'Failed to update task', type: 'error' })
              return result
            }}
            onDelete={async (id: string) => {
              const result = await deleteTask(id)
              if (result.error) toast({ title: 'Failed to delete task', type: 'error' })
              return result
            }}
          />
        )}
        {activeTab === 'activity' && (
          <ActivityFeed
            entries={auditEntries}
            loading={auditLoading}
            showContactLink={false}
          />
        )}
      </div>

      {/* Outreach Email panel overlay */}
      {contact && showOutreachPanel && (
        <OutreachEmailPanel
          contact={contact}
          category={contact.category}
          senderName={profile?.full_name ?? ''}
          senderEmail={user?.email ?? ''}
          onClose={() => setShowOutreachPanel(false)}
        />
      )}

      {/* Research Panel overlay */}
      {contact && showResearchPanel && (
        <ResearchPanel
          contactId={contactId}
          research={research}
          loading={researchLoading}
          error={researchError}
          onClose={() => {
            setShowResearchPanel(false)
            clearResearch()
          }}
          onRetry={() => { startResearch(contact, contact.category) }}
        />
      )}
    </div>
  )
}

export default function ContactSidebar({ contactId, onClose, userId }: ContactSidebarProps) {
  // `isOpen` drives CSS transforms; `mountedId` is the contactId we keep in DOM
  // during the closing animation so SidebarContent doesn't vanish mid-transition.
  const [isOpen, setIsOpen] = useState(false)
  const [mountedId, setMountedId] = useState<string | null>(null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (contactId) {
      // Cancel any in-progress close animation
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current)
        closeTimerRef.current = null
      }
      // Mount the new contact immediately, then open on next frame
      setMountedId(contactId)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setIsOpen(true))
      })
    } else {
      // Start close: slide out first, then unmount after transition
      setIsOpen(false)
      closeTimerRef.current = setTimeout(() => {
        setMountedId(null)
        closeTimerRef.current = null
      }, 160) // slightly longer than close transition (150ms)
    }
  }, [contactId])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    }
  }, [])

  if (!mountedId) return null

  return (
    <>
      {/* Backdrop — fades in/out with opacity transition */}
      <div
        className="sidebar-backdrop fixed inset-0 z-40"
        style={{
          background: 'var(--bg-overlay)',
          opacity: isOpen ? 1 : 0,
          pointerEvents: isOpen ? 'auto' : 'none',
          transition: isOpen
            ? 'opacity 200ms ease-out'
            : 'opacity 150ms ease-in',
        }}
        onClick={onClose}
      />

      {/* Sidebar panel — slides in from the right */}
      <div
        className="sidebar-panel fixed right-0 top-0 z-50 h-full shadow-2xl"
        style={{
          width: '420px',
          maxWidth: '90vw',
          background: 'var(--glass-modal-bg, var(--bg-card))',
          backdropFilter: 'blur(20px) saturate(150%)',
          WebkitBackdropFilter: 'blur(20px) saturate(150%)',
          borderLeft: '1px solid var(--glass-modal-border, var(--border-subtle))',
          boxShadow: 'var(--shadow-elevated)',
          transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
          transition: isOpen
            ? 'transform 200ms ease-out'
            : 'transform 150ms ease-in',
          willChange: 'transform',
        }}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="btn-press absolute right-3 top-3 z-10 flex h-7 w-7 items-center justify-center rounded-full transition-colors"
          style={{
            background: 'var(--hover-subtle)',
            color: 'var(--text-secondary)',
            border: 'none',
            cursor: 'pointer',
            fontSize: '14px',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--hover-medium)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--hover-subtle)')}
        >
          ✕
        </button>

        <SidebarContent contactId={mountedId} userId={userId} />
      </div>
    </>
  )
}
