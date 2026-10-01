'use client'

import type { Contact } from '@/lib/types'

interface CSVExportButtonProps {
  contacts: Contact[]
  label?: string
  /** Labels per contact, exported as one semicolon-separated column */
  getLabels?: (contactId: string) => string[]
}

const EXPORT_COLUMNS: { key: keyof Contact; header: string }[] = [
  { key: 'name', header: 'Name' },
  { key: 'org', header: 'Organization' },
  { key: 'email', header: 'Email' },
  { key: 'phone', header: 'Phone' },
  { key: 'category', header: 'Type' },
  { key: 'status', header: 'Status' },
  { key: 'priority', header: 'Priority' },
  { key: 'warmth', header: 'Warmth' },
  { key: 'location', header: 'Location' },
  { key: 'website', header: 'Website' },
  { key: 'investor_type', header: 'Investor Type' },
  { key: 'region', header: 'Region' },
  { key: 'focus_area', header: 'Focus Area' },
  { key: 'pipeline', header: 'Pipeline Purpose' },
  { key: 'pipeline_stage', header: 'Pipeline Stage' },
  { key: 'notes', header: 'Notes' },
  { key: 'created_at', header: 'Created At' },
  { key: 'updated_at', header: 'Updated At' },
]

function escapeCSV(value: string): string {
  if (!value) return ''
  const str = String(value)
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

function generateCSV(contacts: Contact[], getLabels?: (contactId: string) => string[]): string {
  const header = [...EXPORT_COLUMNS.map((c) => c.header), 'Labels'].join(',')
  const rows = contacts.map((contact) =>
    [
      ...EXPORT_COLUMNS.map((col) => escapeCSV(contact[col.key] as string ?? '')),
      escapeCSV((getLabels?.(contact.id) ?? []).filter((l) => l !== contact.category).join('; ')),
    ].join(',')
  )
  return [header, ...rows].join('\n')
}

function downloadCSV(csv: string, filename: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

export default function CSVExportButton({ contacts, label = 'Export CSV', getLabels }: CSVExportButtonProps) {
  const handleExport = () => {
    if (contacts.length === 0) return
    const csv = generateCSV(contacts, getLabels)
    const date = new Date().toISOString().slice(0, 10)
    downloadCSV(csv, `harold-contacts-${date}.csv`)
  }

  return (
    <button
      onClick={handleExport}
      disabled={contacts.length === 0}
      className="rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
      style={{
        background: 'rgba(76,114,176,0.15)',
        color: 'var(--accent)',
        border: 'none',
        cursor: contacts.length === 0 ? 'not-allowed' : 'pointer',
        opacity: contacts.length === 0 ? 0.5 : 1,
      }}
      onMouseEnter={(e) => {
        if (contacts.length > 0) e.currentTarget.style.background = 'rgba(76,114,176,0.25)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'rgba(76,114,176,0.15)'
      }}
      title={`Export ${contacts.length} contacts as CSV`}
    >
      📥 {label}
    </button>
  )
}
