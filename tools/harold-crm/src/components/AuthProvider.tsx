'use client'

import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Profile } from '@/lib/types'
import type { User } from '@supabase/supabase-js'

interface AuthContextType {
  user: User | null
  profile: Profile | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
  isAdmin: boolean
  /** Whether the signed-in user is listed in crm_members. null until known. */
  isMember: boolean | null
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  loading: true,
  signIn: async () => ({ error: null }),
  signOut: async () => {},
  refreshProfile: async () => {},
  isAdmin: false,
  isMember: null,
})

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [isMember, setIsMember] = useState<boolean | null>(null)
  const supabase = createClient()
  const initializedRef = useRef(false)

  const fetchProfile = useCallback(async (userId: string) => {
    // Membership decides whether any data is visible (see migration 004).
    // Demo mode has no database, so it always counts as a member.
    if (process.env.NEXT_PUBLIC_DEMO_MODE === '1') {
      setIsMember(true)
    } else {
      const { data: member } = await supabase.rpc('is_crm_member')
      setIsMember(member === true)
    }
    try {
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single()
      if (data) setProfile(data as Profile)
    } catch {
      // Profile fetch failed — user is still authenticated, just no profile data
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- supabase is a module-level singleton
  }, [])

  useEffect(() => {
    // Prevent double-initialization in React strict mode
    if (initializedRef.current) return
    initializedRef.current = true

    let mounted = true

    // Call getSession() FIRST, THEN register onAuthStateChange.
    //
    // Why this order matters:
    // - getSession() reads from localStorage and auto-refreshes expired tokens
    //   in a single atomic operation. It WAITS for the refresh to complete.
    // - onAuthStateChange fires INITIAL_SESSION immediately — but when the token
    //   is expired, it fires with session=null BEFORE the refresh completes,
    //   causing a false "not authenticated" state.
    // - If both run concurrently, they fight over the SDK's internal auth lock,
    //   causing getSession() to deadlock.
    //
    // Solution: getSession() first (resolves auth state reliably), then register
    // the listener for subsequent events (sign-in, sign-out, token refresh).

    let subscription: { unsubscribe: () => void } | null = null

    const init = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()

        if (!mounted) return

        const currentUser = session?.user ?? null
        setUser(currentUser)

        if (currentUser) {
          await fetchProfile(currentUser.id)
        } else {
          setProfile(null)
        }
      } catch {
        // Session retrieval failed — treat as no session
        if (mounted) {
          setUser(null)
          setProfile(null)
        }
      } finally {
        if (mounted) {
          setLoading(false)
        }
      }

      // Register listener for subsequent auth changes AFTER getSession resolves
      if (!mounted) return

      const { data } = supabase.auth.onAuthStateChange(
        async (event: string, session: { user: User | null } | null) => {
          if (!mounted) return

          // Skip INITIAL_SESSION — already handled via getSession() above
          if (event === 'INITIAL_SESSION') return

          const currentUser = session?.user ?? null
          setUser(currentUser)

          if (currentUser) {
            await fetchProfile(currentUser.id)
          } else {
            setProfile(null)
          }
        }
      )
      subscription = data.subscription
    }

    init()

    return () => {
      mounted = false
      subscription?.unsubscribe()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchProfile])

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const refreshProfile = useCallback(async () => {
    if (user) await fetchProfile(user.id)
  }, [user, fetchProfile])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setUser(null)
    setProfile(null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading,
        signIn,
        signOut,
        refreshProfile,
        isAdmin: profile?.role === 'admin',
        isMember,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
