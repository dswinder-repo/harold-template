// The sync engine: provider-agnostic reconciliation between a Harold task and its external item.
//
// A task and its item are linked by a task_links row that records the version of each side last
// brought into agreement: synced_at (Harold's tasks.updated_at after the last apply) and
// external_updated_at (the provider's updatedAt after the last apply).
//
//   Harold changed   = tasks.changed_by = 'harold' AND tasks.updated_at > link.synced_at
//   provider changed = item.updatedAt > link.external_updated_at
//
// Only one side changed: apply it to the other. Both changed: a field-level three-way merge against
// link.synced_fields (the values both sides last agreed on): different fields merge; the same field changed
// to different values is a conflict that the later timestamp wins, logged with both values. A link with no
// synced_fields yet uses the whole-version rule (the later version wins outright). When the two sides already
// say the same thing (the echo of our own write coming back, or the same edit made twice) the link is
// refreshed and nothing is written.
//
// synced_at is set to the Harold row's own updated_at (and external_updated_at to the item's updatedAt)
// rather than to the wall clock: both stamps then come from the clock that wrote them, so app/DB clock
// skew can neither hide an edit nor invent one, and an edit landing mid-sync is still seen next time.

import { createHash, randomUUID } from "node:crypto";
import type { SyncProvider } from "./provider.js";
import type { ProjectMap } from "./projectmap.js";
import { DuplicateError, type SyncStore } from "./store.js";
import { FIELD_KEYS, OPEN_STATUSES, laterIso, ts, type ExternalItem, type FieldKey, type HaroldFields, type LinkRow, type TaskRow, type WebhookEvent } from "./types.js";

export type Outcome = "pulled" | "pushed" | "merged" | "created" | "imported" | "conflict" | "unchanged" | "skipped" | "pending" | "error";
export interface Result { outcome: Outcome; taskId?: string; winner?: "harold" | "provider" | "mixed"; fields?: FieldKey[] }

export interface Counts {
  pulled: number; pushed: number; merged: number; created: number; imported: number; conflicts: number;
  unchanged: number; skipped: number; pending: number; errors: number;
}
export const zeroCounts = (): Counts => ({ pulled: 0, pushed: 0, merged: 0, created: 0, imported: 0, conflicts: 0, unchanged: 0, skipped: 0, pending: 0, errors: 0 });
const bump = (c: Counts, r: Result) => {
  const k = ({ pulled: "pulled", pushed: "pushed", merged: "merged", created: "created", imported: "imported", conflict: "conflicts", unchanged: "unchanged", skipped: "skipped", pending: "pending", error: "errors" } as const)[r.outcome];
  c[k]++;
};
export const changedAnything = (c: Counts) => c.pulled + c.pushed + c.merged + c.created + c.imported + c.conflicts > 0;

