'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { CustomField, CustomFieldValue, CustomFieldType } from '@/lib/types'

interface UseCustomFieldsOptions {
  contactId?: string
}

export function useCustomFields({ contactId }: UseCustomFieldsOptions = {}) {
  const supabase = createClient()
  const [fields, setFields] = useState<CustomField[]>([])
  const [values, setValues] = useState<Record<string, string>>({}) // keyed by field_id
  const [loading, setLoading] = useState(true)
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  // Fetch all field definitions
  const fetchFields = useCallback(async () => {
    const { data } = await supabase
      .from('custom_fields')
      .select('*')
      .order('created_at', { ascending: true })

    if (data) setFields(data as CustomField[])
  // eslint-disable-next-line react-hooks/exhaustive-deps -- supabase is a module-level singleton
  }, [])

  // Fetch values for a specific contact
  const fetchValues = useCallback(async () => {
    if (!contactId) return
    const { data } = await supabase
      .from('contact_custom_values')
      .select('*')
      .eq('contact_id', contactId)

    if (data) {
      const map: Record<string, string> = {}
      for (const row of data as CustomFieldValue[]) {
        map[row.field_id] = row.value ?? ''
      }
      setValues(map)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- supabase is a module-level singleton
  }, [contactId])

  // Initial fetch
  useEffect(() => {
    const load = async () => {
      setLoading(true)
      await fetchFields()
      if (contactId) await fetchValues()
      setLoading(false)
    }
    load()
  }, [fetchFields, fetchValues, contactId])

  // Realtime subscriptions
  useEffect(() => {
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current)
    }

    const channel = supabase
      .channel('custom-fields-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'custom_fields' },
        () => { fetchFields() }
      )

    if (contactId) {
      channel.on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'contact_custom_values',
          filter: `contact_id=eq.${contactId}`,
        },
        () => { fetchValues() }
      )
    }

    channel.subscribe()
    channelRef.current = channel

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- supabase is a module-level singleton
  }, [contactId, fetchFields, fetchValues])

  // Create a new custom field definition
  const createField = async (
    fieldName: string,
    fieldType: CustomFieldType,
    options: string[] | null,
    userId: string
  ) => {
    const { data, error } = await supabase
      .from('custom_fields')
      .insert({
        field_name: fieldName,
        field_type: fieldType,
        options: options,
        created_by: userId,
      })
      .select()
      .single()

    if (error) return { error }
    setFields((prev) => [...prev, data as CustomField])
    return { data }
  }

  // Update (upsert) a custom field value for a contact
  const updateValue = async (
    cId: string,
    fieldId: string,
    value: string,
    userId: string
  ) => {
    const { error } = await supabase
      .from('contact_custom_values')
      .upsert(
        {
          contact_id: cId,
          field_id: fieldId,
          value,
          updated_by: userId,
        },
        { onConflict: 'contact_id,field_id' }
      )

    if (!error) {
      setValues((prev) => ({ ...prev, [fieldId]: value }))
    }
    return { error }
  }

  return {
    fields,
    values,
    loading,
    createField,
    updateValue,
  }
}
