import { type Contact, DEFAULT_CATEGORY_COLORS } from './types'

// ─── Country Parser ──────────────────────────────────────────────────
// Derives a country from the free-text "location" field in seed data.
// Handles "City", "City, Country", multi-location strings, and US state patterns.

const CITY_TO_COUNTRY: Record<string, string> = {
  // Africa
  'lagos': 'Nigeria', 'abuja': 'Nigeria', 'ibadan': 'Nigeria',
  'nairobi': 'Kenya', 'mombasa': 'Kenya',
  'accra': 'Ghana', 'kumasi': 'Ghana',
  'johannesburg': 'South Africa', 'cape town': 'South Africa', 'durban': 'South Africa', 'pretoria': 'South Africa', 'stellenbosch': 'South Africa',
  'dakar': 'Senegal',
  'addis ababa': 'Ethiopia',
  'kigali': 'Rwanda',
  'kampala': 'Uganda',
  'dar es salaam': 'Tanzania',
  'lusaka': 'Zambia',
  'maputo': 'Mozambique',
  'abidjan': 'Ivory Coast',
  'douala': 'Cameroon', 'yaoundé': 'Cameroon', 'yaounde': 'Cameroon',
  'casablanca': 'Morocco', 'rabat': 'Morocco',
  'cairo': 'Egypt',
  'tunis': 'Tunisia',
  'algiers': 'Algeria',
  'windhoek': 'Namibia',
  'gaborone': 'Botswana',
  'harare': 'Zimbabwe',
  'freetown': 'Sierra Leone',
  'monrovia': 'Liberia',
  'bamako': 'Mali',
  'conakry': 'Guinea',
  'lome': 'Togo', 'lomé': 'Togo',
  'cotonou': 'Benin',
  'libreville': 'Gabon',
  'port louis': 'Mauritius',
  'antananarivo': 'Madagascar',
  'banjul': 'Gambia',
  'nouakchott': 'Mauritania',

  // Middle East
  'dubai': 'UAE', 'abu dhabi': 'UAE',
  'riyadh': 'Saudi Arabia', 'jeddah': 'Saudi Arabia',
  'doha': 'Qatar',
  'bahrain': 'Bahrain', 'manama': 'Bahrain',
  'tel aviv': 'Israel', 'jerusalem': 'Israel',
  'amman': 'Jordan',
  'beirut': 'Lebanon',
  'muscat': 'Oman',
  'kuwait city': 'Kuwait',

  // Europe
  'london': 'United Kingdom', 'edinburgh': 'United Kingdom', 'manchester': 'United Kingdom', 'oxford': 'United Kingdom', 'cambridge': 'United Kingdom',
  'paris': 'France', 'lyon': 'France',
  'berlin': 'Germany', 'munich': 'Germany', 'frankfurt': 'Germany', 'hamburg': 'Germany',
  'amsterdam': 'Netherlands', 'rotterdam': 'Netherlands', 'the hague': 'Netherlands',
  'brussels': 'Belgium',
  'zurich': 'Switzerland', 'geneva': 'Switzerland', 'bern': 'Switzerland',
  'stockholm': 'Sweden',
  'oslo': 'Norway',
  'copenhagen': 'Denmark',
  'helsinki': 'Finland',
  'dublin': 'Ireland',
  'lisbon': 'Portugal',
  'madrid': 'Spain', 'barcelona': 'Spain',
  'rome': 'Italy', 'milan': 'Italy',
  'vienna': 'Austria',
  'warsaw': 'Poland',
  'prague': 'Czech Republic',
  'luxembourg': 'Luxembourg',

  // Americas
  'new york': 'United States', 'san francisco': 'United States', 'chicago': 'United States',
  'los angeles': 'United States', 'houston': 'United States', 'atlanta': 'United States',
  'boston': 'United States', 'denver': 'United States', 'seattle': 'United States',
  'miami': 'United States', 'detroit': 'United States', 'philadelphia': 'United States',
  'washington': 'United States', 'washington dc': 'United States', 'washington d.c.': 'United States',
  'dallas': 'United States', 'austin': 'United States', 'portland': 'United States',
  'phoenix': 'United States', 'san diego': 'United States', 'minneapolis': 'United States',
  'nashville': 'United States', 'charlotte': 'United States', 'pittsburgh': 'United States',
  'indianapolis': 'United States', 'columbus': 'United States', 'salt lake city': 'United States',
  'raleigh': 'United States', 'richmond': 'United States', 'sacramento': 'United States',
  'toronto': 'Canada', 'vancouver': 'Canada', 'montreal': 'Canada', 'ottawa': 'Canada', 'calgary': 'Canada',
  'mexico city': 'Mexico',
  'são paulo': 'Brazil', 'sao paulo': 'Brazil', 'rio de janeiro': 'Brazil',
  'bogotá': 'Colombia', 'bogota': 'Colombia',
  'lima': 'Peru',
  'buenos aires': 'Argentina',
  'santiago': 'Chile',

  // Asia & Pacific
  'singapore': 'Singapore',
  'tokyo': 'Japan', 'osaka': 'Japan',
  'shanghai': 'China', 'beijing': 'China', 'shenzhen': 'China', 'hong kong': 'China',
  'mumbai': 'India', 'bangalore': 'India', 'bengaluru': 'India', 'delhi': 'India', 'new delhi': 'India', 'hyderabad': 'India',
  'bangkok': 'Thailand',
  'jakarta': 'Indonesia',
  'kuala lumpur': 'Malaysia',
  'manila': 'Philippines',
  'seoul': 'South Korea',
  'taipei': 'Taiwan',
  'sydney': 'Australia', 'melbourne': 'Australia',
  'auckland': 'New Zealand',
}

