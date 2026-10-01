/**
 * A stand-in Supabase client backed by in-memory fixtures.
 *
 * Only active when NEXT_PUBLIC_DEMO_MODE is "1", which is never set in production.
 * It exists so the real pages can be run and photographed against invented people
 * instead of the owner's actual contacts.
 *
 * It implements the slice of the client surface this app actually uses: the chained
 * query builder, realtime channels as no-ops, and an always-signed-in auth object.
 * It is not a general Supabase emulator and does not try to be. Anything it does not
 * recognise resolves to an empty result rather than throwing, because a demo that
 * crashes on an unhandled call is worse than one that renders an empty panel.
 *
 * Writes mutate the in-memory copy only. Nothing leaves the browser tab.
 */

import { DEMO_TABLES, DEMO_USER } from './fixtures'

export const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === '1'

// A marker the screenshot script checks before it captures anything. Published
// images must never show the real database, so the capture refuses to run unless
// the page itself confirms it is serving fixtures.
if (typeof window !== 'undefined' && DEMO_MODE) {
  ;(window as unknown as { __HAROLD_DEMO__?: boolean }).__HAROLD_DEMO__ = true
}

type Row = Record<string, unknown>

function clone(): Record<string, Row[]> {
  return JSON.parse(JSON.stringify(DEMO_TABLES))
}

const tables: Record<string, Row[]> = clone()

interface Filter {
  op: 'eq' | 'neq' | 'in' | 'gte' | 'lte' | 'gt' | 'lt' | 'is' | 'like' | 'ilike'
  column: string
  value: unknown
}

function matches(row: Row, f: Filter): boolean {
  const v = row[f.column]
  switch (f.op) {
    case 'eq': return v === f.value
    case 'neq': return v !== f.value
    case 'in': return Array.isArray(f.value) && (f.value as unknown[]).includes(v)
    case 'gte': return String(v ?? '') >= String(f.value)
    case 'lte': return String(v ?? '') <= String(f.value)
    case 'gt': return String(v ?? '') > String(f.value)
    case 'lt': return String(v ?? '') < String(f.value)
    case 'is': return f.value === null ? v === null || v === undefined : v === f.value
    case 'like':
    case 'ilike': {
      const pat = String(f.value).replace(/%/g, '').toLowerCase()
      return String(v ?? '').toLowerCase().includes(pat)
    }
    default: return true
  }
}

/**
 * Attach rows from related tables when a select() asks for them.
 *
 * The app selects nested relations, for example
 *   contacts(..., contact_categories(category_name), interactions(occurred_at))
 * so the builder looks for those table names in the select string and joins them
 * on contact_id. That is the only relationship shape this app uses.
 */
function embed(table: string, rows: Row[], select: string): Row[] {
  if (!select) return rows

  if (table === 'contacts') {
    const related = ['contact_categories', 'contact_pipelines', 'interactions', 'tasks']
      .filter((t) => select.includes(t))
    if (!related.length) return rows
    return rows.map((r) => {
      const out = { ...r }
      for (const t of related) {
        out[t] = (tables[t] ?? []).filter((x) => x.contact_id === r.id)
      }
      return out
    })
  }

  // Rows that point AT something, e.g. audit_log's `profiles:user_id ( ... )`.
  const wantsProfile = select.includes('profiles')
  const wantsContact = select.includes('contacts')
  if (!wantsProfile && !wantsContact) return rows
  return rows.map((r) => {
    const out = { ...r }
    if (wantsProfile) {
      out.profiles = (tables.profiles ?? []).find((p) => p.id === r.user_id) ?? null
    }
    if (wantsContact) {
      out.contacts = (tables.contacts ?? []).find((c) => c.id === r.contact_id) ?? null
    }
    return out
  })
}

class DemoQuery implements PromiseLike<{ data: unknown; error: null; count?: number }> {
  private filters: Filter[] = []
  private selectStr = ''
  private orderBy: { column: string; asc: boolean } | null = null
  private limitN: number | null = null
  private wantSingle = false
  private wantMaybe = false
  private pendingWrite: { kind: 'insert' | 'update' | 'delete'; payload?: Row | Row[] } | null = null

  constructor(private table: string) {}

  select(cols?: string) { this.selectStr = cols ?? '*'; return this }
  insert(payload: Row | Row[]) { this.pendingWrite = { kind: 'insert', payload }; return this }
  upsert(payload: Row | Row[]) { this.pendingWrite = { kind: 'insert', payload }; return this }
  update(payload: Row) { this.pendingWrite = { kind: 'update', payload }; return this }
  delete() { this.pendingWrite = { kind: 'delete' }; return this }

