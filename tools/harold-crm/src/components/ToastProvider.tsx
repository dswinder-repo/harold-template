'use client'

import { createContext, useState, useCallback, useRef, useEffect } from 'react'
import type { Toast, ToastType } from '@/lib/types'

interface ToastInput {
  title: string
  type?: ToastType
  duration?: number
  undo?: () => void
  progress?: number      // 0–100; renders SVG progress ring
  showSpinner?: boolean  // indeterminate spinning ring
}

interface ToastContextValue {
  toast: (input: ToastInput) => string
  dismiss: (id: string) => void
}

export const ToastContext = createContext<ToastContextValue | null>(null)

const MAX_VISIBLE = 3

const TYPE_STYLES: Record<ToastType, { bg: string; border: string; icon: string }> = {
  success: { bg: 'rgba(40,167,69,0.12)', border: 'rgba(40,167,69,0.3)', icon: '✓' },
  error: { bg: 'rgba(196,78,82,0.12)', border: 'rgba(196,78,82,0.3)', icon: '✕' },
  warning: { bg: 'rgba(221,132,82,0.12)', border: 'rgba(221,132,82,0.3)', icon: '⚠' },
  info: { bg: 'rgba(76,114,176,0.12)', border: 'rgba(76,114,176,0.3)', icon: 'ℹ' },
}

const TYPE_COLORS: Record<ToastType, string> = {
  success: 'var(--success)',
  error: 'var(--danger)',
  warning: 'var(--warning)',
  info: 'var(--accent)',
}

let nextId = 0

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const dismiss = useCallback((id: string) => {
    const timer = timersRef.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timersRef.current.delete(id)
    }
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const toast = useCallback(
    (input: ToastInput) => {
      const id = `toast-${++nextId}`
      const duration = input.duration ?? 5000
      const newToast: Toast = {
        id,
        title: input.title,
        type: input.type ?? 'info',
        duration,
        undo: input.undo,
        progress: input.progress,
        showSpinner: input.showSpinner,
      }

      setToasts((prev) => {
        const next = [...prev, newToast]
        // Keep only MAX_VISIBLE + buffer
        if (next.length > MAX_VISIBLE + 2) return next.slice(-MAX_VISIBLE - 1)
        return next
      })

      // Auto-dismiss
      const timer = setTimeout(() => dismiss(id), duration)
      timersRef.current.set(id, timer)
      return id
    },
    [dismiss]
  )

  // Cleanup timers on unmount
  useEffect(() => {
    const timers = timersRef.current
    return () => {
      timers.forEach((t) => clearTimeout(t))
      timers.clear()
    }
  }, [])

  const visible = toasts.slice(-MAX_VISIBLE)

  return (
    <ToastContext.Provider value={{ toast, dismiss }}>
      {children}

      {/* Toast container */}
      <div
        style={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          zIndex: 1000,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          pointerEvents: 'none',
        }}
      >
        {visible.map((t) => {
          const s = TYPE_STYLES[t.type]
          const accentColor = TYPE_COLORS[t.type]
          // SVG ring geometry (r=8 gives a 20px total diameter with stroke-width=4)
          const RADIUS = 8
          const CIRCUMFERENCE = 2 * Math.PI * RADIUS
          const hasProgress = t.progress !== undefined
          const isDone = hasProgress && t.progress! >= 100
          // How much of the ring is filled (stroke-dashoffset counts from full)
          const offset = hasProgress
            ? CIRCUMFERENCE - (t.progress! / 100) * CIRCUMFERENCE
            : CIRCUMFERENCE * 0.75 // indeterminate: show 75% arc

          return (
            <div
              key={t.id}
              className="animate-micro-fade-in"
              style={{
                pointerEvents: 'auto',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 14px',
                borderRadius: 8,
                background: 'var(--bg-card)',
                border: `1px solid ${s.border}`,
                boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
                minWidth: 280,
                maxWidth: 400,
                animation: 'micro-fade-in 200ms ease-out',
              }}
            >
              {/* Icon / progress ring */}
              {hasProgress || t.showSpinner ? (
                <span
                  style={{
                    flexShrink: 0,
                    width: 20,
                    height: 20,
                    position: 'relative',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {/* SVG ring — hidden once done, replaced by checkmark */}
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 20 20"
                    style={{
                      position: 'absolute',
                      inset: 0,
                      opacity: isDone ? 0 : 1,
                      transition: 'opacity 200ms ease',
                      animation: (!hasProgress && t.showSpinner)
                        ? 'toast-spin 900ms linear infinite'
                        : 'none',
                    }}
                  >
                    {/* Gray background ring */}
                    <circle
                      cx="10"
                      cy="10"
                      r={RADIUS}
                      fill="none"
                      stroke="rgba(255,255,255,0.12)"
                      strokeWidth="3"
                    />
                    {/* Colored foreground arc */}
                    <circle
                      cx="10"
                      cy="10"
                      r={RADIUS}
                      fill="none"
                      stroke={accentColor}
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeDasharray={CIRCUMFERENCE}
                      strokeDashoffset={offset}
                      transform="rotate(-90 10 10)"
                      style={{
                        transition: hasProgress
                          ? 'stroke-dashoffset 200ms ease-out'
                          : 'none',
                      }}
                    />
                  </svg>
                  {/* Checkmark flash when progress hits 100 */}
                  <span
                    style={{
                      position: 'absolute',
                      inset: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 12,
                      fontWeight: 700,
                      color: accentColor,
                      opacity: isDone ? 1 : 0,
                      transition: 'opacity 200ms ease',
                    }}
                  >
                    ✓
                  </span>
                </span>
              ) : (
                /* Default text icon */
                <span
                  style={{
                    fontSize: 14,
                    fontWeight: 700,
                    color: accentColor,
                    flexShrink: 0,
                    width: 20,
                    height: 20,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: '50%',
                    background: s.bg,
                  }}
                >
                  {s.icon}
                </span>
              )}

              {/* Title */}
              <span
                style={{
                  flex: 1,
                  fontSize: 13,
                  color: 'var(--text-primary)',
                  lineHeight: 1.4,
                }}
              >
                {t.title}
              </span>

              {/* Undo button */}
              {t.undo && (
                <button
                  onClick={() => {
                    t.undo?.()
                    dismiss(t.id)
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--accent)',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    padding: '2px 6px',
                    borderRadius: 4,
                    flexShrink: 0,
                  }}
                >
                  Undo
                </button>
              )}

              {/* Close button */}
              <button
                onClick={() => dismiss(t.id)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  fontSize: 14,
                  cursor: 'pointer',
                  padding: '2px 4px',
                  lineHeight: 1,
                  flexShrink: 0,
                }}
              >
                ×
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}
