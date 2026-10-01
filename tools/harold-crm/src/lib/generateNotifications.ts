import { createClient } from '@/lib/supabase/client'
import type { NotificationType, NotificationSeverity, WarmthType } from '@/lib/types'
import { WARMTH_DECAY_THRESHOLDS, REENGAGEMENT_SUGGESTIONS } from '@/lib/types'

// Contact types whose conversations are never logged (optional, empty by default). Same meaning as
// HAROLD_NO_LOG_TYPES in a Harold workspace; the NEXT_PUBLIC_ prefix makes it readable in the browser.
const NO_LOG_TYPES = (process.env.NEXT_PUBLIC_HAROLD_NO_LOG_TYPES ?? '')
  .split(',')
  .map((t) => t.trim().toLowerCase())
  .filter((t) => /^[a-z0-9_-]+$/.test(t))

interface NotificationInsert {
  user_id: string
  type: NotificationType
  title: string
  body: string
  contact_id?: string
  task_id?: string
  severity: NotificationSeverity
}

/**
 * Generate notifications from CRM data. Mirrors proactive_alerts() logic:
 * 1. Overdue tasks — tasks past due_date that aren't completed/cancelled
 * 2. Warmth decay — Hot/Warm/Lukewarm contacts gone quiet past their thresholds
 * 3. Stuck pipeline — an open entry in the same stage for 60+ days
 * 4. Follow-up storm — 5+ pending tasks due within 7 days
 *
 * Deduplicates against ALL existing notifications (including dismissed ones
 * from the last 7 days) to prevent dismissed alerts from being immediately
 * regenerated.
 *
 * Also auto-dismisses overdue_task notifications whose tasks have since been
 * completed or cancelled.
 */