  eq(column: string, value: unknown) { this.filters.push({ op: 'eq', column, value }); return this }
  neq(column: string, value: unknown) { this.filters.push({ op: 'neq', column, value }); return this }
  in(column: string, value: unknown[]) { this.filters.push({ op: 'in', column, value }); return this }
  gte(column: string, value: unknown) { this.filters.push({ op: 'gte', column, value }); return this }
  lte(column: string, value: unknown) { this.filters.push({ op: 'lte', column, value }); return this }
  gt(column: string, value: unknown) { this.filters.push({ op: 'gt', column, value }); return this }
  lt(column: string, value: unknown) { this.filters.push({ op: 'lt', column, value }); return this }
  is(column: string, value: unknown) { this.filters.push({ op: 'is', column, value }); return this }
  like(column: string, value: unknown) { this.filters.push({ op: 'like', column, value }); return this }
  ilike(column: string, value: unknown) { this.filters.push({ op: 'ilike', column, value }); return this }
  or() { return this }
  not() { return this }
  range(from: number, to: number) { this.limitN = to - from + 1; return this }
  order(column: string, opts?: { ascending?: boolean }) {
    this.orderBy = { column, asc: opts?.ascending !== false }
    return this
  }
  limit(n: number) { this.limitN = n; return this }
  single() { this.wantSingle = true; return this }
  maybeSingle() { this.wantMaybe = true; return this }

  private run() {
    const rows = tables[this.table] ?? (tables[this.table] = [])

    if (this.pendingWrite) {
      const w = this.pendingWrite
      if (w.kind === 'insert') {
        const items = (Array.isArray(w.payload) ? w.payload : [w.payload!]).map((p, i) => ({
          id: (p.id as string) ?? `demo-${this.table}-${Date.now()}-${i}`,
          created_at: new Date().toISOString(),
          ...p,
        }))
        rows.push(...items)
        return items
      }
      if (w.kind === 'update') {
        const hit = rows.filter((r) => this.filters.every((f) => matches(r, f)))
        hit.forEach((r) => Object.assign(r, w.payload, { updated_at: new Date().toISOString() }))
        return hit
      }
      const keep = rows.filter((r) => !this.filters.every((f) => matches(r, f)))
      const removed = rows.filter((r) => this.filters.every((f) => matches(r, f)))
      tables[this.table] = keep
      return removed
    }

    let out = rows.filter((r) => this.filters.every((f) => matches(r, f)))
    out = embed(this.table, out, this.selectStr)
    if (this.orderBy) {
      const { column, asc } = this.orderBy
      out = [...out].sort((a, b) => {
        const av = String(a[column] ?? ''), bv = String(b[column] ?? '')
        return asc ? av.localeCompare(bv) : bv.localeCompare(av)
      })
    }
    if (this.limitN != null) out = out.slice(0, this.limitN)
    return out
  }

  then<R1 = { data: unknown; error: null; count?: number }, R2 = never>(
    onfulfilled?: ((v: { data: unknown; error: null; count?: number }) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null
  ): PromiseLike<R1 | R2> {
    let result: { data: unknown; error: null; count?: number }
    try {
      const rows = this.run()
      const data = this.wantSingle || this.wantMaybe ? (rows[0] ?? null) : rows
      result = { data, error: null, count: rows.length }
    } catch {
      result = { data: this.wantSingle || this.wantMaybe ? null : [], error: null, count: 0 }
    }
    return Promise.resolve(result).then(onfulfilled, onrejected)
  }
}

const noopChannel = {
  on() { return this },
  subscribe() { return this },
  unsubscribe() { return Promise.resolve('ok') },
}

export function createDemoClient() {
  return {
    from(table: string) { return new DemoQuery(table) },
    channel() { return noopChannel },
    removeChannel() { return Promise.resolve('ok') },
    rpc() { return Promise.resolve({ data: null, error: null }) },
    auth: {
      getUser: () => Promise.resolve({ data: { user: DEMO_USER }, error: null }),
      getSession: () => Promise.resolve({
        data: { session: { user: DEMO_USER, access_token: 'demo' } }, error: null,
      }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: () => Promise.resolve({ error: null }),
      signInWithPassword: () => Promise.resolve({ data: { user: DEMO_USER }, error: null }),
      signInWithOAuth: () => Promise.resolve({ data: null, error: null }),
    },
    storage: {
      from() {
        return {
          upload: () => Promise.resolve({ data: null, error: null }),
          getPublicUrl: () => ({ data: { publicUrl: '' } }),
        }
      },
    },
  }
}
