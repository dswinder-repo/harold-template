'use client'

import { SkeletonLine, SkeletonCircle } from './Skeleton'

function ContactCardSkeleton() {
  return (
    <div
      className="rounded-lg p-4"
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-subtle)',
      }}
    >
      <div className="flex items-start gap-3">
        <SkeletonCircle size={36} />
        <div className="flex-1">
          <SkeletonLine width="60%" height={16} />
          <div className="mt-2">
            <SkeletonLine width="40%" height={12} />
          </div>
          <div className="mt-3 flex gap-2">
            <SkeletonLine width={56} height={20} />
            <SkeletonLine width={48} height={20} />
          </div>
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <SkeletonLine width={60} height={14} />
        <SkeletonLine width={80} height={14} />
      </div>
    </div>
  )
}

export default function ContactGridSkeleton({ count = 9 }: { count?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }, (_, i) => (
        <ContactCardSkeleton key={i} />
      ))}
    </div>
  )
}
