// Harold's side of the sync: tasks, task_links, sync_log and sync_state in Supabase.
// Every write goes through a supabase-js client created for one origin, carrying the request header
// `x-harold-origin`; the database trigger reads it to set tasks.changed_by (and source on insert), which
// is what stops a sync write from echoing back out through the pg_net push trigger.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { COLS, dueFromDb, dueToDb, type HaroldFields, type LinkRow, type LogKind, type TaskRow } from "./types.js";

export interface LogEntry { kind: LogKind; provider: string; task_id?: string | null; external_id?: string | null; detail: Record<string, unknown> }
export interface SyncStateRow { cursor: string | null; detail: Record<string, unknown> }

/** A unique-key violation (Postgres 23505): another writer got there first. */
export class DuplicateError extends Error {}

export interface SyncStore {
  getTask(id: string): Promise<TaskRow | null>;
  /** `id` is given for tasks that come from a provider (derived from the external id), so a concurrent
   *  second insert of the same item fails with DuplicateError instead of creating a twin. */
  insertTask(fields: HaroldFields, origin: string, id?: string): Promise<TaskRow>;
  updateTask(id: string, patch: Partial<HaroldFields>, origin: string): Promise<TaskRow>;
  findLink(provider: string, externalId: string): Promise<LinkRow | null>;
  linkForTask(provider: string, taskId: string): Promise<LinkRow | null>;
  linksForTasks(provider: string, taskIds: string[]): Promise<LinkRow[]>;
  /** Throws DuplicateError when (provider, external_id) or (task_id, provider) already exists. */
  insertLink(link: LinkRow): Promise<void>;
  /** A patch may change external_id (re-keying a placeholder link); throws DuplicateError when that id is taken. */
  updateLink(provider: string, externalId: string, patch: Partial<LinkRow>): Promise<void>;
  /** Links of one provider whose create has not been confirmed yet (synced_at is null). */
  pendingLinks(provider: string): Promise<LinkRow[]>;
  deleteLink(provider: string, externalId: string): Promise<void>;
  log(e: LogEntry): Promise<void>;
  getState(provider: string): Promise<SyncStateRow | null>;
  setState(provider: string, s: SyncStateRow): Promise<void>;
  /** Tasks whose last change came from Harold itself (changed_by = 'harold'), or, with `exceptOrigin`, from anyone
   *  but that provider (changed_by <> exceptOrigin): what that provider may not have seen yet. */
  haroldChangedTasks(exceptOrigin?: string): Promise<TaskRow[]>;
  openTasks(): Promise<TaskRow[]>;
}

// ───────────── row mapping ─────────────

export function rowToTask(r: Record<string, unknown>): TaskRow {
  const notes = (r[COLS.notes] as string | null | undefined) ?? "";
  return {
    id: String(r[COLS.id]), ref: (r[COLS.ref] as string | null) ?? null,
    title: String(r[COLS.title] ?? ""), notes: notes.trim() ? notes : null,
    status: r[COLS.status] as TaskRow["status"], priority: (r[COLS.priority] as TaskRow["priority"]) ?? null,
    due: dueFromDb(r[COLS.due]), project: (r[COLS.project] as string | null) ?? null,
    source: (r[COLS.source] as string | null) ?? null, changed_by: (r[COLS.changedBy] as string | null) ?? null,
    updated_at: String(r[COLS.updatedAt]),
  };
}

export function fieldsToRow(f: Partial<HaroldFields>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (f.title !== undefined) out[COLS.title] = f.title;
  if (f.notes !== undefined) out[COLS.notes] = f.notes ?? "";
  if (f.status !== undefined) out[COLS.status] = f.status;
  if (f.priority !== undefined && f.priority !== null) out[COLS.priority] = f.priority; // NOT NULL in the table
  if (f.due !== undefined) out[COLS.due] = dueToDb(f.due);
  if (f.project !== undefined) out[COLS.project] = f.project;
  return out;
}

const TASK_SELECT = Object.values(COLS).join(", ");
const LINK_SELECT = "task_id, provider, external_id, external_key, external_url, external_updated_at, synced_at, synced_fields";

// ───────────── Supabase ─────────────

export type ClientFactory = (origin: string) => SupabaseClient;

export function supabaseClientFactory(url: string, key: string, fetchImpl?: typeof fetch): ClientFactory {
  const cache = new Map<string, SupabaseClient>();
  return origin => {
    let c = cache.get(origin);
    if (!c) {
      c = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { "x-harold-origin": origin }, ...(fetchImpl ? { fetch: fetchImpl } : {}) } });
      cache.set(origin, c);
    }
    return c;
  };
}

export function syncStoreFromEnv(): SyncStore | null {
  const url = (process.env.SUPABASE_URL || "").trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) return null;
  return new SupabaseSyncStore(supabaseClientFactory(url, key));
}

type Res<T> = { data: T | null; error: { message: string; code?: string } | null };
function must<T>(r: Res<T>, what: string): T {
  if (r.error) throw new Error(`Supabase ${what}: ${r.error.message}`);
  return r.data as T;
}

