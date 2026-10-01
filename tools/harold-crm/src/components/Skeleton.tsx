'use client'

const shimmerStyle: React.CSSProperties = {
  background: `linear-gradient(90deg, var(--skeleton-base) 25%, var(--skeleton-shine) 50%, var(--skeleton-base) 75%)`,
  backgroundSize: '200% 100%',
  animation: 'shimmer 1.5s ease-in-out infinite',
  borderRadius: '4px',
}

export function SkeletonLine({ width = '100%', height = 14 }: { width?: string | number; height?: number }) {
  return <div style={{ ...shimmerStyle, width, height }} />
}

export function SkeletonCircle({ size = 32 }: { size?: number }) {
  return <div style={{ ...shimmerStyle, width: size, height: size, borderRadius: '50%' }} />
}

export function SkeletonCard({ height = 80 }: { height?: number }) {
  return (
    <div
      style={{
        ...shimmerStyle,
        width: '100%',
        height,
        borderRadius: '8px',
      }}
    />
  )
}

export function SkeletonBlock({ width = '100%', height = 40, radius = 8 }: { width?: string | number; height?: number; radius?: number }) {
  return <div style={{ ...shimmerStyle, width, height, borderRadius: radius }} />
}
