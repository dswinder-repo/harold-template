'use client'

import { useEffect, useRef, useCallback } from 'react'

/**
 * Attaches an IntersectionObserver to a container element that toggles
 * the `.revealed` class on children with `.scroll-reveal`.
 * Items stagger by `staggerMs` per index.
 */
export function useScrollReveal<T extends HTMLElement>(staggerMs = 40) {
  const containerRef = useRef<T>(null)

  const observe = useCallback(() => {
    const container = containerRef.current
    if (!container) return

    // Respect prefers-reduced-motion
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (prefersReduced) {
      container.querySelectorAll('.scroll-reveal').forEach((el) => el.classList.add('revealed'))
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        // Collect newly visible items
        const newlyVisible: Element[] = []
        for (const entry of entries) {
          if (entry.isIntersecting) {
            newlyVisible.push(entry.target)
            observer.unobserve(entry.target)
          }
        }
        // Stagger their reveal
        newlyVisible.forEach((el, i) => {
          setTimeout(() => el.classList.add('revealed'), i * staggerMs)
        })
      },
      { threshold: 0.15 }
    )

    container.querySelectorAll('.scroll-reveal:not(.revealed)').forEach((el) => observer.observe(el))

    return () => observer.disconnect()
  }, [staggerMs])

  useEffect(() => {
    // Small delay so DOM has rendered the items
    const timer = setTimeout(observe, 50)
    return () => clearTimeout(timer)
  }, [observe])

  // Re-observe when content changes
  const refresh = useCallback(() => {
    requestAnimationFrame(observe)
  }, [observe])

  return { containerRef, refresh }
}
