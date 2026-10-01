'use client'

import { useState } from 'react'
import type { InteractionType } from '@/lib/types'
import {
  getTemplatesForCategory,
  fillTemplate,
  TEMPLATE_CATEGORY_META,
  type InteractionTemplate,
} from '@/lib/interactionTemplates'

interface TemplatePickerModalProps {
  /** Contact's type (investor, partner, founder, ...) to filter relevant templates */
  contactCategory?: string
  /** Variables for placeholder replacement */
  contactName?: string
  contactOrg?: string
  userName?: string
  /** Callback when a template is selected — returns pre-filled values */
  onSelect: (values: {
    type: InteractionType
    subject: string
    body: string
  }) => void
  onClose: () => void
  /** When true, positions modal to the left of the sidebar instead of center-screen */
  inSidebar?: boolean
}

export default function TemplatePickerModal({
  contactCategory,
  contactName,
  contactOrg,
  userName,
  onSelect,
  onClose,
  inSidebar,
}: TemplatePickerModalProps) {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [previewTemplate, setPreviewTemplate] = useState<InteractionTemplate | null>(null)

  const templates = getTemplatesForCategory(contactCategory)

  // Group templates by category
  const grouped: Record<string, InteractionTemplate[]> = {}
  for (const t of templates) {
    if (!grouped[t.category]) grouped[t.category] = []
    grouped[t.category].push(t)
  }

  const categoryKeys = Object.keys(grouped)
  const displayCategories = selectedCategory
    ? [selectedCategory]
    : categoryKeys

  const vars = { contact_name: contactName, org: contactOrg, user_name: userName }

  const handleSelect = (template: InteractionTemplate) => {
    onSelect({
      type: template.type,
      subject: fillTemplate(template.subject, vars),
      body: fillTemplate(template.body, vars),
    })
    onClose()
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[90]"
        style={{ background: 'var(--bg-overlay)' }}
        onClick={onClose}
      />

      {/* Modal */}
      <div
        className="fixed z-[100] flex flex-col overflow-hidden rounded-xl shadow-2xl"
        style={{
          ...(inSidebar
            ? { right: 440, top: '50%', transform: 'translateY(-50%)' }
            : { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }),
          width: previewTemplate ? 720 : 520,
          maxWidth: '90vw',
          maxHeight: '80vh',
          background: 'var(--glass-modal-bg, var(--bg-card))',
          backdropFilter: 'blur(20px) saturate(150%)',
          WebkitBackdropFilter: 'blur(20px) saturate(150%)',
          border: '1px solid var(--glass-modal-border, var(--border-subtle))',
          boxShadow: 'var(--shadow-elevated)',
          transition: 'width 200ms ease-out',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: '1px solid var(--border-subtle)' }}
        >
          <div>
            <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              Interaction Templates
            </h2>
            <p className="mt-0.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
              Choose a template to pre-fill your interaction
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-full"
            style={{
              background: 'var(--hover-subtle)',
              color: 'var(--text-secondary)',
              border: 'none',
              cursor: 'pointer',
              fontSize: 14,
            }}
          >
            ✕
          </button>
        </div>

        {/* Category filter chips */}
        <div className="flex flex-wrap gap-2 px-5 py-3" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <button
            onClick={() => { setSelectedCategory(null); setPreviewTemplate(null) }}
            className="rounded-full px-3 py-1 text-xs font-medium transition-colors"
            style={{
              background: !selectedCategory ? 'var(--accent)' : 'var(--hover-subtle)',
              color: !selectedCategory ? '#ffffff' : 'var(--text-secondary)',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            All
          </button>
          {categoryKeys.map((cat) => {
            const meta = TEMPLATE_CATEGORY_META[cat]
            const isActive = selectedCategory === cat
            return (
              <button
                key={cat}
                onClick={() => { setSelectedCategory(isActive ? null : cat); setPreviewTemplate(null) }}
                className="rounded-full px-3 py-1 text-xs font-medium transition-colors"
                style={{
                  background: isActive ? 'var(--accent)' : 'var(--hover-subtle)',
                  color: isActive ? '#ffffff' : 'var(--text-secondary)',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                {meta?.icon} {meta?.label ?? cat}
              </button>
            )
          })}
        </div>

        {/* Content: template list + optional preview */}
        <div className="flex flex-1 overflow-hidden">
          {/* Template list */}
          <div
            className="flex-1 overflow-y-auto"
            style={{ minWidth: 0, maxHeight: 'calc(80vh - 140px)' }}
          >
            {displayCategories.map((cat) => (
              <div key={cat}>
                {!selectedCategory && (
                  <div
                    className="sticky top-0 px-5 py-2 text-xs font-semibold uppercase tracking-wider"
                    style={{
                      color: 'var(--text-secondary)',
                      background: 'var(--bg-card)',
                      borderBottom: '1px solid var(--border-subtle)',
                    }}
                  >
                    {TEMPLATE_CATEGORY_META[cat]?.icon} {TEMPLATE_CATEGORY_META[cat]?.label ?? cat}
                  </div>
                )}
                {grouped[cat]?.map((template) => {
                  const isSelected = previewTemplate?.id === template.id
                  return (
                    <button
                      key={template.id}
                      className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors"
                      style={{
                        background: isSelected ? 'rgba(76,114,176,0.12)' : 'transparent',
                        borderBottom: '1px solid var(--hover-subtle)',
                        border: 'none',
                        borderBlockEnd: '1px solid var(--hover-subtle)',
                        cursor: 'pointer',
                      }}
                      onMouseEnter={(e) => {
                        if (!isSelected) e.currentTarget.style.background = 'var(--hover-subtle)'
                      }}
                      onMouseLeave={(e) => {
                        if (!isSelected) e.currentTarget.style.background = 'transparent'
                      }}
                      onClick={() => setPreviewTemplate(template)}
                      onDoubleClick={() => handleSelect(template)}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                            {template.name}
                          </span>
                          <span
                            className="rounded-full px-1.5 py-0.5 text-xs"
                            style={{
                              background: 'var(--hover-subtle)',
                              color: 'var(--text-secondary)',
                            }}
                          >
                            {template.type}
                          </span>
                        </div>
                        <p
                          className="mt-0.5 truncate text-xs"
                          style={{ color: 'var(--text-muted)' }}
                        >
                          {template.subject}
                        </p>
                      </div>
                      <span style={{ color: 'var(--text-muted)', fontSize: 14 }}>→</span>
                    </button>
                  )
                })}
              </div>
            ))}
          </div>

          {/* Preview panel */}
          {previewTemplate && (
            <div
              className="flex flex-col overflow-hidden"
              style={{
                width: 320,
                borderLeft: '1px solid var(--border-subtle)',
              }}
            >
              <div className="flex-1 overflow-y-auto px-4 py-3">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                  Preview
                </div>
                <div className="mb-2 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                  {fillTemplate(previewTemplate.subject, vars)}
                </div>
                <pre
                  className="whitespace-pre-wrap text-xs leading-relaxed"
                  style={{
                    color: 'var(--text-soft, var(--text-secondary))',
                    fontFamily: 'inherit',
                    margin: 0,
                  }}
                >
                  {fillTemplate(previewTemplate.body, vars)}
                </pre>
              </div>
              <div className="px-4 py-3" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <button
                  onClick={() => handleSelect(previewTemplate)}
                  className="w-full rounded-md px-4 py-2 text-sm font-medium transition-colors"
                  style={{
                    background: 'var(--accent)',
                    color: '#ffffff',
                    border: 'none',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.9')}
                  onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
                >
                  Use This Template
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
