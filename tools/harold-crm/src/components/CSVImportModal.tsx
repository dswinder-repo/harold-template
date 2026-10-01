'use client'

import { useState, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/hooks/useToast'

interface CSVImportModalProps {
  onClose: () => void
  onImported: () => void
  userId: string
}

type Step = 'upload' | 'mapping' | 'preview' | 'importing' | 'done'

const IMPORTABLE_FIELDS = [
  { key: 'name', label: 'Name', required: true },
  { key: 'org', label: 'Organization' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'category', label: 'Type' },
  { key: 'status', label: 'Status' },
  { key: 'priority', label: 'Priority' },
  { key: 'warmth', label: 'Warmth' },
  { key: 'location', label: 'Location' },
  { key: 'website', label: 'Website' },
  { key: 'investor_type', label: 'Investor Type' },
  { key: 'region', label: 'Region' },
  { key: 'focus_area', label: 'Focus Area' },
  { key: 'notes', label: 'Notes' },
  { key: 'labels', label: 'Labels (separated by ; or |)' },
] as const

type FieldKey = (typeof IMPORTABLE_FIELDS)[number]['key']

// Auto-detect column mapping from header names
function autoDetectMapping(headers: string[]): Record<number, FieldKey | ''> {
  const mapping: Record<number, FieldKey | ''> = {}
  const aliases: Record<string, FieldKey> = {
    name: 'name',
    'full name': 'name',
    'contact name': 'name',
    'first name': 'name',
    organization: 'org',
    org: 'org',
    company: 'org',
    email: 'email',
    'email address': 'email',
    phone: 'phone',
    'phone number': 'phone',
    telephone: 'phone',
    category: 'category',
    type: 'category',
    'contact type': 'category',
    labels: 'labels',
    label: 'labels',
    tags: 'labels',
    status: 'status',
    priority: 'priority',
    warmth: 'warmth',
    location: 'location',
    city: 'location',
    address: 'location',
    website: 'website',
    url: 'website',
    'investor type': 'investor_type',
    'investor_type': 'investor_type',
    region: 'region',
    'focus area': 'focus_area',
    'focus_area': 'focus_area',
    notes: 'notes',
    description: 'notes',
    comments: 'notes',
  }

  const usedFields = new Set<FieldKey>()
  headers.forEach((header, index) => {
    const normalized = header.toLowerCase().trim()
    const match = aliases[normalized]
    if (match && !usedFields.has(match)) {
      mapping[index] = match
      usedFields.add(match)
    } else {
      mapping[index] = ''
    }
  })
  return mapping
}

function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++ // skip escaped quote
      } else {
        inQuotes = !inQuotes
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  result.push(current.trim())
  return result
}

function parseCSV(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '')
  if (lines.length === 0) return { headers: [], rows: [] }
  const headers = parseCSVLine(lines[0])
  const rows = lines.slice(1).map(parseCSVLine)
  return { headers, rows }
}

