'use client'

import { useEffect, useRef, useState } from 'react'
import type { Contact, Category } from '@/lib/types'
import { DEFAULT_CATEGORY_COLORS } from '@/lib/types'

interface KPIBarProps {
  contacts: Contact[]
  categories?: Category[]
  getCategoriesForContact?: (contactId: string) => string[]
  onFilter?: (filterKey: string) => void
  activeFilter?: string
}

interface KPIItem {
  label: string
  value: number
  color: string
  filterKey: string
}

function useCountUp(target: number, duration = 600): number {
  const [count, setCount] = useState(0)
  const rafRef = useRef<number | null>(null)
  const reducedMotion = useRef(false)

  useEffect(() => {
    // Check reduced motion preference once on mount
    reducedMotion.current =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (reducedMotion.current) {
      setCount(target)
      return
    }

    const startTime = performance.now()

    const tick = (now: number) => {
      const elapsed = now - startTime
      const progress = Math.min(elapsed / duration, 1)
      // easeOutCubic: fast start, decelerates to stop
      const eased = 1 - Math.pow(1 - progress, 3)
      setCount(Math.round(eased * target))

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick)
      }
    }

    rafRef.current = requestAnimationFrame(tick)

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
      }
    }
  // Re-run if the target value changes (e.g. after data loads)
  }, [target, duration])

  return count
}

function AnimatedNumber({ value }: { value: number }) {
  const count = useCountUp(value)
  const [pulse, setPulse] = useState(false)
  const prev = useRef(value)

  useEffect(() => {
    if (prev.current !== value) {
      prev.current = value
      const t = setTimeout(() => {
        setPulse(true)
        setTimeout(() => setPulse(false), 300)
      }, 600)
      return () => clearTimeout(t)
    }
  }, [value])

  return <span className={pulse ? 'animate-count-pulse' : undefined}>{count}</span>
}

export default function KPIBar({ contacts, categories, onFilter, activeFilter }: KPIBarProps) {
  const total = contacts.length
  const active = contacts.filter((c) => c.status === 'active').length
  const highPriority = contacts.filter((c) => c.priority === 'high').length

  // One counter per type, counted from the type itself (contacts.category).
  // Labels live in contact_categories and are not counted here.
  const categoryItems: KPIItem[] = (categories ?? []).map((cat) => ({
    label: cat.label,
    value: contacts.filter((c) => c.category === cat.name).length,
    color: cat.color,
    filterKey: cat.name,
  }))

  // Fallback if categories haven't loaded yet
  const fallbackItems: KPIItem[] = categoryItems.length > 0
    ? categoryItems
    : [
        { label: 'Investors', value: contacts.filter((c) => c.category === 'investor').length, color: DEFAULT_CATEGORY_COLORS.investor, filterKey: 'investor' },
        { label: 'Partners', value: contacts.filter((c) => c.category === 'partner').length, color: DEFAULT_CATEGORY_COLORS.partner, filterKey: 'partner' },
        { label: 'Founders', value: contacts.filter((c) => c.category === 'founder').length, color: DEFAULT_CATEGORY_COLORS.founder, filterKey: 'founder' },
        { label: 'Team', value: contacts.filter((c) => c.category === 'team').length, color: DEFAULT_CATEGORY_COLORS.team, filterKey: 'team' },
      ]

  const items: KPIItem[] = [
    { label: 'Total', value: total, color: 'var(--accent)', filterKey: 'all' },
    ...fallbackItems,
    { label: 'Active', value: active, color: 'var(--positive)', filterKey: 'active' },
    { label: 'High Priority', value: highPriority, color: 'var(--danger)', filterKey: 'high_priority' },
  ]

  return (
    <div className="flex flex-wrap gap-2.5">
      {items.map((item) => {
        const isActive = activeFilter === item.filterKey
        return (
          <div
            key={item.label}
            className="flex min-w-[100px] flex-1 items-center gap-3 rounded-md px-3 py-2.5"
            style={{
              background: 'var(--bg-card)',
              borderLeft: `3px solid ${item.color}`,
              transition: 'all 0.2s ease',
              cursor: onFilter ? 'pointer' : 'default',
              outline: isActive ? `2px solid ${item.color}` : 'none',
              outlineOffset: '-1px',
            }}
            onClick={() => onFilter?.(item.filterKey)}
            onMouseEnter={(e) => {
              if (!onFilter) return
              e.currentTarget.style.transform = 'translateY(-3px) scale(1.02)'
              e.currentTarget.style.boxShadow = `0 8px 24px ${item.color.startsWith('var(') ? 'rgba(100,100,100,0.2)' : `${item.color}30`}`
            }}
            onMouseLeave={(e) => {
              if (!onFilter) return
              e.currentTarget.style.transform = 'translateY(0) scale(1)'
              e.currentTarget.style.boxShadow = 'none'
            }}
          >
            <div>
              <div className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
                <AnimatedNumber value={item.value} />
              </div>
              <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                {item.label}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
