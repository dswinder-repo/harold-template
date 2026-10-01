'use client'

import { useState } from 'react'
import { usePreferences } from '@/hooks/usePreferences'
import { useToast } from '@/hooks/useToast'
import { NOTIFICATION_TYPE_META } from '@/lib/types'
import type { NotificationType } from '@/lib/types'

const NOTIFICATION_TYPES: NotificationType[] = [
  'overdue_task',
  'due_today',
  'due_tomorrow',
  'stale_contact',
  'stuck_pipeline',
  'follow_up_storm',
  'warmth_decay',
]

export default function NotificationSettings() {
  const { loading, loaded, updateNotificationSetting, isNotificationEnabled } = usePreferences()
  const { toast } = useToast()
  const [savingType, setSavingType] = useState<string | null>(null)

  if (loading || !loaded) {
    return (
      <p className="py-8 text-center text-sm" style={{ color: 'var(--text-faint)' }}>
        Loading notification preferences...
      </p>
    )
  }

  const handleToggle = async (type: NotificationType) => {
    const currentlyEnabled = isNotificationEnabled(type)
    setSavingType(type)

    const { error } = await updateNotificationSetting(type, !currentlyEnabled)

    if (error) {
      toast({ title: `Failed to update: ${error}`, type: 'error' })
    } else {
      const meta = NOTIFICATION_TYPE_META[type]
      toast({
        title: `${meta.label} notifications ${!currentlyEnabled ? 'enabled' : 'disabled'}`,
        type: 'success',
      })
    }
    setSavingType(null)
  }

  return (
    <div
      className="rounded-lg p-5"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}
    >
      <h2 className="mb-1 text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
        Notification Preferences
      </h2>
      <p className="mb-5 text-xs" style={{ color: 'var(--text-faint)' }}>
        Choose which notification types you want to receive. All are enabled by default.
      </p>

      <div className="flex flex-col gap-1">
        {NOTIFICATION_TYPES.map((type) => {
          const meta = NOTIFICATION_TYPE_META[type]
          const enabled = isNotificationEnabled(type)
          const isSaving = savingType === type

          return (
            <div
              key={type}
              className="flex items-center justify-between rounded-md px-3 py-3 transition-colors"
              style={{ background: 'var(--bg-primary)' }}
            >
              <div className="flex items-center gap-3">
                <span className="text-base">{meta.icon}</span>
                <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                  {meta.label}
                </span>
              </div>

              {/* Toggle Switch */}
              <button
                onClick={() => handleToggle(type)}
                disabled={isSaving}
                className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none"
                style={{
                  background: enabled ? 'var(--accent)' : 'var(--hover-medium)',
                  cursor: isSaving ? 'wait' : 'pointer',
                  opacity: isSaving ? 0.6 : 1,
                  border: 'none',
                }}
                aria-label={`Toggle ${meta.label} notifications`}
                role="switch"
                aria-checked={enabled}
              >
                <span
                  className="inline-block h-4 w-4 rounded-full transition-transform"
                  style={{
                    background: '#ffffff',
                    transform: enabled ? 'translateX(22px)' : 'translateX(4px)',
                  }}
                />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