// US state abbreviations for "City, ST" pattern
const US_STATES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY','DC',
])

export function parseCountry(location: string): string {
  if (!location) return 'Unknown'

  const loc = location.trim().toLowerCase()

  // Direct city match first
  if (CITY_TO_COUNTRY[loc]) return CITY_TO_COUNTRY[loc]

  // Split on common separators and try the first segment
  const segments = loc.split(/[,;/]/).map(s => s.trim()).filter(Boolean)

  for (const segment of segments) {
    // Check direct city match for segment
    if (CITY_TO_COUNTRY[segment]) return CITY_TO_COUNTRY[segment]
  }

  // Try "City, STATE" pattern (e.g., "Austin, TX")
  if (segments.length >= 2) {
    const possibleState = segments[1].toUpperCase().trim()
    if (US_STATES.has(possibleState)) return 'United States'

    // Last segment might be a country name itself
    const lastSegment = segments[segments.length - 1].trim()
    // Check if any known country matches the last segment
    const countries = Object.values(CITY_TO_COUNTRY)
    const countryMatch = countries.find(c => c.toLowerCase() === lastSegment)
    if (countryMatch) return countryMatch
  }

  // Fallback: scan entire string for city names (longest match first)
  const sortedCities = Object.keys(CITY_TO_COUNTRY).sort((a, b) => b.length - a.length)
  for (const city of sortedCities) {
    if (loc.includes(city)) return CITY_TO_COUNTRY[city]
  }

  return 'Unknown'
}


// ─── Sorting ─────────────────────────────────────────────────────────

type SortField = 'name' | 'org' | 'status' | 'priority' | 'updated_at' | 'created_at' | 'category'
type SortDirection = 'asc' | 'desc'

const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 }
const STATUS_ORDER: Record<string, number> = { active: 0, pending: 1, cold: 2, archived: 3 }

export function sortContacts(
  contacts: Contact[],
  field: SortField = 'updated_at',
  direction: SortDirection = 'desc'
): Contact[] {
  return [...contacts].sort((a, b) => {
    let comparison = 0

    switch (field) {
      case 'priority':
        comparison = (PRIORITY_ORDER[a.priority] ?? 99) - (PRIORITY_ORDER[b.priority] ?? 99)
        break
      case 'status':
        comparison = (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99)
        break
      case 'updated_at':
      case 'created_at':
        comparison = new Date(a[field]).getTime() - new Date(b[field]).getTime()
        break
      default:
        comparison = (a[field] ?? '').localeCompare(b[field] ?? '')
    }

    return direction === 'desc' ? -comparison : comparison
  })
}