/** Harold's id for a task that came from a provider: a UUID derived from provider + external id. */
export function derivedTaskId(provider: string, externalId: string): string {
  const h = createHash("sha256").update(`${provider}:${externalId}`).digest("hex");
  // Shape it as an RFC 4122 v5-style UUID (version nibble 5, variant 10xx).
  const v = (parseInt(h[16], 16) & 0x3 | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${v}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export const fieldsOf = (t: TaskRow): HaroldFields => ({ title: t.title, notes: t.notes, status: t.status, priority: t.priority, due: t.due, project: t.project });

const normNotes = (s: string | null) => (s || "").trim() || null;

/** The Harold fields that differ from the item (Harold's project is kept when the provider's project maps to nothing). */
export function diffFromItem(h: HaroldFields, item: ExternalItem): Partial<HaroldFields> {
  const f = item.fields;
  const out: Partial<HaroldFields> = {};
  if (h.title !== f.title) out.title = f.title;
  if (normNotes(h.notes) !== normNotes(f.notes)) out.notes = f.notes;
  if (h.status !== f.status) out.status = f.status;
  if (h.priority !== f.priority) out.priority = f.priority;
  if (h.due !== f.due) out.due = f.due;
  if (!item.projectUnmapped && (h.project || "").toLowerCase() !== (f.project || "").toLowerCase()) out.project = f.project;
  return out;
}

const sameAsItem = (h: HaroldFields, item: ExternalItem) => Object.keys(diffFromItem(h, item)).length === 0;

/** Harold's values for every field that differs from the item (what a whole-version push sends). */
function diffToPush(h: HaroldFields, item: ExternalItem): Partial<HaroldFields> {
  const d = diffFromItem(h, item);
  const out: Partial<HaroldFields> = {};
  for (const k of Object.keys(d) as FieldKey[]) (out as Record<string, unknown>)[k] = h[k];
  // A Harold project the provider shows as unmapped is still Harold's to push.
  if (item.projectUnmapped && h.project && !sameField("project", h.project, item.fields.project)) out.project = h.project;
  return out;
}

/** Field equality as the sync sees it: notes ignore surrounding blanks, projects ignore case. */
export function sameField(k: FieldKey, a: unknown, b: unknown): boolean {
  if (k === "notes") return normNotes(a as string | null) === normNotes(b as string | null);
  if (k === "project") return ((a as string | null) || "").toLowerCase() === ((b as string | null) || "").toLowerCase();
  return (a ?? null) === (b ?? null);
}

/** What both sides now agree on: Harold's values, except where the provider ended up holding something else
 *  (a field it cannot hold, such as a project it does not have), which is recorded as the provider has it. */
export function agreedFields(h: HaroldFields, item: ExternalItem): HaroldFields {
  return { ...h, ...diffFromItem(h, item) };
}

export interface EngineOptions { teamKey: string; importWindowDays?: number; defaultLookbackMs?: number; now?: () => number }

export class SyncEngine {
  private now: () => number;
  constructor(private store: SyncStore, private provider: SyncProvider, private map: ProjectMap, private opts: EngineOptions) {
    this.now = opts.now || Date.now;
  }
  private get p() { return this.provider.name; }

  private log(kind: Parameters<SyncStore["log"]>[0]["kind"], taskId: string | null | undefined, externalId: string | null | undefined, detail: Record<string, unknown>) {
    return this.store.log({ kind, provider: this.p, task_id: taskId ?? null, external_id: externalId ?? null, detail });
  }

  // ───────────── provider -> Harold ─────────────

  /** One item seen on the provider's side (webhook, catchup or import). */
  async fromProvider(item: ExternalItem, kind: "pull" | "import" = "pull"): Promise<Result> {
    if (item.teamKey && item.teamKey.toUpperCase() !== this.opts.teamKey.toUpperCase()) return { outcome: "skipped" };
    if (item.removed) return this.remove(item.externalId, item.updatedAt);
    const link = await this.store.findLink(this.p, item.externalId);
    if (!link) return this.pullNew(item, kind);
    if (link.synced_at === null) return { outcome: "pending", taskId: link.task_id }; // our own create is still in flight
    const task = await this.store.getTask(link.task_id);
    if (!task) {
      await this.log("error", link.task_id, item.externalId, { reason: "linked Harold task is missing", key: item.externalKey });
      return { outcome: "error", taskId: link.task_id };
    }
    return this.merge(task, link, item);
  }

  private async pullNew(item: ExternalItem, kind: "pull" | "import"): Promise<Result> {
    const id = derivedTaskId(this.p, item.externalId);
    let task: TaskRow;
    try {
      task = await this.store.insertTask(item.fields, this.p, id);
    } catch (e) {
      if (!(e instanceof DuplicateError)) throw e;
      // Another delivery created it first, or an earlier run stopped between the task and its link.
      const existing = await this.store.getTask(id);
      const link = await this.store.linkForTask(this.p, id);
      if (!existing || link) return { outcome: "skipped", taskId: id };
      try {
        await this.store.insertLink({ task_id: id, provider: this.p, external_id: item.externalId, external_key: item.externalKey, external_url: item.externalUrl, external_updated_at: null, synced_at: existing.updated_at, synced_fields: null });
      } catch (e2) { if (e2 instanceof DuplicateError) return { outcome: "skipped", taskId: id }; throw e2; }
      return this.merge(existing, { task_id: id, provider: this.p, external_id: item.externalId, external_key: item.externalKey, external_url: item.externalUrl, external_updated_at: null, synced_at: existing.updated_at, synced_fields: null }, item);
    }
    try {
      await this.store.insertLink({ task_id: task.id, provider: this.p, external_id: item.externalId, external_key: item.externalKey, external_url: item.externalUrl, external_updated_at: item.updatedAt, synced_at: task.updated_at, synced_fields: agreedFields(fieldsOf(task), item) });
    } catch (e) { if (e instanceof DuplicateError) return { outcome: "skipped", taskId: task.id }; throw e; }
    await this.log(kind, task.id, item.externalId, {
      key: item.externalKey, title: item.fields.title, project: item.fields.project,
      ...(item.providerProject && !item.fields.project ? { linear_project: item.providerProject, unmapped_project: true } : item.providerProject ? { linear_project: item.providerProject } : {}),
    });
    return { outcome: kind === "import" ? "imported" : "pulled", taskId: task.id };
  }

  /** Deleted on the provider's side: never deleted in Harold. An open task becomes cancelled; a finished one is left as it is. */
  async remove(externalId: string, updatedAt: string | null): Promise<Result> {
    const link = await this.store.findLink(this.p, externalId);
    if (!link) return { outcome: "skipped" };
    const task = await this.store.getTask(link.task_id);
    if (!task) return { outcome: "skipped", taskId: link.task_id };
    let row = task;
    if (OPEN_STATUSES.includes(task.status)) row = await this.store.updateTask(task.id, { status: "cancelled" }, this.p);
    await this.store.updateLink(this.p, externalId, { synced_at: row.updated_at, external_updated_at: laterIso(updatedAt, link.external_updated_at) ?? new Date(this.now()).toISOString(), synced_fields: fieldsOf(row) });
    await this.log("pull", task.id, externalId, { action: "remove", key: link.external_key, status_before: task.status, status_after: row.status });
    return { outcome: row === task ? "unchanged" : "pulled", taskId: task.id };
  }

  async webhook(events: WebhookEvent[]): Promise<Result[]> {
    const out: Result[] = [];
    for (const ev of events) {
      if (ev.teamKey && ev.teamKey.toUpperCase() !== this.opts.teamKey.toUpperCase()) { out.push({ outcome: "skipped" }); continue; }
      if (ev.action === "remove") { out.push(await this.remove(ev.externalId, ev.updatedAt)); continue; }
      // Re-read the issue rather than trusting the payload: always the current version, never a replayed one.
      const item = await this.provider.getOne(ev.externalId);
      out.push(item ? await this.fromProvider(item) : { outcome: "skipped" });
    }
    return out;
  }

  // ───────────── Harold -> provider ─────────────

  /** A Harold change (the pg_net trigger's /sync/push, or catchup). */
  async fromHarold(task: TaskRow, o: { recoverStalePending?: boolean } = {}): Promise<Result> {
    if (task.changed_by !== "harold") return { outcome: "skipped", taskId: task.id }; // the sync's own write: never echoed
    let link = await this.store.linkForTask(this.p, task.id);
    if (!link) return this.createExternal(task);
    if (link.synced_at === null) {
      // A create that has not been confirmed. If the item exists, adopt it; if it never got made, start over (catchup only).
      const made = await this.provider.getOne(link.external_id);
      if (made) {
        const patch: Partial<LinkRow> = { external_key: made.externalKey, external_url: made.externalUrl, external_updated_at: made.updatedAt, synced_at: new Date(0).toISOString(), synced_fields: null };
        await this.store.updateLink(this.p, link.external_id, patch);
        link = { ...link, ...patch };
        return this.merge(task, link, made);
      }
      if (!o.recoverStalePending) return { outcome: "pending", taskId: task.id };
      await this.store.deleteLink(this.p, link.external_id);
      return this.createExternal(task);
    }
    const item = await this.provider.getOne(link.external_id);
    if (!item || item.removed) {
      await this.log("skip", task.id, link.external_id, { reason: "the linked issue no longer exists in Linear", key: link.external_key });
      return { outcome: "skipped", taskId: task.id };
    }
    return this.merge(task, link, item);
  }

  private async createExternal(task: TaskRow): Promise<Result> {
    if (!OPEN_STATUSES.includes(task.status)) return { outcome: "skipped", taskId: task.id };
    const externalId = randomUUID();
    // The link exists before the issue does, so the provider's own webhook for the new issue finds it and waits.
    try {
      await this.store.insertLink({ task_id: task.id, provider: this.p, external_id: externalId, external_key: null, external_url: null, external_updated_at: null, synced_at: null, synced_fields: null });
    } catch (e) { if (e instanceof DuplicateError) return { outcome: "pending", taskId: task.id }; throw e; }
    let item: ExternalItem;
    try {
      item = await this.provider.create(fieldsOf(task), externalId);
    } catch (e) {
      await this.store.deleteLink(this.p, externalId);
      await this.log("error", task.id, null, { action: "create", error: e instanceof Error ? e.message : String(e) });
      return { outcome: "error", taskId: task.id };
    }
    await this.store.updateLink(this.p, externalId, { external_key: item.externalKey, external_url: item.externalUrl, external_updated_at: item.updatedAt, synced_at: task.updated_at, synced_fields: agreedFields(fieldsOf(task), item) });
    await this.log("push", task.id, externalId, { action: "create", key: item.externalKey, title: task.title, project: task.project });
    return { outcome: "created", taskId: task.id };
  }

  // ───────────── both ─────────────

  async merge(task: TaskRow, link: LinkRow, item: ExternalItem): Promise<Result> {
    const haroldChanged = task.changed_by === "harold" && ts(task.updated_at) > ts(link.synced_at);
    const providerChanged = ts(item.updatedAt) > ts(link.external_updated_at);
    if (!haroldChanged && !providerChanged) return { outcome: "unchanged", taskId: task.id };
    const h = fieldsOf(task);
    if (sameAsItem(h, item)) {
      await this.store.updateLink(this.p, item.externalId, { synced_at: laterIso(task.updated_at, link.synced_at), external_updated_at: laterIso(item.updatedAt, link.external_updated_at), synced_fields: agreedFields(h, item) });
      return { outcome: "unchanged", taskId: task.id };
    }
    if (link.synced_fields) return this.mergeFields(task, link, item, haroldChanged, providerChanged, link.synced_fields);
    // No agreed field values yet (the link's first sync): whole versions, the later one wins.
    if (haroldChanged && providerChanged) {
      // Ties go to Harold: the owner's own system of record.
      const winner = ts(task.updated_at) >= ts(item.updatedAt) ? "harold" : "provider";
      await this.log("conflict", task.id, item.externalId, {
        key: item.externalKey, rule: "whole-version", winner: winner === "harold" ? "harold" : this.p,
        harold: { ...h, updated_at: task.updated_at }, [this.p]: { ...item.fields, updated_at: item.updatedAt, project_name: item.providerProject },
        link: { synced_at: link.synced_at, external_updated_at: link.external_updated_at },
      });
      const r = winner === "harold" ? await this.apply(task, item, diffToPush(h, item), {}) : await this.apply(task, item, {}, diffFromItem(h, item));
      return r.outcome === "error" || r.outcome === "skipped" ? r : { outcome: "conflict", taskId: task.id, winner };
    }
    return haroldChanged ? this.apply(task, item, diffToPush(h, item), {}) : this.apply(task, item, {}, diffFromItem(h, item));
  }

  /**
   * Field-level three-way merge against the values both sides last agreed on (link.synced_fields).
   * A field changed on one side only is taken from that side; fields changed on different sides are merged
   * with no conflict; the same field changed on both sides to different values is a conflict, which the later
   * timestamp wins (ties to Harold), logged with both values.
   */
  private async mergeFields(task: TaskRow, link: LinkRow, item: ExternalItem, haroldChanged: boolean, providerChanged: boolean, base: HaroldFields): Promise<Result> {
    const h = fieldsOf(task), l = item.fields;
    const toPush: Partial<HaroldFields> = {}, toPull: Partial<HaroldFields> = {};
    const conflicts: { field: FieldKey; harold: unknown; [k: string]: unknown }[] = [];
    const later = ts(task.updated_at) >= ts(item.updatedAt) ? "harold" : "provider";
    const set = (o: Partial<HaroldFields>, k: FieldKey, v: unknown) => { (o as Record<string, unknown>)[k] = v; };
    for (const k of FIELD_KEYS) {
      const hD = haroldChanged && !sameField(k, h[k], base[k]);
      // A provider project that maps to no Harold project says nothing about Harold's project.
      const lD = providerChanged && !(k === "project" && item.projectUnmapped) && !sameField(k, l[k], base[k]);
      if (hD && lD && !sameField(k, h[k], l[k])) {
        conflicts.push({ field: k, harold: h[k], [this.p]: l[k], base: base[k], winner: later === "harold" ? "harold" : this.p });
        if (later === "harold") set(toPush, k, h[k]); else set(toPull, k, l[k]);
      } else if (lD && !sameField(k, h[k], l[k])) set(toPull, k, l[k]);
      else if (hD && !sameField(k, h[k], l[k])) set(toPush, k, h[k]);
    }
    if (conflicts.length) {
      await this.log("conflict", task.id, item.externalId, {
        key: item.externalKey, rule: "field", fields: conflicts,
        harold_updated_at: task.updated_at, [`${this.p}_updated_at`]: item.updatedAt,
      });
    }
    const r = await this.apply(task, item, toPush, toPull);
    if (!conflicts.length || r.outcome === "error") return r;
    const winners = new Set(conflicts.map(c => c.winner));
    return { outcome: "conflict", taskId: task.id, fields: conflicts.map(c => c.field), winner: winners.size > 1 ? "mixed" : later };
  }

  /** Sends `toPush` to the provider and writes `toPull` into Harold, then records the new agreement on the link. */
  private async apply(task: TaskRow, item: ExternalItem, toPush: Partial<HaroldFields>, toPull: Partial<HaroldFields>): Promise<Result> {
    let after = item;
    let pushed: string[] = [];
    if (Object.keys(toPush).length) {
      const r = await this.provider.update(item, { ...item.fields, ...toPush, ...("project" in toPush ? {} : { project: item.projectUnmapped ? null : item.fields.project }) });
      after = r.item; pushed = r.changed;
    }
    let row = task;
    const pullKeys = Object.keys(toPull);
    if (pullKeys.length) row = await this.store.updateTask(task.id, toPull, this.p);
    await this.store.updateLink(this.p, item.externalId, {
      external_key: after.externalKey, external_url: after.externalUrl, external_updated_at: after.updatedAt,
      synced_at: row.updated_at, synced_fields: agreedFields(fieldsOf(row), after),
    });
    if (pushed.length) await this.log("push", task.id, item.externalId, { key: after.externalKey, changed: pushed });
    if (pullKeys.length) await this.log("pull", task.id, item.externalId, { key: item.externalKey, changed: pullKeys });
    const outcome: Outcome = pushed.length && pullKeys.length ? "merged" : pushed.length ? "pushed" : pullKeys.length ? "pulled" : "unchanged";
    return { outcome, taskId: task.id };
  }

  // ───────────── catchup / import ─────────────

  async catchup(o: { import?: boolean } = {}): Promise<{ counts: Counts; cursor: string | null; previousCursor: string | null }> {
    const counts = zeroCounts();
    const startedAt = this.now();
    const state = (await this.store.getState(this.p)) ?? { cursor: null, detail: {} };
    const base = state.cursor ?? new Date(startedAt - (o.import ? 0 : this.opts.defaultLookbackMs ?? 86_400_000)).toISOString();
    const items = o.import ? await this.provider.listForImport(this.opts.importWindowDays ?? 30) : await this.provider.listChangedSince(base);

    const handled = new Set<string>();
    let newest: string | null = null;
    for (const item of items) {
      newest = laterIso(newest, item.updatedAt);
      try {
        const r = await this.fromProvider(item, o.import ? "import" : "pull");
        bump(counts, r);
        if (r.taskId) handled.add(r.taskId);
      } catch (e) {
        counts.errors++;
        await this.log("error", null, item.externalId, { phase: o.import ? "import" : "pull", key: item.externalKey, error: e instanceof Error ? e.message : String(e) });
      }
    }

    // Harold rows whose last change is Harold's own and that the provider has not seen yet.
    const tasks = (await this.store.haroldChangedTasks()).filter(t => !handled.has(t.id));
    const links = new Map((await this.store.linksForTasks(this.p, tasks.map(t => t.id))).map(l => [l.task_id, l]));
    for (const t of tasks) {
      const link = links.get(t.id);
      if (link && link.synced_at !== null && ts(t.updated_at) <= ts(link.synced_at)) continue;
      if (!link) {
        if (!OPEN_STATUSES.includes(t.status)) continue;
      }
      try { bump(counts, await this.fromHarold(t, { recoverStalePending: true })); }
      catch (e) {
        counts.errors++;
        await this.log("error", t.id, link?.external_id, { phase: "push", error: e instanceof Error ? e.message : String(e) });
      }
    }

    // Advance the cursor to the newest item seen, but never past the start of this run minus a small
    // overlap: an issue edited while we paged is then picked up next time (re-reading is harmless).
    const ceiling = new Date(startedAt - 5_000).toISOString();
    const candidate = newest && ts(newest) > ts(ceiling) ? ceiling : newest;
    const cursor = laterIso(o.import ? (state.cursor ?? ceiling) : base, candidate);
    const latest = (await this.store.getState(this.p)) ?? state;
    await this.store.setState(this.p, {
      cursor,
      detail: { ...latest.detail, last_catchup_at: new Date(startedAt).toISOString(), last_counts: counts, ...(o.import ? { imported_at: new Date(startedAt).toISOString() } : {}) },
    });
    return { counts, cursor, previousCursor: state.cursor };
  }
}