export async function generateNotifications(userId: string): Promise<{ count: number; error: string | null }> {
  const supabase = createClient()
  const now = new Date()

  // ── Read user notification preferences (opt-out model: missing = enabled) ──
  const { data: userPrefs } = await supabase
    .from('user_preferences')
    .select('notification_settings')
    .eq('user_id', userId)
    .single()

  const notifSettings = (userPrefs?.notification_settings ?? {}) as Record<string, boolean>

  /** Check if a notification type is enabled for this user */
  function isTypeEnabled(type: NotificationType): boolean {
    return notifSettings[type] !== false // undefined or true → enabled
  }

  // ── Read warmth decay thresholds from crm_settings (fallback to hardcoded) ──
  const { data: warmthSettingsRow } = await supabase
    .from('crm_settings')
    .select('value')
    .eq('key', 'warmth_decay_thresholds')
    .single()

  const warmthThresholds = (warmthSettingsRow?.value ?? WARMTH_DECAY_THRESHOLDS) as Record<string, typeof WARMTH_DECAY_THRESHOLDS[keyof typeof WARMTH_DECAY_THRESHOLDS]>
  // Dedup strategy:
  // - ALL undismissed notifications are always deduped (never create a duplicate active alert)
  // - Dismissed notifications only block regeneration for 1 hour (cooldown period)
  //   This prevents the dismiss→regenerate loop while still allowing alerts to
  //   come back if the underlying issue persists after a reasonable cooldown
  // Fetch: all undismissed + recently dismissed (within 24 hours of creation)
  const { data: undismissed } = await supabase
    .from('notifications')
    .select('id, type, contact_id, task_id, dismissed, created_at')
    .eq('user_id', userId)
    .eq('dismissed', false)

  // Since there's no updated_at column, we check dismissed notifications created
  // in the last 24 hours — this captures alerts that were recently dismissed.
  // After 24 hours, they become eligible for regeneration if the issue persists.
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
  const { data: recentlyDismissed } = await supabase
    .from('notifications')
    .select('id, type, contact_id, task_id, dismissed, created_at')
    .eq('user_id', userId)
    .eq('dismissed', true)
    .gte('created_at', oneDayAgo)

  const existing = [...(undismissed ?? []), ...(recentlyDismissed ?? [])]

  const existingKeys = new Set(
    (existing ?? []).map((n: { type: string; contact_id: string | null; task_id: string | null }) =>
      `${n.type}:${n.contact_id ?? ''}:${n.task_id ?? ''}`
    )
  )

  // Auto-dismiss overdue_task and due_today notifications for tasks that are now completed/cancelled
  const taskNotifs = (existing ?? []).filter(
    (n: { type: string; dismissed: boolean }) =>
      (n.type === 'overdue_task' || n.type === 'due_today' || n.type === 'due_tomorrow') && !n.dismissed
  ) as Array<{ id: string; task_id: string | null }>

  if (taskNotifs.length > 0) {
    const taskIds = taskNotifs
      .map((n) => n.task_id)
      .filter(Boolean) as string[]

    if (taskIds.length > 0) {
      const { data: resolvedTasks } = await supabase
        .from('tasks')
        .select('id')
        .in('id', taskIds)
        .in('status', ['completed', 'cancelled'])

      const resolvedTaskIds = new Set((resolvedTasks ?? []).map((t: { id: string }) => t.id))

      // Dismiss notifications for resolved tasks
      const toDismiss = taskNotifs
        .filter((n) => n.task_id && resolvedTaskIds.has(n.task_id))
        .map((n) => n.id)

      if (toDismiss.length > 0) {
        await supabase
          .from('notifications')
          .update({ dismissed: true })
          .in('id', toDismiss)
      }
    }
  }

  const toInsert: NotificationInsert[] = []

  function isDuplicate(type: NotificationType, contactId?: string, taskId?: string): boolean {
    return existingKeys.has(`${type}:${contactId ?? ''}:${taskId ?? ''}`)
  }

  // 1. Overdue tasks — strictly before today
  // Use date-only strings (YYYY-MM-DD) to avoid timezone shift from .toISOString()
  // which converts local midnight to UTC, causing off-by-one day errors in US timezones
  const pad = (n: number) => String(n).padStart(2, '0')
  const startOfToday = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  const startOfTomorrow = `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}`
  if (isTypeEnabled('overdue_task')) {
    const { data: overdueTasks } = await supabase
      .from('tasks')
      .select('id, title, contact_id, due_date, contacts:contact_id ( id, name, org )')
      .not('status', 'in', '("completed","cancelled")')
      .not('due_date', 'is', null)
      .lt('due_date', startOfToday)
      .limit(50)

    for (const task of (overdueTasks ?? []) as Array<{
      id: string; title: string; contact_id: string | null; due_date: string;
      contacts: { id: string; name: string; org: string } | null
    }>) {
      if (isDuplicate('overdue_task', task.contact_id ?? undefined, task.id)) continue
      // Parse date-only portion as local midnight to avoid UTC off-by-one
      const dp = task.due_date.split('T')[0].split('-')
      const dueDateLocal = new Date(Number(dp[0]), Number(dp[1]) - 1, Number(dp[2]))
      const todayLocal = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      const daysOverdue = Math.round((todayLocal.getTime() - dueDateLocal.getTime()) / 86400000)
      toInsert.push({
        user_id: userId,
        type: 'overdue_task',
        title: `Overdue: ${task.title}`,
        body: task.contacts
          ? `${daysOverdue}d overdue for ${task.contacts.name}`
          : `${daysOverdue}d overdue (no contact)`,
        contact_id: task.contact_id ?? undefined,
        task_id: task.id,
        severity: daysOverdue > 7 ? 'critical' : 'warning',
      })
    }
  }

  // 1b. Tasks due today — pending/in_progress tasks with due_date = today
  if (isTypeEnabled('due_today')) {
    const { data: dueTodayTasks } = await supabase
      .from('tasks')
      .select('id, title, contact_id, due_date, contacts:contact_id ( id, name, org )')
      .not('status', 'in', '("completed","cancelled")')
      .not('due_date', 'is', null)
      .gte('due_date', startOfToday)
      .lt('due_date', startOfTomorrow)
      .limit(50)

    for (const task of (dueTodayTasks ?? []) as Array<{
      id: string; title: string; contact_id: string | null; due_date: string;
      contacts: { id: string; name: string; org: string } | null
    }>) {
      if (isDuplicate('due_today', task.contact_id ?? undefined, task.id)) continue
      toInsert.push({
        user_id: userId,
        type: 'due_today',
        title: `Due today: ${task.title}`,
        body: task.contacts
          ? `Due today for ${task.contacts.name}`
          : `Due today (no contact)`,
        contact_id: task.contact_id ?? undefined,
        task_id: task.id,
        severity: 'warning',
      })
    }
  }

  // 1c. Tasks due tomorrow — heads-up for upcoming tasks
  if (isTypeEnabled('due_tomorrow')) {
    const dayAfterTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2)
    const startOfDayAfterTomorrow = `${dayAfterTomorrow.getFullYear()}-${pad(dayAfterTomorrow.getMonth() + 1)}-${pad(dayAfterTomorrow.getDate())}`
    const { data: dueTomorrowTasks } = await supabase
      .from('tasks')
      .select('id, title, contact_id, due_date, contacts:contact_id ( id, name, org )')
      .not('status', 'in', '("completed","cancelled")')
      .not('due_date', 'is', null)
      .gte('due_date', startOfTomorrow)
      .lt('due_date', startOfDayAfterTomorrow)
      .limit(50)

    for (const task of (dueTomorrowTasks ?? []) as Array<{
      id: string; title: string; contact_id: string | null; due_date: string;
      contacts: { id: string; name: string; org: string } | null
    }>) {
      if (isDuplicate('due_tomorrow', task.contact_id ?? undefined, task.id)) continue
      toInsert.push({
        user_id: userId,
        type: 'due_tomorrow',
        title: `Due tomorrow: ${task.title}`,
        body: task.contacts
          ? `Due tomorrow for ${task.contacts.name}`
          : `Due tomorrow (no contact)`,
        contact_id: task.contact_id ?? undefined,
        task_id: task.id,
        severity: 'info',
      })
    }
  }

  // 2. Tiered relationship decay — warmth-based thresholds with auto-downgrade
  //    Each warmth level has an alertDays (warning) and decayDays (auto-downgrade).
  //    Past alertDays → stale_contact notification + re-engagement suggestion
  //    Past decayDays → auto-downgrade warmth + warmth_decay notification
  //    Uses DB thresholds (from crm_settings) with hardcoded fallback.
  //    Respects user notification preferences for stale_contact and warmth_decay.
  const staleEnabled = isTypeEnabled('stale_contact')
  const decayEnabled = isTypeEnabled('warmth_decay')

  if (staleEnabled || decayEnabled) {
    const decayWarmthLevels = Object.keys(warmthThresholds) as WarmthType[]
    // last_contacted_at is kept current by a database trigger on interactions.
    // Optional: NEXT_PUBLIC_HAROLD_NO_LOG_TYPES lists contact types whose conversations you never log
    // (empty by default). Their last-contact date would look stale forever, so they are skipped here.
    let warmQuery = supabase
      .from('contacts')
      .select('id, name, org, warmth, category, last_contacted_at')
      .in('warmth', decayWarmthLevels)
      .in('status', ['active', 'pending'])
    if (NO_LOG_TYPES.length) warmQuery = warmQuery.not('category', 'in', `(${NO_LOG_TYPES.join(',')})`)
    const { data: warmContacts } = await warmQuery.limit(500)

    if (warmContacts && warmContacts.length > 0) {
      for (const contact of warmContacts as Array<{
        id: string; name: string; org: string; warmth: WarmthType; category: string; last_contacted_at: string | null
      }>) {
        const threshold = warmthThresholds[contact.warmth]
        if (!threshold) continue

        const lastDate = contact.last_contacted_at
        if (!lastDate) continue // Skip contacts with no interaction history

        const daysSince = Math.floor(
          (now.getTime() - new Date(lastDate).getTime()) / 86400000
        )

        const category = contact.category || 'other'
        const suggestion = REENGAGEMENT_SUGGESTIONS[category] ?? REENGAGEMENT_SUGGESTIONS.default

        if (daysSince >= threshold.decayDays && decayEnabled) {
          // Auto-downgrade warmth
          const decayKey = `warmth_decay:${contact.id}:${contact.warmth}`
          if (!existingKeys.has(decayKey)) {
            // Update warmth in database
            await supabase
              .from('contacts')
              .update({ warmth: threshold.decaysTo })
              .eq('id', contact.id)

            toInsert.push({
              user_id: userId,
              type: 'warmth_decay',
              title: `${contact.warmth} → ${threshold.decaysTo}: ${contact.name}`,
              body: `${contact.name} (${contact.org}) — ${daysSince}d silent. Downgraded from ${contact.warmth} to ${threshold.decaysTo}. Suggestion: ${suggestion}`,
              contact_id: contact.id,
              severity: contact.warmth === 'Hot' ? 'critical' : 'warning',
            })
            existingKeys.add(decayKey)
          }
        } else if (daysSince >= threshold.alertDays && staleEnabled) {
          // Alert — going stale
          const staleKey = `stale_contact:${contact.id}:${contact.warmth}`
          if (!existingKeys.has(staleKey) && !isDuplicate('stale_contact', contact.id)) {
            toInsert.push({
              user_id: userId,
              type: 'stale_contact',
              title: `${contact.warmth} contact going cold`,
              body: `${contact.name} (${contact.org}) — ${daysSince}d since last interaction. Suggestion: ${suggestion}`,
              contact_id: contact.id,
              severity: contact.warmth === 'Hot' ? 'critical' : 'warning',
            })
            existingKeys.add(staleKey)
          }
        }
      }
    }
  }

  // 3. Stuck pipeline — an open entry in the same stage for 60+ days (Dormant excluded)
  if (isTypeEnabled('stuck_pipeline')) {
    const stuckThreshold = new Date(now.getTime() - 60 * 86400000).toISOString()
    const { data: stuckEntries } = await supabase
      .from('contact_pipelines')
      .select('id, contact_id, purpose, stage, entered_at, contacts ( id, name, org, status )')
      .is('closed_at', null)
      .neq('stage', 'Dormant')
      .lt('entered_at', stuckThreshold)
      .limit(100)

    for (const entry of (stuckEntries ?? []) as Array<{
      id: string; contact_id: string; purpose: string; stage: string; entered_at: string
      contacts: { id: string; name: string; org: string; status: string } | null
    }>) {
      if (!entry.contacts || !['active', 'pending'].includes(entry.contacts.status)) continue
      if (isDuplicate('stuck_pipeline', entry.contact_id)) continue
      const daysStuck = Math.floor((now.getTime() - new Date(entry.entered_at).getTime()) / 86400000)
      toInsert.push({
        user_id: userId,
        type: 'stuck_pipeline',
        title: `Stuck: ${entry.contacts.name}`,
        body: `${entry.stage} for ${daysStuck}d (${entry.purpose})`,
        contact_id: entry.contact_id,
        severity: daysStuck > 90 ? 'critical' : 'warning',
      })
    }
  }

  // 4. Follow-up storm — contacts with 5+ pending tasks due within 7 days
  if (isTypeEnabled('follow_up_storm')) {
    const weekFromNow = new Date(now.getTime() + 7 * 86400000).toISOString()
    const { data: urgentTasks } = await supabase
      .from('tasks')
      .select('contact_id, contacts:contact_id ( id, name, org )')
      .eq('status', 'pending')
      .not('due_date', 'is', null)
      .gte('due_date', now.toISOString())
      .lte('due_date', weekFromNow)

    if (urgentTasks && urgentTasks.length > 0) {
      const contactTaskCounts: Record<string, { count: number; name: string; org: string }> = {}
      for (const task of urgentTasks as Array<{
        contact_id: string | null
        contacts: { id: string; name: string; org: string } | null
      }>) {
        if (!task.contact_id || !task.contacts) continue
        if (!contactTaskCounts[task.contact_id]) {
          contactTaskCounts[task.contact_id] = { count: 0, name: task.contacts.name, org: task.contacts.org }
        }
        contactTaskCounts[task.contact_id].count++
      }

      for (const [contactId, info] of Object.entries(contactTaskCounts)) {
        if (info.count < 5) continue
        if (isDuplicate('follow_up_storm', contactId)) continue
        toInsert.push({
          user_id: userId,
          type: 'follow_up_storm',
          title: `Follow-up storm: ${info.name}`,
          body: `${info.count} tasks due within 7 days for ${info.name} (${info.org})`,
          contact_id: contactId,
          severity: info.count >= 8 ? 'critical' : 'warning',
        })
      }
    }
  }

  // Insert all new notifications
  if (toInsert.length === 0) {
    return { count: 0, error: null }
  }

  const { error } = await supabase.from('notifications').insert(toInsert)
  if (error) return { count: 0, error: error.message }

  return { count: toInsert.length, error: null }
}
