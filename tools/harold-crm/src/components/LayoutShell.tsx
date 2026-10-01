'use client'

import { AnimatePresence } from 'framer-motion'
import CursorGlow from '@/components/CursorGlow'
import FeedbackButton from '@/components/FeedbackButton'

export default function LayoutShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <CursorGlow />
      <FeedbackButton />
      <AnimatePresence mode="wait">{children}</AnimatePresence>
    </>
  )
}
