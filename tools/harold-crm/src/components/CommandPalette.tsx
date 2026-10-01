'use client'

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useCommandPalette } from '@/hooks/useCommandPalette'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/useAuth'
import { DEFAULT_CATEGORY_COLORS, getStatusStyle } from '@/lib/types'

// ── Types ──────────────────────────────────────────────────────────────

interface SearchResult {
  id: string
  type: 'contact' | 'task' | 'page'
  title: string
  subtitle?: string
  href: string
}

// Richer shape fetched for contact preview
interface ContactPreviewData {
  id: string
  name: string
  org: string
  category: string
  categories: string[] // the type first, then labels
  warmth: string
  status: string
  location: string
  email: string
  phone: string
  updated_at: string
}

// Action that can be performed on a search result (Raycast-style)
interface PaletteAction {
  id: string
  label: string
  subtitle?: string
  icon: string
  onAction: () => void
}

// ── Constants ────────────────────────────────────────────────────────

const PAGES: SearchResult[] = [
  { id: 'page-dashboard', type: 'page', title: 'Dashboard', href: '/dashboard' },
  { id: 'page-pipeline', type: 'page', title: 'Pipeline', href: '/pipeline' },
  { id: 'page-tasks', type: 'page', title: 'Tasks', href: '/tasks' },
  { id: 'page-map', type: 'page', title: 'Map', href: '/map' },
  { id: 'page-activity', type: 'page', title: 'Activity Log', href: '/activity' },
  { id: 'page-investors', type: 'page', title: 'Investors', subtitle: 'Every investor contact at a glance', href: '/investors' },
  { id: 'page-settings', type: 'page', title: 'Settings', subtitle: 'Types, labels, sender profile, warmth rules', href: '/settings' },
  { id: 'page-new-contact', type: 'page', title: 'Add Contact', href: '/contacts/new' },
]

const SECTION_ICONS: Record<string, string> = {
  contact: '\u{1F464}',
  task: '\u{1F4CB}',
  page: '\u{1F4C4}',
}

const WARMTH_COLORS: Record<string, string> = {
  Hot: '#C44E52',
  Warm: '#DD8452',
  Lukewarm: '#ffc107',
  Cold: '#8da0cb',
  '': '#777',
}

const WARMTH_BG: Record<string, string> = {
  Hot: 'rgba(196,78,82,0.12)',
  Warm: 'rgba(221,132,82,0.12)',
  Lukewarm: 'rgba(255,193,7,0.1)',
  Cold: 'rgba(141,160,203,0.1)',
  '': 'rgba(119,119,119,0.1)',
}

// ── Helpers ──────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  if (!iso) return ''
  const now = Date.now()
  const then = new Date(iso).getTime()
  const diffMs = now - then
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  if (diffDays < 1) return 'today'
  if (diffDays === 1) return 'yesterday'
  if (diffDays < 14) return `${diffDays} days ago`
  const diffWeeks = Math.floor(diffDays / 7)
  if (diffWeeks < 8) return `${diffWeeks} week${diffWeeks === 1 ? '' : 's'} ago`
  const diffMonths = Math.floor(diffDays / 30)
  if (diffMonths < 24) return `${diffMonths} month${diffMonths === 1 ? '' : 's'} ago`
  const diffYears = Math.floor(diffDays / 365)
  return `${diffYears} year${diffYears === 1 ? '' : 's'} ago`
}

// ── Sub-components ───────────────────────────────────────────────────

function CategoryBadge({ category }: { category: string }) {
  const color = DEFAULT_CATEGORY_COLORS[category] ?? '#937860'
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '1px 7px',
        borderRadius: '10px',
        fontSize: '10px',
        fontWeight: 600,
        letterSpacing: '0.04em',
        textTransform: 'capitalize',
        background: `${color}22`,
        color,
        border: `1px solid ${color}44`,
      }}
    >
      {category}
    </span>
  )
}

