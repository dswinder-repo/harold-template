'use client'

import { useState, useEffect, useRef } from 'react'
import type { Interaction, InteractionType, InteractionAttachment } from '@/lib/types'
import { INTERACTION_TYPES } from '@/lib/types'
import { formatRelativeTime } from '@/lib/utils'
import { useShowMore } from '@/hooks/useShowMore'
import { useScrollReveal } from '@/hooks/useScrollReveal'
import { createClient } from '@/lib/supabase/client'
import ShowMoreButton from './ShowMoreButton'
import TemplatePickerModal from './TemplatePickerModal'

interface InteractionTimelineProps {
  interactions: Interaction[]
  loading: boolean
  contactId: string
  onAdd: (input: {
    type: InteractionType
    subject: string
    body: string
    occurredAt?: string
    attachments?: InteractionAttachment[]
  }) => Promise<{ error?: unknown }>
  onUpdate: (id: string, updates: {
    type?: InteractionType
    subject?: string
    body?: string
    occurredAt?: string
    attachments?: InteractionAttachment[]
  }) => Promise<{ error?: unknown }>
  onDelete: (id: string) => Promise<{ error?: unknown }>
  /** Template picker context — when provided, shows "Use Template" button */
  contactName?: string
  contactOrg?: string
  contactCategory?: string
  userName?: string
  /** When true, positions template modal to the left of the sidebar */
  inSidebar?: boolean
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function getTypeIcon(type: InteractionType): string {
  return INTERACTION_TYPES.find((t) => t.value === type)?.icon ?? '\u{1F4AC}'
}

function getTypeLabel(type: InteractionType): string {
  return INTERACTION_TYPES.find((t) => t.value === type)?.label ?? type
}

function getTypeColor(type: InteractionType): string {
  const colors: Record<InteractionType, string> = {
    call: '#55A868',
    email: '#4C72B0',
    meeting: '#DD8452',
    note: '#8172B3',
    linkedin: '#0A66C2',
    other: '#937860',
  }
  return colors[type] ?? '#937860'
}

export default function InteractionTimeline({
  interactions,
  loading,
  contactId,
  onAdd,
  onUpdate,
  onDelete,
  contactName,
  contactOrg,
  contactCategory,
  userName,
  inSidebar,
}: InteractionTimelineProps) {
  const supabase = createClient()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [showForm, setShowForm] = useState(false)
  const [formType, setFormType] = useState<InteractionType>('call')
  const [formSubject, setFormSubject] = useState('')
  const [formBody, setFormBody] = useState('')
  const [formDate, setFormDate] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [showTemplates, setShowTemplates] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editType, setEditType] = useState<InteractionType>('call')
  const [editSubject, setEditSubject] = useState('')
  const [editBody, setEditBody] = useState('')
  const [editDate, setEditDate] = useState('')
  const [editSaving, setEditSaving] = useState(false)

  // Attachment state for the add form
  const [pendingAttachments, setPendingAttachments] = useState<InteractionAttachment[]>([])
  const [uploadingFiles, setUploadingFiles] = useState<string[]>([]) // filenames being uploaded
  const [dragOver, setDragOver] = useState(false)

  const { visible: visibleInteractions, hasMore, hiddenCount, showMore, showAll } = useShowMore(interactions)
  const { containerRef: timelineRevealRef, refresh: refreshTimelineReveal } = useScrollReveal<HTMLDivElement>()

  // Re-observe when visible interactions change
  useEffect(() => { refreshTimelineReveal() }, [visibleInteractions, refreshTimelineReveal])

  const uploadFile = async (file: File): Promise<InteractionAttachment | null> => {
    const timestamp = Date.now()
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const path = `${contactId}/${timestamp}-${safeName}`

    const { error } = await supabase.storage
      .from('interaction-attachments')
      .upload(path, file)

    if (error) {
      console.error('Upload error:', error)
      return null
    }

    const { data: signedData } = await supabase.storage
      .from('interaction-attachments')
      .createSignedUrl(path, 3600)

    return {
      name: file.name,
      url: signedData?.signedUrl ?? path,
      type: file.type || 'application/octet-stream',
      size: file.size,
    }
  }

  const handleFilesSelected = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    const fileArray = Array.from(files)
    setUploadingFiles((prev) => [...prev, ...fileArray.map((f) => f.name)])

