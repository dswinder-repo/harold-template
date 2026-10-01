import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabaseUrlOrPlaceholder, supabaseKeyOrPlaceholder } from './env'

export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    supabaseUrlOrPlaceholder,
    supabaseKeyOrPlaceholder,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing sessions.
          }
        },
      },
    }
  )
}

/**
 * True when the signed-in user is listed in crm_members. Database policies
 * already hide all data from non-members; API routes check this too so a
 * non-member cannot spend the AI provider key either.
 */
export async function isCrmMember(supabase: Awaited<ReturnType<typeof createClient>>): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_crm_member')
  return !error && data === true
}
