'use client'

import { useState, useMemo, useCallback } from 'react'
import AuthGuard from '@/components/AuthGuard'
import Header from '@/components/Header'
import KPIBar from '@/components/KPIBar'
import FilterBar from '@/components/FilterBar'
import ContactGrid from '@/components/ContactGrid'
import AddCategoryModal from '@/components/AddCategoryModal'
import ContactSidebar from '@/components/ContactSidebar'
import DashboardCharts from '@/components/DashboardCharts'
import NeedsAttentionCards from '@/components/NeedsAttentionCards'
import BulkActionBar from '@/components/BulkActionBar'
import DashboardSkeleton from '@/components/DashboardSkeleton'
import CSVExportButton from '@/components/CSVExportButton'
import CSVImportModal from '@/components/CSVImportModal'
import DuplicateDetectionPanel from '@/components/DuplicateDetectionPanel'
import BulkEnrichPanel from '@/components/BulkEnrichPanel'
import SortDropdown from '@/components/SortDropdown'
import type { SortKey } from '@/components/SortDropdown'
import { useContacts } from '@/hooks/useContacts'
import { useCategories } from '@/hooks/useCategories'
import { useContactCategories } from '@/hooks/useContactCategories'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/hooks/useToast'
import { parseCountry, sortContacts } from '@/lib/utils'
import type { Contact } from '@/lib/types'

// Default sort: active first → high priority → alphabetical
function defaultSort(contacts: Contact[]): Contact[] {
  return [...contacts].sort((a, b) => {
    const statusOrder: Record<string, number> = { active: 0, pending: 1, cold: 2, archived: 3 }
    const statusDiff = (statusOrder[a.status] ?? 99) - (statusOrder[b.status] ?? 99)
    if (statusDiff !== 0) return statusDiff
    const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 }
    const priorityDiff = (priorityOrder[a.priority] ?? 99) - (priorityOrder[b.priority] ?? 99)
    if (priorityDiff !== 0) return priorityDiff
    return a.name.localeCompare(b.name)
  })
}

