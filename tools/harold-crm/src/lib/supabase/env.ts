/**
 * Supabase connection settings, read from the environment.
 *
 * NEXT_PUBLIC_SUPABASE_URL                 your project URL
 * NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY     the publishable (or legacy anon) key
 *   (NEXT_PUBLIC_SUPABASE_ANON_KEY is accepted as the older name)
 *
 * Both are safe in the browser: with the members-only policies from migration
 * 004, the key alone can read nothing. Never put the service role / secret key
 * in a NEXT_PUBLIC_ variable.
 *
 * When they are missing, placeholder values keep the build and pre-rendering
 * working, and the login page says what to set.
 */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
export const SUPABASE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''

export const supabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_KEY)

export const supabaseUrlOrPlaceholder = SUPABASE_URL || 'http://localhost:54321'
export const supabaseKeyOrPlaceholder = SUPABASE_KEY || 'supabase-not-configured'
