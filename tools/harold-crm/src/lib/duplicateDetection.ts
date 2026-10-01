import type { Contact } from '@/lib/types'

/**
 * Levenshtein distance between two strings (case-insensitive).
 */
export function levenshtein(a: string, b: string): number {
  const al = a.toLowerCase()
  const bl = b.toLowerCase()
  const m = al.length
  const n = bl.length

  if (m === 0) return n
  if (n === 0) return m

  // Use two-row optimization
  let prev = Array.from({ length: n + 1 }, (_, i) => i)
  let curr = new Array<number>(n + 1)

  for (let i = 1; i <= m; i++) {
    curr[0] = i
    for (let j = 1; j <= n; j++) {
      const cost = al[i - 1] === bl[j - 1] ? 0 : 1
      curr[j] = Math.min(
        prev[j] + 1,       // deletion
        curr[j - 1] + 1,   // insertion
        prev[j - 1] + cost  // substitution
      )
    }
    ;[prev, curr] = [curr, prev]
  }
  return prev[n]
}

/**
 * Normalized similarity score between 0 and 1 (1 = identical).
 */
export function similarity(a: string, b: string): number {
  if (!a && !b) return 1
  if (!a || !b) return 0
  const maxLen = Math.max(a.length, b.length)
  if (maxLen === 0) return 1
  return 1 - levenshtein(a, b) / maxLen
}

export interface DuplicateGroup {
  contacts: [Contact, Contact]
  score: number
  reasons: string[]
}

/**
 * Find potential duplicate contact pairs.
 * Returns groups sorted by confidence score (highest first).
 */
export function findDuplicates(contacts: Contact[]): DuplicateGroup[] {
  const groups: DuplicateGroup[] = []
  const seen = new Set<string>() // avoid reporting same pair twice

  for (let i = 0; i < contacts.length; i++) {
    for (let j = i + 1; j < contacts.length; j++) {
      const a = contacts[i]
      const b = contacts[j]
      const pairKey = [a.id, b.id].sort().join(':')
      if (seen.has(pairKey)) continue

      const result = evaluatePair(a, b)
      if (result) {
        seen.add(pairKey)
        groups.push(result)
      }
    }
  }

  return groups.sort((a, b) => b.score - a.score)
}

function evaluatePair(a: Contact, b: Contact): DuplicateGroup | null {
  const reasons: string[] = []
  let score = 0

  // Exact email match (strong signal)
  if (a.email && b.email && a.email.toLowerCase() === b.email.toLowerCase()) {
    reasons.push('Same email address')
    score += 0.5
  }

  // Exact phone match (strong signal)
  const phoneA = normalizePhone(a.phone)
  const phoneB = normalizePhone(b.phone)
  if (phoneA && phoneB && phoneA === phoneB) {
    reasons.push('Same phone number')
    score += 0.4
  }

  // Name similarity
  const nameSim = similarity(a.name, b.name)
  if (nameSim >= 0.85) {
    reasons.push(`Similar names (${Math.round(nameSim * 100)}%)`)
    score += nameSim * 0.4
  }

  // Same org + somewhat similar name
  if (a.org && b.org && a.org.toLowerCase() === b.org.toLowerCase() && nameSim >= 0.6) {
    reasons.push('Same organization')
    score += 0.2
  }

  // Threshold: only report if there's meaningful overlap
  if (score >= 0.35) {
    return { contacts: [a, b], score: Math.min(score, 1), reasons }
  }

  return null
}

function normalizePhone(phone: string | null | undefined): string {
  if (!phone) return ''
  return phone.replace(/\D/g, '')
}
