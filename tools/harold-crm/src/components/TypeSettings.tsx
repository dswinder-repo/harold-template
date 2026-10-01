'use client'

import { useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { useCategories } from '@/hooks/useCategories'
import { useToast } from '@/hooks/useToast'
import { createClient } from '@/lib/supabase/client'
import AddCategoryModal from '@/components/AddCategoryModal'

/**
 * The owner's list of contact types. Every contact has exactly one type, chosen
 * from this list. (Labels are separate; see the Labels tab.)
 */
export default function TypeSettings() {
  const { user } = useAuth()
  const { toast } = useToast()
  const { categories, createCategory, refetch } = useCategories()
  const [showAdd, setShowAdd] = useState(false)

  const remove = async (id: string, name: string) => {
    const supabase = createClient()
    const { count } = await supabase
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .eq('category', name)
    if ((count ?? 0) > 0) {
      toast({ title: `${count} contact(s) still have this type. Change them first.`, type: 'warning' })
      return
    }
    const { error } = await supabase.from('categories').delete().eq('id', id)
    if (error) toast({ title: `Could not delete: ${error.message}`, type: 'error' })
    else refetch()
  }

  return (
    <div className="rounded-lg p-5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>
      <h2 className="mb-1 text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Contact Types</h2>
      <p className="mb-4 text-sm" style={{ color: 'var(--text-secondary)' }}>
        Every contact has exactly one type: what that person is to you. Anything else worth tagging is a label.
      </p>
      <div className="mb-4 flex flex-col gap-1.5">
        {categories.map((c) => (
          <div
            key={c.id}
            className="flex items-center gap-3 rounded-md px-3 py-2"
            style={{ background: 'var(--hover-faint)' }}
          >
            <span className="h-3 w-3 rounded-full" style={{ background: c.color }} />
            <span className="flex-1 text-sm" style={{ color: 'var(--text-primary)' }}>
              {c.label} <span style={{ color: 'var(--text-faint)' }}>({c.name})</span>
            </span>
            {c.is_default ? (
              <span className="text-xs" style={{ color: 'var(--text-faint)' }}>default</span>
            ) : (
              <button
                onClick={() => remove(c.id, c.name)}
                className="text-xs"
                style={{ color: 'var(--danger)', background: 'none', border: 'none', cursor: 'pointer' }}
              >
                Delete
              </button>
            )}
          </div>
        ))}
      </div>
      <button
        onClick={() => setShowAdd(true)}
        className="rounded-md px-4 py-2 text-sm font-medium"
        style={{ background: 'var(--accent)', color: '#fff', border: 'none', cursor: 'pointer' }}
      >
        + Add Type
      </button>
      {showAdd && (
        <AddCategoryModal
          onClose={() => setShowAdd(false)}
          onCreate={async (name, label, color) => {
            if (!user) return { error: 'Not authenticated' }
            return await createCategory(name, label, color, user.id)
          }}
        />
      )}
    </div>
  )
}