export default function DashboardClient() {
  const { contacts: allContactsRaw, loading, updateContact, totalCount } = useContacts()
  const { categories, categoryNames, createCategory } = useCategories()
  const { getCategoriesForContact, toggleCategory } = useContactCategories()
  const { user } = useAuth()
  const { toast } = useToast()
  const allContacts = allContactsRaw
  const [activeCategory, setActiveCategory] = useState<string>('all')
  const [activeCountry, setActiveCountry] = useState('all')
  const [showAddCategoryModal, setShowAddCategoryModal] = useState(false)
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showImportModal, setShowImportModal] = useState(false)
  const [showDuplicatePanel, setShowDuplicatePanel] = useState(false)
  const [showEnrichPanel, setShowEnrichPanel] = useState(false)
  const [sortMode, setSortMode] = useState<SortKey>('default')

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const filteredContacts = useMemo(() => {
    let result = allContacts
    if (activeCategory === 'high_priority') result = result.filter((c) => c.priority === 'high')
    else if (activeCategory === 'active') result = result.filter((c) => c.status === 'active')
    else if (activeCategory !== 'all') {
      // A type, or a label: show contacts of that type or carrying that label
      result = result.filter((c) => c.category === activeCategory || getCategoriesForContact(c.id).includes(activeCategory))
    }
    if (activeCountry !== 'all') result = result.filter((c) => parseCountry(c.location) === activeCountry)

    switch (sortMode) {
      case 'name_asc':
        return sortContacts(result, 'name', 'asc')
      case 'name_desc':
        return sortContacts(result, 'name', 'desc')
      case 'org':
        return sortContacts(result, 'org', 'asc')
      case 'priority':
        return sortContacts(result, 'priority', 'asc')
      default:
        return defaultSort(result)
    }
  }, [allContacts, activeCategory, activeCountry, getCategoriesForContact, sortMode])

  return (
    <AuthGuard>
      <div className="min-h-screen">
        <Header />

        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
          {loading ? (
            <DashboardSkeleton />
          ) : (
          <>
          <div className="mb-6">
            <KPIBar contacts={allContacts} categories={categories} getCategoriesForContact={getCategoriesForContact} onFilter={setActiveCategory} activeFilter={activeCategory} />
          </div>

          <div className="mb-6">
            <DashboardCharts contacts={allContacts} />
          </div>

          <div className="mb-6">
            <NeedsAttentionCards />
          </div>

          <div className="mb-6">
            <FilterBar
              contacts={allContacts}
              categories={categories}
              activeCategory={activeCategory}
              onCategoryChange={setActiveCategory}
              activeCountry={activeCountry}
              onCountryChange={setActiveCountry}
              onAddCategory={() => setShowAddCategoryModal(true)}
            />
          </div>

          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                {`${filteredContacts.length} contacts`}
              </span>
              <SortDropdown value={sortMode} onChange={setSortMode} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setShowEnrichPanel(true)}
                className="rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors"
                style={{
                  background: 'rgba(76,114,176,0.15)',
                  color: 'var(--accent)',
                  border: 'none',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(76,114,176,0.25)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(76,114,176,0.15)')}
              >
                ✨ Enrich
              </button>
              <button
                onClick={() => setShowDuplicatePanel(true)}
                className="rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors"
                style={{
                  background: 'rgba(221,132,82,0.15)',
                  color: '#DD8452',
                  border: 'none',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(221,132,82,0.25)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(221,132,82,0.15)')}
              >
                🔍 Duplicates
              </button>
              <button
                onClick={() => setShowImportModal(true)}
                className="rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors"
                style={{
                  background: 'rgba(85,168,104,0.15)',
                  color: '#55A868',
                  border: 'none',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(85,168,104,0.25)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(85,168,104,0.15)')}
              >
                📤 Import
              </button>
              <CSVExportButton contacts={filteredContacts} label="Export" getLabels={getCategoriesForContact} />
            </div>
          </div>

          <ContactGrid
            contacts={filteredContacts}
            groupByOrg={sortMode === 'org'}
            categoryNames={categoryNames}
            getCategoriesForContact={getCategoriesForContact}
            onUpdateContact={async (id, updates) => {
              if (!user) return { error: 'Not authenticated' }
              const result = await updateContact(id, { ...updates, updated_by: user.id })
              if (result.error) {
                toast({ title: 'Failed to update contact', type: 'error' })
              }
              return result
            }}
            onToggleCategory={toggleCategory}
            onSelectContact={setSelectedContactId}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
            onSelectAll={() => {
              setSelectedIds((prev) => {
                const allCurrentlySelected = filteredContacts.every((c) => prev.has(c.id))
                if (allCurrentlySelected) return new Set()
                return new Set(filteredContacts.map((c) => c.id))
              })
            }}
          />

          {/* Contact count */}
          {totalCount !== null && (
            <div className="mt-4 flex items-center justify-center">
              <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
                {totalCount} contacts
              </span>
            </div>
          )}
          </>
          )}
        </main>

        {selectedIds.size > 0 && (
          <BulkActionBar
            selectedIds={selectedIds}
            contacts={allContacts}
            onClear={() => setSelectedIds(new Set())}
            userId={user?.id}
          />
        )}

        <ContactSidebar
          contactId={selectedContactId}
          onClose={() => setSelectedContactId(null)}
          userId={user?.id}
        />

        {showAddCategoryModal && (
          <AddCategoryModal
            onClose={() => setShowAddCategoryModal(false)}
            onCreate={async (name: string, label: string, color: string) => {
              if (!user) return { error: 'Not authenticated' }
              return await createCategory(name, label, color, user.id)
            }}
          />
        )}

        {showImportModal && user && (
          <CSVImportModal
            onClose={() => setShowImportModal(false)}
            onImported={() => {
              toast({ title: 'Contacts imported successfully', type: 'success' })
              setShowImportModal(false)
            }}
            userId={user.id}
          />
        )}

        {showEnrichPanel && user && (
          <BulkEnrichPanel
            contacts={allContacts}
            userId={user.id}
            onClose={() => setShowEnrichPanel(false)}
          />
        )}

        {showDuplicatePanel && user && (
          <DuplicateDetectionPanel
            contacts={allContacts}
            userId={user.id}
            onClose={() => setShowDuplicatePanel(false)}
            onMerged={() => {
              // Panel stays open for batch merging — contacts refresh via realtime/SWR
            }}
          />
        )}
      </div>
    </AuthGuard>
  )
}