export default function CSVImportModal({ onClose, onImported, userId }: CSVImportModalProps) {
  const [step, setStep] = useState<Step>('upload')
  const [headers, setHeaders] = useState<string[]>([])
  const [rows, setRows] = useState<string[][]>([])
  const [mapping, setMapping] = useState<Record<number, FieldKey | ''>>({})
  const [importResult, setImportResult] = useState<{ success: number; errors: number }>({ success: 0, errors: 0 })
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { toast, dismiss } = useToast()

  const handleFile = useCallback((file: File) => {
    if (!file.name.endsWith('.csv')) {
      toast({ title: 'Please upload a CSV file', type: 'error' })
      return
    }
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      const { headers: h, rows: r } = parseCSV(text)
      if (h.length === 0) {
        toast({ title: 'CSV file appears empty', type: 'error' })
        return
      }
      setHeaders(h)
      setRows(r)
      setMapping(autoDetectMapping(h))
      setStep('mapping')
    }
    reader.readAsText(file)
  }, [toast])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      const file = e.dataTransfer.files[0]
      if (file) handleFile(file)
    },
    [handleFile]
  )

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }

  const updateMapping = (colIndex: number, field: FieldKey | '') => {
    setMapping((prev) => ({ ...prev, [colIndex]: field }))
  }

  const nameIsMapped = Object.values(mapping).includes('name')

  const handleImport = async () => {
    setStep('importing')
    const supabase = createClient()
    let success = 0
    let errors = 0
    const toastId = toast({ title: 'Importing contacts…', showSpinner: true, duration: 0 })

    // Build mapped rows
    const contacts = rows
      .map((row) => {
        const record: Record<string, string> = {}
        Object.entries(mapping).forEach(([colIdx, field]) => {
          if (field && row[Number(colIdx)]) {
            record[field] = row[Number(colIdx)].trim()
          }
        })
        return record
      })
      .filter((r) => r.name && r.name.trim() !== '')

    // Batch insert in chunks of 50
    const chunkSize = 50
    for (let i = 0; i < contacts.length; i += chunkSize) {
      const chunk = contacts.slice(i, i + chunkSize).map((c) => ({
        name: c.name,
        org: c.org ?? '',
        email: c.email ?? '',
        phone: c.phone ?? '',
        category: c.category?.trim().toLowerCase() || 'other',
        status: (['active', 'pending', 'cold', 'archived'].includes(c.status ?? '')
          ? c.status
          : 'pending') as string,
        priority: (['high', 'medium', 'low'].includes(c.priority ?? '')
          ? c.priority
          : 'medium') as string,
        // Four warmth levels; anything else imports as not rated
        warmth: (['', 'Cold', 'Lukewarm', 'Warm', 'Hot'].includes(c.warmth ?? '')
          ? c.warmth
          : '') as string,
        location: c.location ?? '',
        website: c.website ?? '',
        investor_type: c.investor_type ?? '',
        region: c.region ?? '',
        focus_area: c.focus_area ?? '',
        notes: c.notes ?? '',
        created_by: userId,
        updated_by: userId,
      }))

      const source = contacts.slice(i, i + chunkSize)
      const { data: inserted, error } = await supabase.from('contacts').insert(chunk).select('id')
      if (error) {
        errors += chunk.length
      } else {
        success += chunk.length
        // Labels: one row per label in contact_categories, never a copy of the type
        const labelRows = ((inserted ?? []) as { id: string }[]).flatMap((row, idx) => {
          const type = chunk[idx].category
          const labels = (source[idx].labels ?? '')
            .split(/[;|]/)
            .map((l) => l.trim().toLowerCase())
            .filter((l) => l && l !== type)
          return [...new Set(labels)].map((category_name) => ({ contact_id: row.id, category_name }))
        })
        if (labelRows.length) await supabase.from('contact_categories').insert(labelRows)
      }
    }

    dismiss(toastId)
    setImportResult({ success, errors })
    setStep('done')
    if (success > 0) {
      onImported()
    }
  }

  const previewRows = rows.slice(0, 5)

  const inputStyle = {
    background: 'var(--bg-input)',
    color: 'var(--text-primary)',
    border: '1px solid var(--border-input)',
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center"
      style={{ background: 'var(--bg-overlay)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="relative w-full max-w-2xl rounded-xl p-6 shadow-2xl"
        style={{
          background: 'var(--glass-modal-bg, var(--bg-card))',
          backdropFilter: 'blur(20px) saturate(150%)',
          WebkitBackdropFilter: 'blur(20px) saturate(150%)',
          border: '1px solid var(--glass-modal-border, var(--border-subtle))',
          boxShadow: 'var(--shadow-elevated)',
          maxHeight: '85vh',
          overflowY: 'auto' as const,
        }}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute right-4 top-4 flex h-7 w-7 items-center justify-center rounded-full transition-colors"
          style={{ background: 'var(--hover-subtle)', color: 'var(--text-secondary)', border: 'none', cursor: 'pointer' }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--hover-medium)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--hover-subtle)')}
        >
          ✕
        </button>

        <h2 className="mb-4 text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
          {step === 'upload' && '📤 Import Contacts from CSV'}
          {step === 'mapping' && '🔗 Map Columns'}
          {step === 'preview' && '👀 Preview Import'}
          {step === 'importing' && '⏳ Importing...'}
          {step === 'done' && '✅ Import Complete'}
        </h2>

        {/* Step 1: Upload */}
        {step === 'upload' && (
          <div>
            <div
              className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-10 transition-colors"
              style={{
                borderColor: dragOver ? 'var(--accent)' : 'var(--border-subtle)',
                background: dragOver ? 'rgba(76,114,176,0.08)' : 'transparent',
              }}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <span className="mb-2 text-3xl">📄</span>
              <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                Drop your CSV file here, or click to browse
              </p>
              <p className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
                CSV files only. First row should contain column headers.
              </p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleFileInput}
              className="hidden"
            />

            <div className="mt-4 rounded-lg p-3" style={{ background: 'var(--hover-subtle)' }}>
              <p className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                Expected columns (all optional except Name):
              </p>
              <p className="mt-1 text-xs" style={{ color: 'var(--text-faint)' }}>
                Name, Organization, Email, Phone, Category, Status, Priority, Warmth, Location, Website, Notes
              </p>
            </div>
          </div>
        )}

        {/* Step 2: Column Mapping */}
        {step === 'mapping' && (
          <div>
            <p className="mb-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
              Found {rows.length} rows with {headers.length} columns. Map CSV columns to contact fields:
            </p>

            <div className="mb-4 flex flex-col gap-2">
              {headers.map((header, index) => (
                <div key={index} className="flex items-center gap-3">
                  <span
                    className="w-40 truncate rounded px-2 py-1 text-xs font-mono"
                    style={{ background: 'var(--hover-subtle)', color: 'var(--text-primary)' }}
                    title={header}
                  >
                    {header}
                  </span>
                  <span className="text-xs" style={{ color: 'var(--text-faint)' }}>→</span>
                  <select
                    value={mapping[index] ?? ''}
                    onChange={(e) => updateMapping(index, e.target.value as FieldKey | '')}
                    className="flex-1 rounded-md px-2 py-1 text-xs outline-none"
                    style={inputStyle}
                  >
                    <option value="">— Skip —</option>
                    {IMPORTABLE_FIELDS.map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label}{'required' in f && f.required ? ' *' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            {!nameIsMapped && (
              <p className="mb-3 rounded-md px-3 py-2 text-xs" style={{ background: 'rgba(196,78,82,0.15)', color: 'var(--danger)' }}>
                ⚠ &quot;Name&quot; must be mapped. It is required.
              </p>
            )}

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setStep('upload')}
                className="rounded-md px-4 py-1.5 text-sm transition-colors"
                style={{ background: 'var(--hover-light)', color: 'var(--text-primary)', border: 'none', cursor: 'pointer' }}
              >
                Back
              </button>
              <button
                onClick={() => setStep('preview')}
                disabled={!nameIsMapped}
                className="rounded-md px-4 py-1.5 text-sm font-medium transition-colors"
                style={{
                  background: nameIsMapped ? 'var(--accent)' : 'var(--hover-light)',
                  color: nameIsMapped ? '#ffffff' : 'var(--text-secondary)',
                  border: 'none',
                  cursor: nameIsMapped ? 'pointer' : 'not-allowed',
                }}
              >
                Preview →
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Preview */}
        {step === 'preview' && (
          <div>
            <p className="mb-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
              Preview of first {Math.min(5, rows.length)} rows (of {rows.length} total):
            </p>

            <div className="mb-4 overflow-x-auto rounded-lg" style={{ border: '1px solid var(--border-subtle)' }}>
              <table className="w-full text-xs">
                <thead>
                  <tr style={{ background: 'var(--hover-subtle)' }}>
                    {Object.entries(mapping)
                      .filter(([, field]) => field !== '')
                      .map(([colIdx, field]) => (
                        <th
                          key={colIdx}
                          className="px-3 py-2 text-left font-medium"
                          style={{ color: 'var(--text-secondary)' }}
                        >
                          {IMPORTABLE_FIELDS.find((f) => f.key === field)?.label ?? field}
                        </th>
                      ))}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row, rowIdx) => (
                    <tr
                      key={rowIdx}
                      style={{ borderTop: '1px solid var(--border-subtle)' }}
                    >
                      {Object.entries(mapping)
                        .filter(([, field]) => field !== '')
                        .map(([colIdx]) => (
                          <td
                            key={colIdx}
                            className="max-w-[200px] truncate px-3 py-2"
                            style={{ color: 'var(--text-primary)' }}
                          >
                            {row[Number(colIdx)] || '—'}
                          </td>
                        ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setStep('mapping')}
                className="rounded-md px-4 py-1.5 text-sm transition-colors"
                style={{ background: 'var(--hover-light)', color: 'var(--text-primary)', border: 'none', cursor: 'pointer' }}
              >
                Back
              </button>
              <button
                onClick={handleImport}
                className="rounded-md px-4 py-1.5 text-sm font-medium transition-colors"
                style={{ background: '#55A868', color: '#ffffff', border: 'none', cursor: 'pointer' }}
              >
                Import {rows.length} Contacts
              </button>
            </div>
          </div>
        )}

        {/* Step 4: Importing */}
        {step === 'importing' && (
          <div className="flex flex-col items-center py-10">
            <div
              className="mb-4 inline-block h-8 w-8 animate-spin rounded-full border-2 border-solid border-current border-r-transparent"
              style={{ color: 'var(--accent)' }}
            />
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Importing {rows.length} contacts...
            </p>
          </div>
        )}

        {/* Step 5: Done */}
        {step === 'done' && (
          <div className="text-center py-6">
            <span className="text-4xl">
              {importResult.errors === 0 ? '🎉' : '⚠️'}
            </span>
            <p className="mt-3 text-sm" style={{ color: 'var(--text-primary)' }}>
              <strong>{importResult.success}</strong> contacts imported successfully.
              {importResult.errors > 0 && (
                <span style={{ color: 'var(--danger)' }}>
                  {' '}{importResult.errors} failed.
                </span>
              )}
            </p>
            <button
              onClick={onClose}
              className="mt-4 rounded-md px-6 py-2 text-sm font-medium transition-colors"
              style={{ background: 'var(--accent)', color: '#ffffff', border: 'none', cursor: 'pointer' }}
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
