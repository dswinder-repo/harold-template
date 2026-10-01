'use client'

import { useState, useMemo, useEffect } from 'react'

interface UseShowMoreOptions {
  pageSize?: number
  initialSize?: number
}

export function useShowMore<T>(items: T[], options: UseShowMoreOptions = {}) {
  const { pageSize = 10, initialSize = 10 } = options
  const [visibleCount, setVisibleCount] = useState(initialSize)

  // Reset when the source data changes (e.g., navigating to a new contact)
  const itemsLength = items.length
  useEffect(() => {
    setVisibleCount(initialSize)
  }, [itemsLength, initialSize])

  const visible = useMemo(() => items.slice(0, visibleCount), [items, visibleCount])

  return {
    visible,
    hasMore: visibleCount < items.length,
    hiddenCount: Math.max(0, items.length - visibleCount),
    total: items.length,
    showMore: () => setVisibleCount((c) => Math.min(c + pageSize, items.length)),
    showAll: () => setVisibleCount(items.length),
    reset: () => setVisibleCount(initialSize),
    isExpanded: visibleCount > initialSize,
  }
}
