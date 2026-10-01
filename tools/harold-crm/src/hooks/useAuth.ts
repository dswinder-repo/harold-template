// Re-export useAuth from AuthProvider — this is now just a convenience re-export.
// All auth state lives in the single AuthProvider context at the layout level.
// Every component that calls useAuth() gets the SAME instance — no more
// independent state, no more race conditions, no more duplicate listeners.
export { useAuth } from '@/components/AuthProvider'
