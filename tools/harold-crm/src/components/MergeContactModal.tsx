'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Contact } from '@/lib/types'

interface MergeContactModalProps {
  primaryContact: Contact
  userId: string
  onClose: () => void
  onMerged: () => void
}

export default function MergeContactModal({
  primaryContact,
  userId,
  onClose,
  onMerged,
}: MergeContactModalProps) {
  const supabase = createClient()
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<Contact[]>([])
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null)
  const [merging, setMerging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [step, setStep] = useState<'search' | 'confirm'>('search')

  // Search for contacts to merge with
  useEffect(() => {
    if (!search.trim()) {
      setResults([])
      return
    }

    const timer = setTimeout(async () => {
      const q = search.toLowerCase()
      const { data } = await supabase
        .from('contacts')
        .select('*')
        .neq('id', primaryContact.id)
        .or(`name.ilike.%${q}%,org.ilike.%${q}%,email.ilike.%${q}%`)
        .order('name')
        .limit(10)

      if (data) setResults(data as Contact[])
    }, 300)

    return () => clearTimeout(timer)
  }, [search, supabase, primaryContact.id])

  const handleMerge = async () => {
    if (!selectedContact) return
    setMerging(true)
    setError(null)

    const { error: rpcError } = await supabase.rpc('merge_contacts', {
      primary_id: primaryContact.id,
      secondary_id: selectedContact.id,
      merge_user_id: userId,
    })

    setMerging(false)

    if (rpcError) {
      setError(rpcError.message)
    } else {
      onMerged()
    }
  }

  const inputStyle = {
    background: 'var(--bg-input)',
    color: 'var(--text-primary)',
    border: '1px solid var(--border-input)',
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'var(--bg-overlay-heavy)' }}
      onClick={onClose}
    >
      <div
        className="mx-4 w-full max-w-lg rounded-lg p-6"
        style={{
          background: 'var(--glass-modal-bg, var(--bg-card))',
          backdropFilter: 'blur(20px) saturate(150%)',
          WebkitBackdropFilter: 'blur(20px) saturate(150%)',
          border: '1px solid var(--glass-modal-border, var(--border-subtle))',
          boxShadow: 'var(--shadow-elevated)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-1 text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
          Merge Contact
        </h3>
        <p className="mb-4 text-xs" style={{ color: 'var(--text-secondary)' }}>
          Merge a duplicate into <strong style={{ color: 'var(--text-primary)' }}>{primaryContact.name}</strong>.
          The primary contact keeps its data; empty fields are filled from the duplicate.
        </p>

        {step === 'search' && (
          <>
            {/* Search input */}
            <div className="mb-3">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search for the duplicate contact..."
                className="w-full rounded-md px-3 py-2 text-sm outline-none"
                style={inputStyle}
                autoFocus
              />
            </div>

            {/* Results list */}
            <div className="max-h-64 overflow-y-auto rounded-md" style={{ background: 'var(--bg-primary)' }}>
              {results.length === 0 && search.trim() && (
                <p className="p-3 text-xs" style={{ color: 'var(--text-faint)' }}>No contacts found</p>
              )}
              {results.map((c) => (
                <button
                  key={c.id}
                  onClick={() => {
                    setSelectedContact(c)
                    setStep('confirm')
                  }}
                  className="flex w-full items-center gap-3 border-b px-3 py-2.5 text-left transition-colors"
                  style={{
                    borderColor: 'var(--hover-subtle)',
                    background: 'transparent',
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                    border: 'none',
                    borderBottom: '1px solid var(--hover-subtle)',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--hover-subtle)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <div className="flex-1">
                    <div className="text-sm font-medium">{c.name}</div>
                    <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {c.org}{c.email ? ` · ${c.email}` : ''}{c.category ? ` · ${c.category}` : ''}
                    </div>
                  </div>
                </button>
              ))}
            </div>

            <div className="mt-4 flex justify-end">
              <button
                onClick={onClose}
                className="rounded-md px-4 py-2 text-sm"
                style={{ background: 'var(--hover-light)', color: 'var(--text-primary)', border: 'none', cursor: 'pointer' }}
              >
                Cancel
              </button>
            </div>
          </>
        )}

        {step === 'confirm' && selectedContact && (
          <>
            {/* Merge preview */}
            <div className="mb-4 grid grid-cols-2 gap-3">
              <div className="rounded-md p-3" style={{ background: 'var(--bg-primary)', borderLeft: '3px solid var(--success)' }}>
                <div className="mb-1 text-xs font-semibold uppercase" style={{ color: 'var(--success)' }}>Keep (Primary)</div>
                <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{primaryContact.name}</div>
                <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>{primaryContact.org}</div>
                {primaryContact.email && <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>{primaryContact.email}</div>}
                <div className="mt-1 text-xs" style={{ color: 'var(--text-faint)' }}>{primaryContact.category}</div>
              </div>
              <div className="rounded-md p-3" style={{ background: 'var(--bg-primary)', borderLeft: '3px solid var(--danger)' }}>
                <div className="mb-1 text-xs font-semibold uppercase" style={{ color: 'var(--danger)' }}>Merge &amp; Delete</div>
                <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{selectedContact.name}</div>
                <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>{selectedContact.org}</div>
                {selectedContact.email && <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>{selectedContact.email}</div>}
                <div className="mt-1 text-xs" style={{ color: 'var(--text-faint)' }}>{selectedContact.category}</div>
              </div>
            </div>

            <p className="mb-4 text-xs" style={{ color: 'var(--text-secondary)' }}>
              <strong>{selectedContact.name}</strong> will be deleted. Any empty fields on{' '}
              <strong>{primaryContact.name}</strong> will be filled from the duplicate. Notes will be
              combined. Activity history will be merged.
            </p>

            {error && (
              <p className="mb-4 text-xs" style={{ color: 'var(--danger)' }}>{error}</p>
            )}

            <div className="flex gap-3 justify-end">
              <button
                onClick={() => { setStep('search'); setSelectedContact(null) }}
                className="rounded-md px-4 py-2 text-sm"
                style={{ background: 'var(--hover-light)', color: 'var(--text-primary)', border: 'none', cursor: 'pointer' }}
              >
                Back
              </button>
              <button
                onClick={handleMerge}
                disabled={merging}
                className="rounded-md px-4 py-2 text-sm font-medium"
                style={{
                  background: merging ? 'rgba(196,78,82,0.5)' : 'var(--danger)',
                  color: '#ffffff',
                  border: 'none',
                  cursor: merging ? 'not-allowed' : 'pointer',
                }}
              >
                {merging ? 'Merging...' : 'Merge Contacts'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
