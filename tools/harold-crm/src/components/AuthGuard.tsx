'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'

/**
 * AuthGuard gates rendering until the client-side session is resolved.
 *
 * The redirect to /login is a safety net for when a session genuinely expires
 * while the user is on the page. The middleware handles the server-side case,
 * but if auth state changes client-side (e.g., token refresh fails after hours
 * of idle), this catches it.
 *
 * The AuthProvider's getSession() WAITS for token refresh to complete before
 * setting loading=false, so we won't get false negatives during token refresh.
 */
export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading, isMember, signOut } = useAuth()
  const router = useRouter()
  const redirectAttempted = useRef(false)

  useEffect(() => {
    // Only redirect once to prevent loops. If the redirect doesn't result
    // in a login (because middleware bounces us back), don't keep trying.
    if (!loading && !user && !redirectAttempted.current) {
      redirectAttempted.current = true
      router.replace('/login')
    }
  }, [loading, user, router])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div
            className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-solid border-current border-r-transparent"
            style={{ color: 'var(--accent)' }}
          />
          <p className="mt-3 text-sm" style={{ color: 'var(--text-secondary)' }}>Loading...</p>
        </div>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div
            className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-solid border-current border-r-transparent"
            style={{ color: 'var(--accent)' }}
          />
          <p className="mt-3 text-sm" style={{ color: 'var(--text-secondary)' }}>Redirecting...</p>
        </div>
      </div>
    )
  }

  if (isMember === false) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="max-w-md rounded-lg p-6 text-center" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>
          <h1 className="mb-2 text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
            You are signed in, but not a member yet
          </h1>
          <p className="mb-4 text-sm" style={{ color: 'var(--text-secondary)' }}>
            This CRM only shows data to accounts listed in <code>crm_members</code>. Ask the owner to add
            {' '}<strong>{user.email}</strong>, or if this is your own deployment, run the SQL in the README
            under &ldquo;Add yourself as the first member&rdquo;.
          </p>
          <button
            onClick={async () => { await signOut(); router.replace('/login') }}
            className="rounded-md px-4 py-2 text-sm"
            style={{ background: 'var(--hover-light)', color: 'var(--text-primary)', border: 'none', cursor: 'pointer' }}
          >
            Sign out
          </button>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