export class SupabaseSyncStore implements SyncStore {
  /** `sync` is the origin for reads and for the bookkeeping tables; task writes name their own origin. */
  constructor(private client: ClientFactory, private bookkeepingOrigin = "sync") {}
  private get db() { return this.client(this.bookkeepingOrigin); }

  async getTask(id: string) {
    const r = await this.db.from("tasks").select(TASK_SELECT).eq(COLS.id, id).maybeSingle();
    const d = must(r as Res<Record<string, unknown>>, "read task");
    return d ? rowToTask(d) : null;
  }
  async insertTask(fields: HaroldFields, origin: string, id?: string) {
    const r = await this.client(origin).from("tasks").insert({ ...(id ? { [COLS.id]: id } : {}), ...fieldsToRow(fields), [COLS.source]: origin }).select(TASK_SELECT).single();
    if (r.error?.code === "23505") throw new DuplicateError(r.error.message);
    return rowToTask(must(r as Res<Record<string, unknown>>, "insert task"));
  }
  async updateTask(id: string, patch: Partial<HaroldFields>, origin: string) {
    const r = await this.client(origin).from("tasks").update(fieldsToRow(patch)).eq(COLS.id, id).select(TASK_SELECT).single();
    return rowToTask(must(r as Res<Record<string, unknown>>, "update task"));
  }
  async findLink(provider: string, externalId: string) {
    const r = await this.db.from("task_links").select(LINK_SELECT).eq("provider", provider).eq("external_id", externalId).maybeSingle();
    return must(r as Res<LinkRow>, "read link");
  }
  async linkForTask(provider: string, taskId: string) {
    const r = await this.db.from("task_links").select(LINK_SELECT).eq("provider", provider).eq("task_id", taskId).maybeSingle();
    return must(r as Res<LinkRow>, "read link");
  }
  async linksForTasks(provider: string, taskIds: string[]) {
    const out: LinkRow[] = [];
    for (let i = 0; i < taskIds.length; i += 200) {
      const r = await this.db.from("task_links").select(LINK_SELECT).eq("provider", provider).in("task_id", taskIds.slice(i, i + 200));
      out.push(...(must(r as Res<LinkRow[]>, "read links") || []));
    }
    return out;
  }
  async insertLink(link: LinkRow) {
    const r = await this.db.from("task_links").insert(link);
    if (r.error?.code === "23505") throw new DuplicateError(r.error.message);
    must(r as Res<unknown>, "insert link");
  }
  async updateLink(provider: string, externalId: string, patch: Partial<LinkRow>) {
    const r = await this.db.from("task_links").update(patch).eq("provider", provider).eq("external_id", externalId) as Res<unknown>;
    if (r.error?.code === "23505") throw new DuplicateError(r.error.message);
    must(r, "update link");
  }
  async pendingLinks(provider: string) {
    const r = await this.db.from("task_links").select(LINK_SELECT).eq("provider", provider).is("synced_at", null).limit(200);
    return must(r as Res<LinkRow[]>, "read pending links") || [];
  }
  async deleteLink(provider: string, externalId: string) {
    must(await this.db.from("task_links").delete().eq("provider", provider).eq("external_id", externalId) as Res<unknown>, "delete link");
  }
  async log(e: LogEntry) {
    // Logging never breaks a sync: a failed log write is reported to the function log only.
    const r = await this.db.from("sync_log").insert({ provider: e.provider, kind: e.kind, task_id: e.task_id ?? null, detail: { ...(e.external_id ? { external_id: e.external_id } : {}), ...e.detail } });
    if (r.error) console.error("sync_log insert failed:", r.error.message);
  }
  async getState(provider: string) {
    const r = await this.db.from("sync_state").select("cursor, detail").eq("provider", provider).maybeSingle();
    const d = must(r as Res<{ cursor: string | null; detail: Record<string, unknown> | null }>, "read sync_state");
    return d ? { cursor: d.cursor, detail: d.detail || {} } : null;
  }
  async setState(provider: string, s: SyncStateRow) {
    must(await this.db.from("sync_state").upsert({ provider, cursor: s.cursor, detail: s.detail }, { onConflict: "provider" }) as Res<unknown>, "write sync_state");
  }
  private async allPages(build: (from: number, to: number) => PromiseLike<Res<Record<string, unknown>[]>>, what: string) {
    const out: TaskRow[] = [];
    for (let from = 0; ; from += 1000) {
      const rows = must(await build(from, from + 999), what) || [];
      out.push(...rows.map(rowToTask));
      if (rows.length < 1000) break;
    }
    return out;
  }
  haroldChangedTasks(exceptOrigin?: string) {
    const q = () => this.db.from("tasks").select(TASK_SELECT);
    return this.allPages((a, b) => (exceptOrigin ? q().neq(COLS.changedBy, exceptOrigin) : q().eq(COLS.changedBy, "harold")).order(COLS.updatedAt).range(a, b) as unknown as PromiseLike<Res<Record<string, unknown>[]>>, "read changed tasks");
  }
  openTasks() {
    return this.allPages((a, b) => this.db.from("tasks").select(TASK_SELECT).in(COLS.status, ["pending", "in_progress"]).order(COLS.updatedAt).range(a, b) as unknown as PromiseLike<Res<Record<string, unknown>[]>>, "read open tasks");
  }
}
