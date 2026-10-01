'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

export function useCommandPalette() {
  const [open, setOpen] = useState(false)
  // When true, Escape is handled by the palette (e.g. exiting actions mode)
  const escapeOverrideRef = useRef(false)

  const toggle = useCallback(() => setOpen((prev) => !prev), [])
  const close = useCallback(() => setOpen(false), [])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        toggle()
      }
      if (e.key === 'Escape' && open) {
        if (escapeOverrideRef.current) {
          e.preventDefault()
          return
        }
        e.preventDefault()
        close()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, toggle, close])

  return { open, setOpen, close, toggle, escapeOverrideRef }
}
