'use client'

import { SkeletonLine, SkeletonCircle, SkeletonBlock, SkeletonCard } from './Skeleton'

export default function ContactDetailSkeleton() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <div className="mb-6 flex items-center gap-3">
        <SkeletonLine width={60} height={14} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left column — contact info */}
        <div className="space-y-4">
          <div
            className="rounded-lg p-5"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}
          >
            <div className="mb-4 flex items-center gap-3">
              <SkeletonCircle size={48} />
              <div className="flex-1 space-y-2">
                <SkeletonLine width="70%" height={18} />
                <SkeletonLine width="50%" height={14} />
              </div>
            </div>
            <div className="space-y-3">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="flex items-center justify-between">
                  <SkeletonLine width={80} height={12} />
                  <SkeletonLine width={120} height={12} />
                </div>
              ))}
            </div>
          </div>

          <SkeletonBlock height={100} />
        </div>

        {/* Right column — tabs */}
        <div className="lg:col-span-2">
          <div className="mb-4 flex gap-2">
            {Array.from({ length: 4 }, (_, i) => (
              <SkeletonBlock key={i} width={80} height={32} radius={6} />
            ))}
          </div>
          <div className="space-y-3">
            {Array.from({ length: 4 }, (_, i) => (
              <SkeletonCard key={i} height={72} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
