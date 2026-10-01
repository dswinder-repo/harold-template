'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { ContactCategoryRow } from '@/lib/types'

/**
 * A contact's labels: the rows in the contact_categories table.
 *
 * Labels are independent of the contact's type. A contact has exactly one type,
 * held in contacts.category, and any number of labels, including none. Adding or
 * removing a label never touches the type, and a label is never a copy of the
 * type. Use setPrimaryCategory (alias setType) to change the type.
 *
 * (The function names say "category" because Harold's schema names the label
 * table contact_categories.)
 */
export function useContactCategories(contactId?: string) {
  const supabase = createClient()
  const [entries, setEntries] = useState<ContactCategoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  const fetchEntries = useCallback(async () => {
    setLoading(true)
    let query = supabase.from('contact_categories').select('*')
    if (contactId) query = query.eq('contact_id', contactId)
    const { data } = await query.order('created_at', { ascending: true })
    setEntries((data ?? []) as ContactCategoryRow[])
    setLoading(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- supabase is a module-level singleton
  }, [contactId])

  useEffect(() => {
    fetchEntries()
  }, [fetchEntries])

  // Realtime
  useEffect(() => {
    if (channelRef.current) supabase.removeChannel(channelRef.current)

    const filter = contactId ? `contact_id=eq.${contactId}` : undefined
    const channel = supabase
      .channel(`contact-cats-${contactId ?? 'all'}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'contact_categories', ...(filter ? { filter } : {}) },
        () => { fetchEntries() }
      )
      .subscribe()

    channelRef.current = channel
    return () => { supabase.removeChannel(channel) }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- supabase is a module-level singleton
  }, [contactId, fetchEntries])

  /** Get category names for a specific contact */
  const getCategoriesForContact = useCallback((cId: string): string[] => {
    return entries.filter((e) => e.contact_id === cId).map((e) => e.category_name)
  }, [entries])

  /** Add a category to a contact */
  const addCategory = async (cId: string, categoryName: string) => {
    const { error } = await supabase
      .from('contact_categories')
      .insert({ contact_id: cId, category_name: categoryName })
    return { error }
  }

  /** Remove a category from a contact */
  const removeCategory = async (cId: string, categoryName: string) => {
    const { error } = await supabase
      .from('contact_categories')
      .delete()
      .eq('contact_id', cId)
      .eq('category_name', categoryName)
    return { error }
  }

  /** Toggle a label on or off for a contact.
   *  Reads current state from the database to avoid stale-UI races. */
  const toggleCategory = async (cId: string, categoryName: string) => {
    // Always check DB for current categories — never rely on stale UI state
    const { data: currentRows } = await supabase
      .from('contact_categories')
      .select('category_name')
      .eq('contact_id', cId)
    const currentCategories = (currentRows ?? []).map((r: { category_name: string }) => r.category_name)
    const has = currentCategories.includes(categoryName)

    if (has) {
      // Remove it
      const { error: delError } = await removeCategory(cId, categoryName)
      if (delError) {
        console.error('Failed to remove label:', delError)
        return { error: delError }
      }
      // Verify the row was actually deleted (RLS can make a delete silently match nothing)
      const { data: checkRows } = await supabase
        .from('contact_categories')
        .select('category_name')
        .eq('contact_id', cId)
      const afterDelete = (checkRows ?? []).map((r: { category_name: string }) => r.category_name)
      if (afterDelete.includes(categoryName)) {
        // Delete silently failed (RLS or other issue)
        console.error('Label delete was silently blocked')
        return { error: { message: 'Label could not be removed' } }
      }
    } else {
      // Add it
      const { error: addError } = await addCategory(cId, categoryName)
      if (addError) {
        console.error('Failed to add label:', addError)
        return { error: addError }
      }
    }
    return { error: null }
  }

  /** Set the contact's one type. A label with the same name is removed: labels never repeat the type. */
  const setPrimaryCategory = async (cId: string, categoryName: string) => {
    const { error } = await supabase
      .from('contacts')
      .update({ category: categoryName })
      .eq('id', cId)
    if (!error) await removeCategory(cId, categoryName)
    return { error }
  }

  return {
    entries,
    loading,
    getCategoriesForContact,
    addCategory,
    removeCategory,
    toggleCategory,
    setPrimaryCategory,
    // Clearer names for the same operations
    getLabelsForContact: getCategoriesForContact,
    toggleLabel: toggleCategory,
    setType: setPrimaryCategory,
    refetch: fetchEntries,
  }
}