    const results = await Promise.all(fileArray.map(uploadFile))
    const successful = results.filter((r): r is InteractionAttachment => r !== null)

    setPendingAttachments((prev) => [...prev, ...successful])
    setUploadingFiles((prev) => prev.filter((name) => !fileArray.some((f) => f.name === name)))
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    handleFilesSelected(e.dataTransfer.files)
  }

  const removeAttachment = (index: number) => {
    setPendingAttachments((prev) => prev.filter((_, i) => i !== index))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formBody.trim() && !formSubject.trim()) return

    setSaving(true)
    const { error } = await onAdd({
      type: formType,
      subject: formSubject.trim(),
      body: formBody.trim(),
      occurredAt: formDate ? new Date(formDate).toISOString() : undefined,
      attachments: pendingAttachments,
    })

    if (!error) {
      setFormSubject('')
      setFormBody('')
      setFormDate('')
      setPendingAttachments([])
      setShowForm(false)
    }
    setSaving(false)
  }

  const handleDelete = async (id: string) => {
    await onDelete(id)
    setDeleteConfirm(null)
  }

  const startEdit = (interaction: Interaction) => {
    setEditingId(interaction.id)
    setEditType(interaction.type)
    setEditSubject(interaction.subject ?? '')
    setEditBody(interaction.body ?? '')
    setEditDate(interaction.occurred_at ? new Date(interaction.occurred_at).toISOString().slice(0, 16) : '')
    setDeleteConfirm(null)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditType('call')
    setEditSubject('')
    setEditBody('')
    setEditDate('')
  }

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingId || (!editBody.trim() && !editSubject.trim())) return

    setEditSaving(true)
    const { error } = await onUpdate(editingId, {
      type: editType,
      subject: editSubject.trim(),
      body: editBody.trim(),
      occurredAt: editDate ? new Date(editDate).toISOString() : undefined,
    })

    if (!error) {
      cancelEdit()
    }
    setEditSaving(false)
  }

  const inputStyle = {
    background: 'var(--bg-input)',
    color: 'var(--text-primary)',
    border: '1px solid var(--border-input)',
  }

  return (
    <div>
      {/* Header with add button */}
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
          Interactions
        </h2>
        <div className="flex items-center gap-2">
          {!showForm && (
            <button
              onClick={() => { setShowForm(true); setShowTemplates(true) }}
              className="rounded-md px-3 py-1 text-xs transition-colors"
              style={{
                background: 'rgba(129,114,179,0.15)',
                color: '#8172B3',
                border: 'none',
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(129,114,179,0.25)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(129,114,179,0.15)')}
            >
              📋 Template
            </button>
          )}
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
            {showForm ? 'Cancel' : '+ Log Interaction'}
          </button>
        </div>
      </div>

      {/* Add interaction form */}
      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="mb-4 rounded-lg p-4"
          style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-subtle)' }}
        >
          {/* Type selector — pill buttons */}
          <div className="mb-3 flex flex-wrap gap-2">
            {INTERACTION_TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => setFormType(t.value)}
                className="rounded-full px-3 py-1 text-xs transition-colors"
                style={{
                  background: formType === t.value
                    ? getTypeColor(t.value)
                    : 'var(--hover-subtle)',
                  color: formType === t.value ? '#ffffff' : 'var(--text-secondary)',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                {t.icon} {t.label}
              </button>
            ))}
          </div>

          {/* Subject */}
          <input
            type="text"
            placeholder="Subject (optional)"
            value={formSubject}
            onChange={(e) => setFormSubject(e.target.value)}
            className="mb-2 w-full rounded-md px-3 py-1.5 text-sm outline-none"
            style={inputStyle}
          />

          {/* Body */}
          <textarea
            placeholder={`What happened? e.g. "Called Rick, he's interested in the Series A, wants to see the deck. Follow up Friday."`}
            value={formBody}
            onChange={(e) => setFormBody(e.target.value)}
            rows={3}
            className="mb-2 w-full rounded-md px-3 py-1.5 text-sm outline-none"
            style={inputStyle}
          />

          {/* File attachments */}
          <div className="mb-2">
            {/* Drop zone */}
            <div
              className="flex cursor-pointer items-center justify-center rounded-md border-2 border-dashed px-3 py-2 text-xs transition-colors"
              style={{
                borderColor: dragOver ? 'var(--accent)' : 'var(--border-subtle)',
                background: dragOver ? 'rgba(76,114,176,0.08)' : 'transparent',
                color: 'var(--text-secondary)',
              }}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploadingFiles.length > 0
                ? `Uploading ${uploadingFiles.length} file${uploadingFiles.length > 1 ? 's' : ''}...`
                : 'Attach files — click or drag & drop'}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => handleFilesSelected(e.target.files)}
            />

            {/* Pending attachments list */}
            {pendingAttachments.length > 0 && (
              <div className="mt-1.5 flex flex-col gap-1">
                {pendingAttachments.map((att, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between rounded-md px-2 py-1 text-xs"
                    style={{ background: 'var(--hover-subtle)', color: 'var(--text-primary)' }}
                  >
                    <span className="min-w-0 truncate">
                      📎 {att.name}
                      <span className="ml-1" style={{ color: 'var(--text-faint)' }}>({formatFileSize(att.size)})</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => removeAttachment(idx)}
                      className="ml-2 flex-shrink-0 rounded px-1"
                      style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer' }}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Date + template + submit row */}
          <div className="flex items-center gap-3">
            <input
              type="datetime-local"
              value={formDate}
              onChange={(e) => setFormDate(e.target.value)}
              className="rounded-md px-3 py-1.5 text-xs outline-none"
              style={{ ...inputStyle, flex: '0 0 auto' }}
              title="When did this happen? (defaults to now)"
            />
            <button
              type="button"
              onClick={() => setShowTemplates(true)}
              className="rounded-md px-2.5 py-1.5 text-xs transition-colors"
              style={{
                background: 'rgba(129,114,179,0.15)',
                color: '#8172B3',
                border: 'none',
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(129,114,179,0.25)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(129,114,179,0.15)')}
              title="Pre-fill from template"
            >
              📋
            </button>
            <div className="flex-1" />
            <button
              type="submit"
              disabled={saving || (!formBody.trim() && !formSubject.trim())}
              className="rounded-md px-4 py-1.5 text-sm font-medium transition-colors"
              style={{
                background: 'var(--accent)',
                color: '#ffffff',
                border: 'none',
                cursor: saving ? 'wait' : 'pointer',
                opacity: saving || (!formBody.trim() && !formSubject.trim()) ? 0.5 : 1,
              }}
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      )}

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-10">
          <div
            className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-solid border-current border-r-transparent"
            style={{ color: 'var(--accent)' }}
          />
        </div>
      )}

      {/* Empty state */}
      {!loading && interactions.length === 0 && (
        <p className="py-6 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>
          No interactions logged yet. Click &quot;+ Log Interaction&quot; to add one.
        </p>
      )}

      {/* Timeline */}
      {!loading && interactions.length > 0 && (
        <div ref={timelineRevealRef} className="relative flex flex-col gap-0">
          {/* Vertical timeline line */}
          <div
            className="absolute left-4 top-2 bottom-2"
            style={{ width: '2px', background: 'var(--border-subtle)' }}
          />

          {visibleInteractions.map((interaction) => {
            const profileName = interaction.profiles?.full_name ?? interaction.profiles?.email ?? 'Unknown'
            const typeColor = getTypeColor(interaction.type)
            const isEditing = editingId === interaction.id

            if (isEditing) {
              return (
                <div key={interaction.id} className="relative flex gap-3 py-3 pl-2">
                  {/* Timeline dot */}
                  <div
                    className="relative z-10 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-sm"
                    style={{ background: 'var(--bg-card)', border: `2px solid var(--accent)` }}
                  >
                    {getTypeIcon(editType)}
                  </div>

                  {/* Edit form */}
                  <form
                    onSubmit={handleEditSubmit}
                    className="flex-1 min-w-0 rounded-md p-3"
                    style={{ background: 'var(--bg-primary)', border: '1px solid var(--accent)' }}
                  >
                    {/* Type selector pills */}
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      {INTERACTION_TYPES.map((t) => (
                        <button
                          key={t.value}
                          type="button"
                          onClick={() => setEditType(t.value)}
                          className="rounded-full px-2.5 py-0.5 text-xs transition-colors"
                          style={{
                            background: editType === t.value
                              ? getTypeColor(t.value)
                              : 'var(--hover-subtle)',
                            color: editType === t.value ? '#ffffff' : 'var(--text-secondary)',
                            border: 'none',
                            cursor: 'pointer',
                          }}
                        >
                          {t.icon} {t.label}
                        </button>
                      ))}
                    </div>

                    <input
                      type="text"
                      placeholder="Subject (optional)"
                      value={editSubject}
                      onChange={(e) => setEditSubject(e.target.value)}
                      className="mb-2 w-full rounded-md px-3 py-1.5 text-sm outline-none"
                      style={inputStyle}
                      autoFocus
                    />

                    <textarea
                      placeholder="What happened?"
                      value={editBody}
                      onChange={(e) => setEditBody(e.target.value)}
                      rows={3}
                      className="mb-2 w-full rounded-md px-3 py-1.5 text-sm outline-none"
                      style={inputStyle}
                    />

                    <div className="flex items-center gap-3">
                      <input
                        type="datetime-local"
                        value={editDate}
                        onChange={(e) => setEditDate(e.target.value)}
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
                        disabled={editSaving || (!editBody.trim() && !editSubject.trim())}
                        className="rounded-md px-4 py-1.5 text-sm font-medium transition-colors"
                        style={{
                          background: 'var(--accent)',
                          color: '#ffffff',
                          border: 'none',
                          cursor: editSaving ? 'wait' : 'pointer',
                          opacity: editSaving || (!editBody.trim() && !editSubject.trim()) ? 0.5 : 1,
                        }}
                      >
                        {editSaving ? 'Saving...' : 'Save'}
                      </button>
                    </div>
                  </form>
                </div>
              )
            }

            return (
              <div
                key={interaction.id}
                className="scroll-reveal group relative flex gap-3 py-3 pl-2"
              >
                {/* Timeline dot */}
                <div
                  className="relative z-10 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-sm"
                  style={{ background: 'var(--bg-card)', border: `2px solid ${typeColor}` }}
                  title={getTypeLabel(interaction.type)}
                >
                  {getTypeIcon(interaction.type)}
                </div>

                {/* Content — double-click to edit */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 cursor-pointer" onDoubleClick={() => startEdit(interaction)}>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className="rounded-full px-2 py-0.5 text-xs font-medium"
                          style={{ background: `${typeColor}30`, color: typeColor }}
                        >
                          {getTypeLabel(interaction.type)}
                        </span>
                        {interaction.subject && (
                          <span className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                            {interaction.subject}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-sm whitespace-pre-wrap" style={{ color: 'var(--text-soft, #d0d0d0)' }}>
                        {interaction.body}
                      </p>
                      {/* Attachments */}
                      {interaction.attachments && interaction.attachments.length > 0 && (
                        <div className="mt-1.5 flex flex-col gap-1">
                          {interaction.attachments.map((att, idx) => (
                            <a
                              key={idx}
                              href={att.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs transition-colors"
                              style={{
                                background: 'rgba(76,114,176,0.1)',
                                color: 'var(--accent)',
                                textDecoration: 'none',
                                width: 'fit-content',
                              }}
                              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(76,114,176,0.2)')}
                              onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(76,114,176,0.1)')}
                            >
                              📎 {att.name}
                              <span style={{ color: 'var(--text-faint)' }}>({formatFileSize(att.size)})</span>
                            </a>
                          ))}
                        </div>
                      )}
                      <div className="mt-1 flex items-center gap-2 text-xs" style={{ color: 'var(--text-faint)' }}>
                        <span>{profileName}</span>
                        <span>&middot;</span>
                        <span>{formatRelativeTime(interaction.occurred_at)}</span>
                      </div>
                    </div>

                    {/* Edit + Delete buttons — visible on hover */}
                    {deleteConfirm === interaction.id ? (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleDelete(interaction.id)}
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
                          onClick={() => startEdit(interaction)}
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
                          onClick={() => setDeleteConfirm(interaction.id)}
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
                </div>
              </div>
            )
          })}
          {hasMore && <ShowMoreButton hiddenCount={hiddenCount} onShowMore={showMore} onShowAll={showAll} />}
        </div>
      )}

      {/* Template Picker Modal */}
      {showTemplates && (
        <TemplatePickerModal
          contactCategory={contactCategory}
          contactName={contactName}
          contactOrg={contactOrg}
          userName={userName}
          inSidebar={inSidebar}
          onSelect={({ type, subject, body }) => {
            setFormType(type)
            setFormSubject(subject)
            setFormBody(body)
            setShowForm(true)
          }}
          onClose={() => setShowTemplates(false)}
        />
      )}
    </div>
  )
}