function WarmthPill({ warmth }: { warmth: string }) {
  if (!warmth) return null
  const color = WARMTH_COLORS[warmth] ?? '#777'
  const bg = WARMTH_BG[warmth] ?? 'rgba(119,119,119,0.1)'
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '1px 7px',
        borderRadius: '10px',
        fontSize: '10px',
        fontWeight: 600,
        background: bg,
        color,
        border: `1px solid ${color}44`,
      }}
    >
      <span
        style={{
          width: 5,
          height: 5,
          borderRadius: '50%',
          background: color,
          flexShrink: 0,
        }}
      />
      {warmth}
    </span>
  )
}

function StatusPill({ status }: { status: string }) {
  if (!status) return null
  const { bg, text } = getStatusStyle(status)
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '1px 7px',
        borderRadius: '10px',
        fontSize: '10px',
        fontWeight: 600,
        textTransform: 'capitalize',
        background: bg,
        color: text,
      }}
    >
      {status}
    </span>
  )
}

function ContactPreview({ contact, visible }: { contact: ContactPreviewData | null; visible: boolean }) {
  // The type first, then any labels (labels never repeat the type)
  const cats = contact
    ? [contact.category, ...contact.categories.filter((c) => c !== contact.category)].filter(Boolean)
    : []

  return (
    <div
      aria-hidden={!visible}
      style={{
        width: 280,
        flexShrink: 0,
        borderLeft: '1px solid var(--border-subtle)',
        padding: '16px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        // Opacity transition — respects prefers-reduced-motion via the media query in the style tag
        opacity: visible && contact ? 1 : 0,
        transition: 'opacity 150ms ease',
        pointerEvents: 'none',
        overflowY: 'auto',
        maxHeight: 360,
      }}
    >
      {contact && (
        <>
          {/* Name + org */}
          <div>
            <div
              style={{
                fontWeight: 700,
                fontSize: '13px',
                color: 'var(--text-primary)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {contact.name}
            </div>
            {contact.org && (
              <div
                style={{
                  fontSize: '11px',
                  color: 'var(--text-secondary)',
                  marginTop: 2,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {contact.org}
              </div>
            )}
          </div>

          {/* Category badges */}
          {cats.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {cats.map((cat) => (
                <CategoryBadge key={cat} category={cat} />
              ))}
            </div>
          )}

          {/* Warmth + Status pills */}
          {(contact.warmth || contact.status) && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              <WarmthPill warmth={contact.warmth} />
              <StatusPill status={contact.status} />
            </div>
          )}

          {/* Location */}
          {contact.location && (
            <div
              style={{
                fontSize: '11px',
                color: 'var(--text-secondary)',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
              }}
            >
              <span style={{ opacity: 0.7 }}>&#x1F4CD;</span>
              <span
                style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {contact.location}
              </span>
            </div>
          )}

          {/* Contact details */}
          {(contact.email || contact.phone) && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {contact.email && (
                <div
                  style={{
                    fontSize: '11px',
                    color: 'var(--text-secondary)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    overflow: 'hidden',
                  }}
                >
                  <span style={{ opacity: 0.7, flexShrink: 0 }}>&#x2709;</span>
                  <span
                    style={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {contact.email}
                  </span>
                </div>
              )}
              {contact.phone && (
                <div
                  style={{
                    fontSize: '11px',
                    color: 'var(--text-secondary)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    overflow: 'hidden',
                  }}
                >
                  <span style={{ opacity: 0.7, flexShrink: 0 }}>&#x1F4DE;</span>
                  <span
                    style={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {contact.phone}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Last updated */}
          {contact.updated_at && (
            <div
              style={{
                marginTop: 'auto',
                paddingTop: 8,
                borderTop: '1px solid var(--border-subtle)',
                fontSize: '10px',
                color: 'var(--text-faint)',
              }}
            >
              Updated {relativeTime(contact.updated_at)}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Main component ───────────────────────────────────────────────────

export default function CommandPalette() {
  const { open, close, escapeOverrideRef } = useCommandPalette()
  const { user } = useAuth()
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [contacts, setContacts] = useState<SearchResult[]>([])
  const [contactDetails, setContactDetails] = useState<Map<string, ContactPreviewData>>(new Map())
  const [tasks, setTasks] = useState<SearchResult[]>([])
  const [loaded, setLoaded] = useState(false)

  // ── Actions mode state ──
  const [mode, setMode] = useState<'search' | 'actions'>('search')
  const [actionTarget, setActionTarget] = useState<SearchResult | null>(null)
  const [actionIndex, setActionIndex] = useState(0)
  const [toast, setToast] = useState<string | null>(null)

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 1500)
  }, [])

  // Keep escapeOverrideRef in sync with mode
  useEffect(() => {
    escapeOverrideRef.current = mode === 'actions'
  }, [mode, escapeOverrideRef])

  // Fetch contacts and tasks on first open
  useEffect(() => {
    if (!open || loaded || !user) return

    const supabase = createClient()

    async function fetchData() {
      const [contactRes, taskRes, categoryRes] = await Promise.all([
        supabase
          .from('contacts')
          .select('id, name, org, category, warmth, status, location, email, phone, updated_at')
          .order('name')
          .limit(500),
        supabase
          .from('tasks')
          .select('id, title, contacts:contact_id ( name )')
          .not('status', 'in', '("completed","cancelled")')
          .order('due_date')
          .limit(200),
        supabase
          .from('contact_categories')
          .select('contact_id, category_name'),
      ])

      // Build multi-category map
      const categoryMap = new Map<string, string[]>()
      if (categoryRes.data) {
        for (const row of categoryRes.data as Array<{ contact_id: string; category_name: string }>) {
          const existing = categoryMap.get(row.contact_id) ?? []
          existing.push(row.category_name)
          categoryMap.set(row.contact_id, existing)
        }
      }

      if (contactRes.data) {
        type RawContact = {
          id: string
          name: string
          org: string
          category: string
          warmth: string
          status: string
          location: string
          email: string
          phone: string
          updated_at: string
        }

        const detailsMap = new Map<string, ContactPreviewData>()
        const searchResults: SearchResult[] = []

        for (const c of contactRes.data as RawContact[]) {
          searchResults.push({
            id: `contact-${c.id}`,
            type: 'contact',
            title: c.name,
            subtitle: c.org,
            href: `/contacts/${c.id}`,
          })
          detailsMap.set(`contact-${c.id}`, {
            id: c.id,
            name: c.name,
            org: c.org ?? '',
            category: c.category ?? '',
            categories: categoryMap.get(c.id) ?? [],
            warmth: c.warmth ?? '',
            status: c.status ?? '',
            location: c.location ?? '',
            email: c.email ?? '',
            phone: c.phone ?? '',
            updated_at: c.updated_at ?? '',
          })
        }

        setContacts(searchResults)
        setContactDetails(detailsMap)
      }

      if (taskRes.data) {
        setTasks(
          (taskRes.data as Array<{ id: string; title: string; contacts: { name: string } | null }>).map((t) => ({
            id: `task-${t.id}`,
            type: 'task',
            title: t.title,
            subtitle: t.contacts?.name ?? undefined,
            href: `/tasks?highlight=${t.id}`,
          }))
        )
      }

      setLoaded(true)
    }

    fetchData()
  }, [open, loaded, user])

  // Reset on open
  useEffect(() => {
    if (open) {
      setQuery('')
      setActiveIndex(0)
      setMode('search')
      setActionTarget(null)
      setActionIndex(0)
      setToast(null)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  const results = useMemo(() => {
    const q = query.toLowerCase().trim()
    if (!q) {
      return [...PAGES, ...contacts.slice(0, 5)]
    }

    const matchedContacts = contacts
      .filter(
        (c) => c.title.toLowerCase().includes(q) || (c.subtitle?.toLowerCase().includes(q) ?? false)
      )
      .slice(0, 8)

    const matchedTasks = tasks
      .filter(
        (t) => t.title.toLowerCase().includes(q) || (t.subtitle?.toLowerCase().includes(q) ?? false)
      )
      .slice(0, 5)

    const matchedPages = PAGES.filter((p) => p.title.toLowerCase().includes(q))

    return [...matchedContacts, ...matchedTasks, ...matchedPages]
  }, [query, contacts, tasks])

  // Keep activeIndex in bounds when results change
  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  // Build actions for the currently selected result (used in actions mode)
  const actionsForResult = useMemo((): PaletteAction[] => {
    const target = actionTarget
    if (!target) return []

    const actions: PaletteAction[] = []

    if (target.type === 'contact') {
      const detail = contactDetails.get(target.id)
      actions.push({
        id: 'open',
        label: 'Open Contact',
        icon: '\u{1F464}',
        onAction: () => { close(); router.push(target.href) },
      })
      if (detail?.email) {
        actions.push({
          id: 'copy-email',
          label: 'Copy Email',
          subtitle: detail.email,
          icon: '\u{1F4CB}',
          onAction: () => { navigator.clipboard.writeText(detail.email); showToast('Email copied') },
        })
        actions.push({
          id: 'send-email',
          label: 'Send Email',
          subtitle: detail.email,
          icon: '\u2709\uFE0F',
          onAction: () => { window.open(`mailto:${detail.email}`) },
        })
      }
      if (detail?.phone) {
        actions.push({
          id: 'copy-phone',
          label: 'Copy Phone',
          subtitle: detail.phone,
          icon: '\u{1F4DE}',
          onAction: () => { navigator.clipboard.writeText(detail.phone); showToast('Phone copied') },
        })
        actions.push({
          id: 'call',
          label: 'Call',
          subtitle: detail.phone,
          icon: '\u{1F4F1}',
          onAction: () => { window.open(`tel:${detail.phone}`) },
        })
      }
      actions.push({
        id: 'create-task',
        label: 'Create Task',
        icon: '\u{1F4CB}',
        onAction: () => { close(); router.push(`/contacts/${target.id}?action=create-task`) },
      })
      actions.push({
        id: 'log-interaction',
        label: 'Log Interaction',
        icon: '\u{1F4AC}',
        onAction: () => { close(); router.push(`/contacts/${target.id}?action=log-interaction`) },
      })
    } else if (target.type === 'task') {
      actions.push({
        id: 'open',
        label: 'Open Task',
        icon: '\u{1F4CB}',
        onAction: () => { close(); router.push(target.href) },
      })
      if (target.subtitle) {
        // Task has an associated contact — offer to open them
        const linkedContact = contacts.find(
          (c) => c.title === target.subtitle
        )
        if (linkedContact) {
          actions.push({
            id: 'open-contact',
            label: 'Open Contact',
            subtitle: target.subtitle,
            icon: '\u{1F464}',
            onAction: () => { close(); router.push(linkedContact.href) },
          })
        }
      }
    } else if (target.type === 'page') {
      actions.push({
        id: 'open',
        label: 'Open Page',
        icon: '\u{1F4C4}',
        onAction: () => { close(); router.push(target.href) },
      })
    }

    return actions
  }, [actionTarget, contactDetails, contacts, close, router, showToast])

  // Determine which contact (if any) to preview
  const activeResult = results[activeIndex] ?? null
  const previewContact =
    activeResult?.type === 'contact' ? (contactDetails.get(activeResult.id) ?? null) : null
  const showPreview = previewContact !== null

  const navigate = useCallback(
    (result: SearchResult) => {
      close()
      router.push(result.href)
    },
    [close, router]
  )

  const enterActionsMode = useCallback((result: SearchResult) => {
    setActionTarget(result)
    setActionIndex(0)
    setMode('actions')
    // Focus the actions-mode div after React swaps the input for the div
    setTimeout(() => inputRef.current?.focus(), 0)
  }, [])

  const exitActionsMode = useCallback(() => {
    setMode('search')
    setActionTarget(null)
    setActionIndex(0)
    setTimeout(() => inputRef.current?.focus(), 0)
  }, [])

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (mode === 'actions') {
        // ── Actions mode keyboard handling ──
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setActionIndex((prev) => Math.min(prev + 1, actionsForResult.length - 1))
        } else if (e.key === 'ArrowUp') {
          e.preventDefault()
          setActionIndex((prev) => Math.max(prev - 1, 0))
        } else if (e.key === 'Enter' && actionsForResult[actionIndex]) {
          e.preventDefault()
          actionsForResult[actionIndex].onAction()
        } else if (e.key === 'Escape' || e.key === 'Backspace') {
          e.preventDefault()
          exitActionsMode()
        }
        return
      }

      // ── Search mode keyboard handling ──
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIndex((prev) => Math.min(prev + 1, results.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIndex((prev) => Math.max(prev - 1, 0))
      } else if (e.key === 'Tab' && results[activeIndex]) {
        e.preventDefault()
        enterActionsMode(results[activeIndex])
      } else if (e.key === 'Enter' && results[activeIndex]) {
        e.preventDefault()
        navigate(results[activeIndex])
      }
    },
    [mode, results, activeIndex, navigate, actionsForResult, actionIndex, enterActionsMode, exitActionsMode]
  )

  // Scroll active item into view (manual calculation to avoid
  // scrollIntoView which scrolls the entire page behind the modal)
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const idx = mode === 'actions' ? actionIndex : activeIndex
    const activeEl = list.children[idx] as HTMLElement | undefined
    if (!activeEl) return
    const elTop = activeEl.offsetTop
    const elBottom = elTop + activeEl.offsetHeight
    if (elTop < list.scrollTop) {
      list.scrollTop = elTop
    } else if (elBottom > list.scrollTop + list.clientHeight) {
      list.scrollTop = elBottom - list.clientHeight
    }
  }, [activeIndex, actionIndex, mode])

  // Lock page scroll while palette is open so arrow keys don't scroll behind it
  useEffect(() => {
    if (!open) return
    const prevBody = document.body.style.overflow
    const prevHtml = document.documentElement.style.overflow
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevBody
      document.documentElement.style.overflow = prevHtml
    }
  }, [open])

  if (!open) return null

  return (
    <>
      {/*
        Inline style tag to handle prefers-reduced-motion.
        We skip the transition but still show the preview content.
      */}
      <style>{`
        @media (prefers-reduced-motion: reduce) {
          .cp-preview {
            transition: none !important;
          }
        }
      `}</style>

      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 100,
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'center',
          paddingTop: '20vh',
          background: 'var(--bg-overlay-heavy)',
          backdropFilter: 'blur(12px)',
        }}
        onClick={close}
      >
        <div
          style={{
            width: '100%',
            maxWidth: showPreview ? '840px' : '560px',
            borderRadius: '12px',
            background: 'var(--glass-modal-bg, var(--bg-card))',
            backdropFilter: 'blur(20px) saturate(150%)',
            WebkitBackdropFilter: 'blur(20px) saturate(150%)',
            border: '1px solid var(--glass-modal-border, var(--border-subtle))',
            boxShadow: 'var(--shadow-dropdown)',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            transition: 'max-width 150ms ease',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Search input / actions header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '12px 16px',
              borderBottom: '1px solid var(--border-subtle)',
            }}
          >
            {mode === 'actions' ? (
              <>
                <button
                  onClick={exitActionsMode}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--text-faint)',
                    fontSize: '16px',
                    padding: 0,
                    lineHeight: 1,
                  }}
                  aria-label="Back to search"
                >
                  {'\u2190'}
                </button>
                <div
                  onKeyDown={onKeyDown}
                  tabIndex={0}
                  ref={inputRef as React.RefObject<HTMLDivElement>}
                  style={{
                    flex: 1,
                    fontSize: '15px',
                    color: 'var(--text-primary)',
                    outline: 'none',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {actionTarget?.title ?? ''}
                </div>
                <span style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-faint)' }}>
                  Actions
                </span>
              </>
            ) : (
              <>
                <span style={{ color: 'var(--text-faint)', fontSize: '16px' }}>{'\u{1F50D}'}</span>
                <input
                  ref={inputRef}
                  type="text"
                  placeholder="Search contacts, tasks, pages..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={onKeyDown}
                  style={{
                    flex: 1,
                    background: 'transparent',
                    border: 'none',
                    outline: 'none',
                    color: 'var(--text-primary)',
                    fontSize: '15px',
                  }}
                />
                <kbd
                  style={{
                    padding: '2px 6px',
                    borderRadius: '4px',
                    fontSize: '11px',
                    color: 'var(--text-faint)',
                    background: 'var(--hover-light)',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  ESC
                </kbd>
              </>
            )}
          </div>

          {/* Body: results list + optional preview pane */}
          <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
            {/* Results list */}
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
              <div
                ref={listRef}
                style={{
                  maxHeight: '360px',
                  overflowY: 'auto',
                  padding: '4px 0',
                  flex: 1,
                }}
              >
                {mode === 'actions' ? (
                  actionsForResult.map((action, index) => (
                    <div
                      key={action.id}
                      onClick={() => action.onAction()}
                      onMouseEnter={() => setActionIndex(index)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        padding: '10px 16px',
                        cursor: 'pointer',
                        background: index === actionIndex ? 'var(--hover-light)' : 'transparent',
                        transition: 'background 100ms',
                      }}
                    >
                      <span style={{ fontSize: '14px', width: '20px', textAlign: 'center' }}>
                        {action.icon}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: '13px',
                            color: 'var(--text-primary)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {action.label}
                        </div>
                        {action.subtitle && (
                          <div
                            style={{
                              fontSize: '11px',
                              color: 'var(--text-faint)',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {action.subtitle}
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                ) : results.length === 0 ? (
                  <div
                    style={{
                      padding: '24px 16px',
                      textAlign: 'center',
                      color: 'var(--text-faint)',
                      fontSize: '13px',
                    }}
                  >
                    No results found
                  </div>
                ) : (
                  results.map((result, index) => (
                    <div
                      key={result.id}
                      onClick={() => navigate(result)}
                      onMouseEnter={() => setActiveIndex(index)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        padding: '10px 16px',
                        cursor: 'pointer',
                        background: index === activeIndex ? 'var(--hover-light)' : 'transparent',
                        transition: 'background 100ms',
                      }}
                    >
                      <span style={{ fontSize: '14px', width: '20px', textAlign: 'center' }}>
                        {SECTION_ICONS[result.type] ?? '\u{1F4C4}'}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: '13px',
                            color: 'var(--text-primary)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {result.title}
                        </div>
                        {result.subtitle && (
                          <div
                            style={{
                              fontSize: '11px',
                              color: 'var(--text-faint)',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {result.subtitle}
                          </div>
                        )}
                      </div>
                      <span
                        style={{
                          fontSize: '10px',
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                          color: 'var(--text-faint)',
                          flexShrink: 0,
                        }}
                      >
                        {result.type}
                      </span>
                    </div>
                  ))
                )}
              </div>

              {/* Footer hint */}
              <div
                style={{
                  padding: '8px 16px',
                  borderTop: '1px solid var(--border-subtle)',
                  display: 'flex',
                  gap: '16px',
                  fontSize: '11px',
                  color: 'var(--text-faint)',
                }}
              >
                <span><kbd style={{ fontFamily: 'inherit' }}>{'\u2191\u2193'}</kbd> navigate</span>
                {mode === 'actions' ? (
                  <>
                    <span><kbd style={{ fontFamily: 'inherit' }}>{'\u23CE'}</kbd> run</span>
                    <span><kbd style={{ fontFamily: 'inherit' }}>esc</kbd> back</span>
                  </>
                ) : (
                  <>
                    <span><kbd style={{ fontFamily: 'inherit' }}>tab</kbd> actions</span>
                    <span><kbd style={{ fontFamily: 'inherit' }}>{'\u23CE'}</kbd> open</span>
                    <span><kbd style={{ fontFamily: 'inherit' }}>esc</kbd> close</span>
                  </>
                )}
              </div>
            </div>

            {/* Preview pane — always rendered so the opacity transition works,
                but zero-width and invisible when not applicable */}
            <div
              className="cp-preview"
              style={{
                width: showPreview ? 280 : 0,
                overflow: 'hidden',
                transition: 'width 150ms ease',
                flexShrink: 0,
              }}
            >
              <ContactPreview contact={previewContact} visible={showPreview} />
            </div>
          </div>
        </div>
      </div>

      {/* Toast notification */}
      {toast && (
        <div
          style={{
            position: 'fixed',
            bottom: '24px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 101,
            padding: '8px 16px',
            borderRadius: '8px',
            background: 'var(--glass-modal-bg, var(--bg-card))',
            backdropFilter: 'blur(12px)',
            border: '1px solid var(--border-subtle)',
            boxShadow: 'var(--shadow-dropdown)',
            fontSize: '13px',
            color: 'var(--text-primary)',
            pointerEvents: 'none',
          }}
        >
          {toast}
        </div>
      )}
    </>
  )
}
