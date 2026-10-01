'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useEnumOptions } from '@/hooks/useEnumOptions'
import { useAuth } from '@/components/AuthProvider'
import EnumGroupEditor from '@/components/EnumGroupEditor'
import AccountSettings from '@/components/AccountSettings'
import NotificationSettings from '@/components/NotificationSettings'
import WarmthRulesEditor from '@/components/WarmthRulesEditor'
import SenderProfileSettings from '@/components/SenderProfileSettings'
import TypeSettings from '@/components/TypeSettings'

interface TabGroup {
  key: string
  label: string
  adminOnly?: boolean
}

// Warmth levels, statuses and priorities are fixed by Harold's schema, so they
// are not editable here. Types, labels, investor types and regions are yours.
const ALL_GROUPS: TabGroup[] = [
  { key: 'account', label: 'Account' },
  { key: 'notifications', label: 'Notifications' },
  { key: 'sender', label: 'Sender Profile' },
  { key: 'types', label: 'Types' },
  { key: 'label', label: 'Labels' },
  { key: 'warmth_rules', label: 'Warmth Rules', adminOnly: true },
  { key: 'investor_type', label: 'Investor Types' },
  { key: 'region', label: 'Regions' },
]

export default function SettingsPage() {
  const router = useRouter()
  const [activeGroup, setActiveGroup] = useState('account')
  const { loading } = useEnumOptions()
  const { isAdmin } = useAuth()

  const groups = useMemo(
    () => ALL_GROUPS.filter((g) => !g.adminOnly || isAdmin),
    [isAdmin]
  )

  // Render the active panel content
  const renderContent = () => {
    switch (activeGroup) {
      case 'account':
        return <AccountSettings />
      case 'notifications':
        return <NotificationSettings />
      case 'warmth_rules':
        return <WarmthRulesEditor />
      case 'sender':
        return <SenderProfileSettings />
      case 'types':
        return <TypeSettings />
      default:
        // Pick-list editors (label, investor_type, region)
        return (
          <div
            className="rounded-lg p-5"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}
          >
            <h2 className="mb-4 text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
              {groups.find((g) => g.key === activeGroup)?.label}
            </h2>

            {loading ? (
              <p className="py-8 text-center text-sm" style={{ color: 'var(--text-faint)' }}>
                Loading options...
              </p>
            ) : (
              <EnumGroupEditor group={activeGroup} />
            )}
          </div>
        )
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
          Settings
        </h1>
        <button
          onClick={() => router.push('/dashboard')}
          className="text-xl leading-none"
          style={{ color: 'var(--text-secondary)', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 8px' }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-secondary)')}
          title="Back to dashboard"
        >
          ✕
        </button>
      </div>
      <p className="mb-6 text-sm" style={{ color: 'var(--text-secondary)' }}>
        Manage your account and CRM settings.
      </p>

      {/* Tab bar */}
      <div
        className="mb-6 flex gap-1 overflow-x-auto rounded-lg p-1"
        style={{ background: 'var(--bg-secondary)' }}
      >
        {groups.map(({ key, label }) => {
          const isActive = activeGroup === key
          return (
            <button
              key={key}
              onClick={() => setActiveGroup(key)}
              className="whitespace-nowrap rounded-md px-4 py-2 text-sm font-medium transition-colors"
              style={{
                background: isActive ? 'var(--bg-card)' : 'transparent',
                color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                border: 'none',
                cursor: 'pointer',
                boxShadow: isActive ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              }}
            >
              {label}
            </button>
          )
        })}
      </div>

      {/* Panel content */}
      {renderContent()}
    </div>
  )
}
