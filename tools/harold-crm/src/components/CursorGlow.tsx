'use client'

import { useEffect } from 'react'

export default function CursorGlow() {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const onMove = (e: MouseEvent) => {
      document.documentElement.style.setProperty('--glow-x', `${e.clientX}px`)
      document.documentElement.style.setProperty('--glow-y', `${e.clientY}px`)
    }

    document.addEventListener('mousemove', onMove, { passive: true })
    return () => document.removeEventListener('mousemove', onMove)
  }, [])

  return <div className="cursor-glow" />
}
