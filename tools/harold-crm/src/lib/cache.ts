/**
 * Lightweight Map-based cache with TTL and stale-while-revalidate pattern.
 * No external dependencies — simple module-level Map.
 */

interface CacheEntry<T = unknown> {
  data: T
  timestamp: number
  ttl: number // ms
}

const store = new Map<string, CacheEntry>()

// Revalidation callbacks currently in flight (prevents duplicate refetches)
const pendingRevalidations = new Set<string>()

/**
 * Get cached data. Returns `undefined` if no cache exists.
 * If stale, returns cached data and triggers background revalidation via `revalidate`.
 */
export function cacheGet<T>(
  key: string,
  revalidate?: () => Promise<T>
): { data: T; fresh: boolean } | undefined {
  const entry = store.get(key)
  if (!entry) return undefined

  const age = Date.now() - entry.timestamp
  const fresh = age < entry.ttl

  if (!fresh && revalidate && !pendingRevalidations.has(key)) {
    // Stale-while-revalidate: return stale data, refetch in background
    pendingRevalidations.add(key)
    revalidate()
      .then((newData) => {
        cacheSet(key, newData, entry.ttl)
      })
      .catch(() => {
        // Revalidation failed — keep stale data
      })
      .finally(() => {
        pendingRevalidations.delete(key)
      })
  }

  return { data: entry.data as T, fresh }
}

/**
 * Store data in cache with a TTL (in ms).
 */
export function cacheSet<T>(key: string, data: T, ttl: number): void {
  store.set(key, { data, timestamp: Date.now(), ttl })
}

/**
 * Invalidate a specific cache key.
 */
export function cacheInvalidate(key: string): void {
  store.delete(key)
}

/**
 * Invalidate all keys matching a prefix.
 */
export function cacheInvalidatePrefix(prefix: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) {
      store.delete(key)
    }
  }
}

/**
 * Invalidate all cache entries.
 */
export function cacheInvalidateAll(): void {
  store.clear()
}

// --- TTL constants ---
export const CACHE_TTL = {
  CONTACTS: 5 * 60 * 1000,       // 5 minutes
  CATEGORIES: 30 * 60 * 1000,    // 30 minutes
  ENUM_OPTIONS: 30 * 60 * 1000,  // 30 minutes
  SHORT: 60 * 1000,              // 1 minute
} as const
