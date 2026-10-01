'use client'

import { SkeletonBlock, SkeletonLine } from './Skeleton'
import ContactGridSkeleton from './ContactGridSkeleton'

function KPIBarSkeleton() {
  return (
    <div className="flex gap-3 overflow-x-auto">
      {Array.from({ length: 5 }, (_, i) => (
        <div
          key={i}
          className="flex min-w-[120px] flex-1 flex-col gap-2 rounded-lg p-3"
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}
        >
          <SkeletonLine width="70%" height={12} />
          <SkeletonLine width="40%" height={24} />
        </div>
      ))}
    </div>
  )
}

function ChartsSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <SkeletonBlock height={160} />
      <SkeletonBlock height={160} />
      <SkeletonBlock height={160} />
    </div>
  )
}

function FilterBarSkeleton() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <SkeletonBlock width={220} height={36} radius={6} />
      <SkeletonBlock width={100} height={32} radius={6} />
      <SkeletonBlock width={100} height={32} radius={6} />
      <SkeletonBlock width={100} height={32} radius={6} />
    </div>
  )
}

export default function DashboardSkeleton() {
  return (
    <div>
      <div className="mb-6">
        <KPIBarSkeleton />
      </div>
      <div className="mb-6">
        <ChartsSkeleton />
      </div>
      <div className="mb-6">
        <FilterBarSkeleton />
      </div>
      <div className="mb-3">
        <SkeletonLine width={90} height={14} />
      </div>
      <ContactGridSkeleton />
    </div>
  )
}
