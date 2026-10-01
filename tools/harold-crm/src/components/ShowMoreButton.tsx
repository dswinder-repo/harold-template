'use client'

interface ShowMoreButtonProps {
  hiddenCount: number
  pageSize?: number
  onShowMore: () => void
  onShowAll?: () => void
}

export default function ShowMoreButton({
  hiddenCount,
  pageSize = 10,
  onShowMore,
  onShowAll,
}: ShowMoreButtonProps) {
  if (hiddenCount <= 0) return null

  const nextBatch = Math.min(hiddenCount, pageSize)

  return (
    <div className="flex items-center justify-center gap-3 py-3">
      <button
        onClick={onShowMore}
        className="rounded-md px-4 py-1.5 text-xs font-medium transition-colors"
        style={{
          background: 'var(--hover-light)',
          color: 'var(--text-secondary)',
          border: '1px solid var(--border-subtle)',
          cursor: 'pointer',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--hover-medium)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--hover-light)')}
      >
        Show {nextBatch} more
      </button>
      {onShowAll && hiddenCount > pageSize && (
        <button
          onClick={onShowAll}
          className="text-xs transition-colors"
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-tertiary)',
            cursor: 'pointer',
            textDecoration: 'underline',
            textUnderlineOffset: '2px',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-secondary)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-tertiary)')}
        >
          Show all {hiddenCount}
        </button>
      )}
    </div>
  )
}