// ─── Category color helper ───────────────────────────────────────────

export function getCategoryColor(category: string): string {
  return DEFAULT_CATEGORY_COLORS[category] ?? '#937860'
}


// ─── Formatting helpers ──────────────────────────────────────────────

export function formatDate(dateString: string): string {
  if (!dateString) return ''
  const d = new Date(dateString)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function formatRelativeTime(dateString: string): string {
  if (!dateString) return ''
  const now = new Date()
  const d = new Date(dateString)
  const diffMs = now.getTime() - d.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return formatDate(dateString)
}

export function truncate(str: string, maxLength: number): string {
  if (!str || str.length <= maxLength) return str ?? ''
  return str.slice(0, maxLength) + '...'
}


// ─── URL helpers ─────────────────────────────────────────────────────

export function ensureProtocol(url: string): string {
  if (!url) return ''
  if (url.startsWith('http://') || url.startsWith('https://')) return url
  return `https://${url}`
}


// ─── Search / Filter helpers ─────────────────────────────────────────

export function contactMatchesSearch(contact: Contact, query: string): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  return (
    (contact.name ?? '').toLowerCase().includes(q) ||
    (contact.org ?? '').toLowerCase().includes(q) ||
    (contact.email ?? '').toLowerCase().includes(q) ||
    (contact.location ?? '').toLowerCase().includes(q) ||
    (contact.notes ?? '').toLowerCase().includes(q)
  )
}


// ─── Due Date helpers ────────────────────────────────────────────────

export function getDueDateInfo(dueDate: string | null): { label: string; color: string; overdue: boolean } | null {
  if (!dueDate) return null

  // Parse date-only portion as local midnight (not UTC) to avoid off-by-one errors.
  // new Date("2026-02-19") parses as UTC midnight which shifts to previous day in US timezones.
  const parts = dueDate.split('T')[0].split('-')
  const dueDay = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]))
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const diffMs = dueDay.getTime() - today.getTime()
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays < 0) {
    return { label: `${Math.abs(diffDays)}d overdue`, color: '#C44E52', overdue: true }
  } else if (diffDays === 0) {
    return { label: 'Due today', color: '#DD8452', overdue: false }
  } else if (diffDays === 1) {
    return { label: 'Due tomorrow', color: '#ffc107', overdue: false }
  } else if (diffDays <= 7) {
    return { label: `Due in ${diffDays}d`, color: '#a0a0a0', overdue: false }
  } else {
    return { label: formatRelativeTime(dueDate), color: '#555', overdue: false }
  }
}

/** Check if a due date is strictly before today (not including today) */
export function isOverdueDate(dueDate: string | null): boolean {
  if (!dueDate) return false
  // Parse date-only portion as local midnight to avoid UTC off-by-one
  const parts = dueDate.split('T')[0].split('-')
  const dueDay = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]))
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return dueDay.getTime() < today.getTime()
}


// ─── Organization Grouping ───────────────────────────────────────────

export interface OrgGroup {
  orgId: string | null
  orgName: string
  contacts: Contact[]
}

export function groupContactsByOrg(contacts: Contact[]): OrgGroup[] {
  const groups = new Map<string, OrgGroup>()

  for (const contact of contacts) {
    const key = contact.organization_id ?? `text:${(contact.org ?? '').toLowerCase().trim()}`
    const existing = groups.get(key)
    if (existing) {
      existing.contacts.push(contact)
    } else {
      groups.set(key, {
        orgId: contact.organization_id ?? null,
        orgName: contact.org || 'No Organization',
        contacts: [contact],
      })
    }
  }

  // Sort groups by org name, with "No Organization" last
  const sorted = Array.from(groups.values()).sort((a, b) => {
    if (a.orgName === 'No Organization') return 1
    if (b.orgName === 'No Organization') return -1
    return a.orgName.localeCompare(b.orgName)
  })

  return sorted
}


// ─── Misc ────────────────────────────────────────────────────────────

export function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ')
}
