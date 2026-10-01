'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { supabaseConfigured } from '@/lib/supabase/env'

export default function LoginClient() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const supabase = createClient()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      // Full page navigation ensures cookies are sent with the request
      window.location.href = '/dashboard'
    }
  }

  // Check for callback errors in URL
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search)
    const callbackError = params.get('error')
    if (callbackError && !error) {
      setTimeout(() => setError('Sign-in failed. Please try again.'), 0)
    }
  }

  return (
    <div
      className="flex min-h-screen items-center justify-center px-4"
    >
      <div className="w-full max-w-sm">
        {/* Logo area */}
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
            Harold CRM
          </h1>
          <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
            Sign in to your account
          </p>
        </div>

        {/* Form card */}
        <div
          className="rounded-lg p-6"
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-subtle)',
          }}
        >
          {!supabaseConfigured && (
            <div
              className="mb-4 rounded-md p-3 text-sm"
              style={{ background: 'rgba(255,193,7,0.15)', color: 'var(--text-primary)' }}
            >
              Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and
              NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (see .env.example), or run{' '}
              <code>pnpm dev:demo</code> to try the app on demo data.
            </div>
          )}
          {error && (
            <div
              className="mb-4 rounded-md p-3 text-sm"
              style={{ background: 'rgba(196,78,82,0.2)', color: 'var(--danger)' }}
            >
              {error}
            </div>
          )}

          {/* Email/password form */}
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label
                className="mb-1.5 block text-xs font-medium"
                style={{ color: 'var(--text-secondary)' }}
              >
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-md px-3 py-2.5 text-sm outline-none"
                style={{
                  background: 'var(--bg-primary)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-input)',
                }}
                placeholder="you@example.com"
                required
              />
            </div>

            <div>
              <label
                className="mb-1.5 block text-xs font-medium"
                style={{ color: 'var(--text-secondary)' }}
              >
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-md px-3 py-2.5 text-sm outline-none"
                style={{
                  background: 'var(--bg-primary)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-input)',
                }}
                placeholder="Enter your password"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="mt-2 w-full rounded-md py-2.5 text-sm font-medium transition-colors"
              style={{
                background: loading ? 'var(--hover-medium)' : 'var(--accent)',
                color: '#ffffff',
                border: 'none',
                cursor: loading ? 'not-allowed' : 'pointer',
              }}
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
