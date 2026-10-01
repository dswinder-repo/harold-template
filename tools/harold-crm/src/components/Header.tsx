'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import NotificationBell from '@/components/NotificationBell'
import ThemeToggle from '@/components/ThemeToggle'

const NAV_LINKS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/pipeline', label: 'Pipeline' },
  { href: '/tasks', label: 'Tasks' },
  { href: '/map', label: 'Map' },
  { href: '/activity', label: 'Activity' },
  { href: '/investors', label: 'Investors' },
]

export default function Header() {
  const { profile, signOut } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)

  const handleSignOut = async () => {
    await signOut()
    router.push('/login')
  }

  return (
    <header
      className="sticky top-0 z-50 flex items-center justify-between px-6 py-3"
      style={{
        background: 'var(--header-glass-bg, rgba(10, 37, 64, 0.75))',
        backdropFilter: 'blur(16px) saturate(180%)',
        WebkitBackdropFilter: 'blur(16px) saturate(180%)',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        position: 'relative',
      }}
    >
      <div className="flex items-center gap-8">
        <Link
          href="/dashboard"
          className="text-lg font-bold tracking-tight"
          style={{ color: '#ffffff', textDecoration: 'none' }}
        >
          Harold CRM
        </Link>

        {/* Desktop nav — hidden on mobile */}
        <nav className="hidden items-center gap-4 md:flex">
          {NAV_LINKS.map(({ href, label }) => {
            const isActive = pathname === href || (href !== '/dashboard' && pathname.startsWith(href))
            return (
              <Link
                key={href}
                href={href}
                className="text-sm transition-all hover:opacity-100"
                style={{
                  color: isActive ? '#ffffff' : '#a0a0a0',
                  textDecoration: 'none',
                  borderBottom: isActive ? '2px solid #4C72B0' : '2px solid transparent',
                  paddingBottom: 2,
                }}
              >
                {label}
              </Link>
            )
          })}

        </nav>
      </div>

      <div className="flex items-center gap-3 md:gap-4">
        {/* + Add Contact — hidden on very small screens */}
        <Link
          href="/contacts/new"
          className="hidden rounded px-3 py-1.5 text-sm font-medium transition-colors sm:block"
          style={{
            background: '#4C72B0',
            color: '#ffffff',
            textDecoration: 'none',
          }}
        >
          + Add Contact
        </Link>

        {/* Search trigger — always visible, especially useful on mobile */}
        <button
          onClick={() => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))
          }}
          className="flex items-center justify-center rounded p-1.5 transition-colors"
          style={{
            color: '#a0a0a0',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
          }}
          title="Search (⌘K)"
          aria-label="Search"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </button>

        <ThemeToggle />
        {profile && <NotificationBell userId={profile.id} />}

        <Link
          href="/settings"
          className="hidden items-center justify-center rounded p-1.5 transition-colors md:flex"
          style={{
            color: pathname === '/settings' ? '#ffffff' : '#a0a0a0',
            background: pathname === '/settings' ? 'rgba(255,255,255,0.15)' : 'transparent',
            textDecoration: 'none',
          }}
          title="Settings"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </Link>

        {/* Avatar + name — hide name on small screens */}
        {profile && (
          <div className="hidden items-center gap-3 sm:flex">
            <div
              className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold"
              style={{ background: 'rgba(255,255,255,0.15)', color: '#ffffff' }}
            >
              {profile.full_name
                .split(' ')
                .map((n) => n[0])
                .join('')
                .toUpperCase()
                .slice(0, 2)}
            </div>
            <span className="hidden text-sm lg:inline" style={{ color: '#a0a0a0' }}>
              {profile.full_name}
            </span>
          </div>
        )}

        <button
          onClick={handleSignOut}
          className="btn-press hidden rounded px-3 py-1.5 text-sm transition-colors md:block"
          style={{
            background: 'rgba(255,255,255,0.1)',
            color: '#ffffff',
            border: 'none',
            cursor: 'pointer',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.2)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.1)')}
        >
          Logout
        </button>

        {/* Hamburger — mobile only */}
        <button
          className="ml-1 flex items-center justify-center rounded p-2 md:hidden"
          onClick={() => setMobileOpen(!mobileOpen)}
          style={{
            color: '#fff',
            background: mobileOpen ? 'rgba(255,255,255,0.15)' : 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: 20,
            lineHeight: 1,
          }}
          aria-label="Toggle menu"
        >
          {mobileOpen ? '✕' : '☰'}
        </button>
      </div>

      {/* Mobile dropdown menu */}
      {mobileOpen && (
        <div
          className="md:hidden"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            zIndex: 50,
            background: 'rgba(10,37,64,0.97)',
            borderBottom: '1px solid rgba(255,255,255,0.08)',
            padding: '8px 0 12px',
          }}
          onClick={() => setMobileOpen(false)}
        >
          {/* Search — mobile menu entry */}
          <button
            className="block w-full px-6 py-2.5 text-left text-sm"
            style={{ color: '#4C72B0', background: 'none', border: 'none', cursor: 'pointer', borderLeft: '3px solid transparent' }}
            onClick={() => {
              setMobileOpen(false)
              setTimeout(() => {
                window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))
              }, 50)
            }}
          >
            🔍 Search
          </button>

          {/* Divider */}
          <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '4px 24px 4px' }} />

          {/* Nav links */}
          {NAV_LINKS.map(({ href, label }) => {
            const isActive = pathname === href || (href !== '/dashboard' && pathname.startsWith(href))
            return (
              <Link
                key={href}
                href={href}
                className="block px-6 py-2.5 text-sm"
                style={{
                  color: isActive ? '#ffffff' : '#a0a0a0',
                  textDecoration: 'none',
                  borderLeft: isActive ? '3px solid #4C72B0' : '3px solid transparent',
                }}
              >
                {label}
              </Link>
            )
          })}
          {/* Divider */}
          <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '8px 24px' }} />

          {/* Secondary links */}
          <Link
            href="/contacts/new"
            className="block px-6 py-2.5 text-sm"
            style={{ color: '#4C72B0', textDecoration: 'none' }}
          >
            + Add Contact
          </Link>
          <Link
            href="/settings"
            className="block px-6 py-2.5 text-sm"
            style={{ color: '#a0a0a0', textDecoration: 'none' }}
          >
            Settings
          </Link>

          {/* Divider */}
          <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '8px 24px' }} />

          {/* Sign out */}
          <button
            onClick={handleSignOut}
            className="block w-full px-6 py-2.5 text-left text-sm"
            style={{ color: '#ff6b6b', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            Logout
          </button>
        </div>
      )}
    </header>
  )
}
