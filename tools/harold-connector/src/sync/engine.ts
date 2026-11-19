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
//
// Several providers. One engine runs per provider. "Harold changed", from one provider's point of view, means
// the row's last change came from anyone but that provider (changed_by <> provider): the owner, or another
// provider whose change this one has not seen yet. With a single provider that is exactly changed_by = 'harold'.
//
// Providers that cannot take a caller-chosen id (Todoist). The link row is still written before the item is
// created, under a placeholder id `pending:<epoch ms>:<uuid>`, and re-keyed to the real id once the provider
// answers. The placeholder doubles as the provider's idempotency key, so a create retried after a crash returns
// the item already made instead of a second one. A webhook or catchup that sees the new item before the re-key
// finds no link for its real id; it then looks for a pending placeholder link whose task has the same title and
// waits (outcome 'pending') instead of importing a twin. A placeholder older than PENDING_RECOVER_MS is
// treated as abandoned: catchup re-issues the create under the same key, or a pull of the matching item adopts it.

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

export const PLACEHOLDER_PREFIX = "pending:";
export const PENDING_RECOVER_MS = 120_000;
export const placeholderId = (now: number) => `${PLACEHOLDER_PREFIX}${now}:${randomUUID()}`;
export const isPlaceholder = (id: string) => id.startsWith(PLACEHOLDER_PREFIX);
/** The epoch ms a placeholder was made at (0 when unreadable, so it counts as old). */
const placeholderAge = (id: string, now: number) => now - (Number(id.slice(PLACEHOLDER_PREFIX.length).split(":")[0]) || 0);
const sameTitle = (a: string | null | undefined, b: string | null | undefined) => (a || "").trim() === (b || "").trim();

export const fieldsOf = (t: TaskRow): HaroldFields => ({ title: t.title, notes: t.notes, status: t.status, priority: t.priority, due: t.due, project: t.project });

const normNotes = (s: string | null) => (s || "").trim() || null;

/** The Harold fields that differ from the item (Harold's project is kept when the provider's project maps to nothing). */
export function diffFromItem(h: HaroldFields, item: ExternalItem): Partial<HaroldFields> {
  const f = item.fields;
  const out: Partial<HaroldFields> = {};
  const held = (k: FieldKey) => !item.unmapped?.includes(k);
  if (h.title !== f.title && held("title")) out.title = f.title;
  if (normNotes(h.notes) !== normNotes(f.notes) && held("notes")) out.notes = f.notes;
  if (h.status !== f.status && held("status")) out.status = f.status;
  if (h.priority !== f.priority && held("priority")) out.priority = f.priority;
  if (h.due !== f.due && held("due")) out.due = f.due;
  if (!item.projectUnmapped && held("project") && (h.project || "").toLowerCase() !== (f.project || "").toLowerCase()) out.project = f.project;
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

export interface EngineOptions {
  /** The provider's team / workspace / project key; items with a different key are ignored. null: no restriction. */
  teamKey: string | null;
  importWindowDays?: number; defaultLookbackMs?: number; now?: () => number;
}

const outOfScope = (key: string | null | undefined, want: string | null) => !!key && !!want && key.toUpperCase() !== want.toUpperCase();
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
/** An HTTP 4xx other than 429 from a provider: retrying the same request will not help. */
const definitive = (e: unknown) => { const st = (e as { status?: unknown })?.status; return typeof st === "number" && st >= 400 && st < 500 && st !== 429; };

export class SyncEngine {
  private now: () => number;
  constructor(private store: SyncStore, private provider: SyncProvider, private map: ProjectMap, private opts: EngineOptions) {
    this.now = opts.now || Date.now;
  }
  private get p() { return this.provider.name; }
  private get chosenIds() { return this.provider.callerChosenIds !== false; }
  /** Whether the row's last change is one this provider has not made itself (see the header). */
  private notMine(task: TaskRow) { return task.changed_by !== null && task.changed_by !== this.p; }

  private log(kind: Parameters<SyncStore["log"]>[0]["kind"], taskId: string | null | undefined, externalId: string | null | undefined, detail: Record<string, unknown>) {
    return this.store.log({ kind, provider: this.p, task_id: taskId ?? null, external_id: externalId ?? null, detail });
  }

  // ───────────── provider -> Harold ─────────────

  /** One item seen on the provider's side (webhook, catchup or import). */
  async fromProvider(item: ExternalItem, kind: "pull" | "import" = "pull"): Promise<Result> {
    if (outOfScope(item.teamKey, this.opts.teamKey)) return { outcome: "skipped" };
    if (item.removed) return this.remove(item.externalId, item.updatedAt);
    const link = await this.store.findLink(this.p, item.externalId);
    if (!link) {
      if (!this.chosenIds) {
        const waiting = await this.pendingCreateFor(item);
        if (waiting) return waiting;
      }
      return this.pullNew(item, kind);
    }
    if (link.synced_at === null) return { outcome: "pending", taskId: link.task_id }; // our own create is still in flight
    const task = await this.store.getTask(link.task_id);
    if (!task) {
      await this.log("error", link.task_id, item.externalId, { reason: "linked Harold task is missing", key: item.externalKey });
      return { outcome: "error", taskId: link.task_id };
    }
    return this.merge(task, link, item);
  }

  /** An item with no link, from a provider without caller-chosen ids: is it one of our own creates still in flight? */
  private async pendingCreateFor(item: ExternalItem): Promise<Result | null> {
    for (const l of await this.store.pendingLinks(this.p)) {
      if (!isPlaceholder(l.external_id)) continue;
      const task = await this.store.getTask(l.task_id);
      if (!task || !sameTitle(task.title, item.fields.title)) continue;
      if (placeholderAge(l.external_id, this.now()) < PENDING_RECOVER_MS) return { outcome: "pending", taskId: task.id };
      // An abandoned create whose item did get made: adopt it rather than import a twin.
      return this.adopt(task, l.external_id, item);
    }
    return null;
  }

  /** Re-keys a placeholder link to the item it turned out to be, then reconciles the two like a first sync. */
  private async adopt(task: TaskRow, placeholder: string, item: ExternalItem): Promise<Result> {
    const patch: Partial<LinkRow> = { external_id: item.externalId, external_key: item.externalKey, external_url: item.externalUrl, external_updated_at: item.updatedAt, synced_at: new Date(0).toISOString(), synced_fields: null };
    if (!(await this.rekey(task.id, placeholder, patch, item))) return { outcome: "error", taskId: task.id };
    return this.merge(task, { task_id: task.id, provider: this.p, external_key: null, external_url: null, external_updated_at: null, synced_at: null, synced_fields: null, ...patch } as LinkRow, item);
  }

  /** Moves a placeholder link onto the real external id. False (and logged) when that id is already linked elsewhere. */
  private async rekey(taskId: string, placeholder: string, patch: Partial<LinkRow>, item: ExternalItem): Promise<boolean> {
    try {
      await this.store.updateLink(this.p, placeholder, patch);
      return true;
    } catch (e) {
      if (!(e instanceof DuplicateError)) throw e;
      await this.store.deleteLink(this.p, placeholder);
      await this.log("error", taskId, item.externalId, { action: "create", key: item.externalKey, reason: `the ${this.noun} created for this task is already linked to another Harold task (imported before the create was recorded)` });
      return false;
    }
  }

  private get display() { return this.provider.displayName || this.p; }
  private get noun() { return this.provider.itemNoun || "item"; }

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
      // provider_project is the generic key; `<provider>_project` (linear_project) is kept for existing readers.
      ...(item.providerProject ? { provider_project: item.providerProject, [`${this.p}_project`]: item.providerProject } : {}),
      ...(item.providerProject && !item.fields.project ? { unmapped_project: true } : {}),
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
      if (outOfScope(ev.teamKey, this.opts.teamKey)) { out.push({ outcome: "skipped" }); continue; }
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
    if (!this.notMine(task)) return { outcome: "skipped", taskId: task.id }; // this provider's own write: never echoed
    let link = await this.store.linkForTask(this.p, task.id);
    if (!link) return this.createExternal(task);
    if (link.synced_at === null && isPlaceholder(link.external_id)) {
      // A create without a caller-chosen id that was never confirmed. Wait while it may still be in flight; after
      // that (catchup only) re-issue it under the same idempotency key, which returns the item if it was made.
      if (!o.recoverStalePending || placeholderAge(link.external_id, this.now()) < PENDING_RECOVER_MS) return { outcome: "pending", taskId: task.id };
      // Finished before its create was confirmed: re-issuing could make an item only to close it. The link stays, so
      // if the item was made after all, a pull of it adopts the link instead of importing a twin.
      if (!OPEN_STATUSES.includes(task.status)) return { outcome: "skipped", taskId: task.id };
      let item: ExternalItem;
      try { item = await this.provider.create(fieldsOf(task), link.external_id); }
      catch (e) { return this.createFailed(task, link.external_id, e); }
      return this.adopt(task, link.external_id, item);
    }
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
      await this.log("skip", task.id, link.external_id, { reason: `the linked ${this.noun} no longer exists in ${this.display}`, key: link.external_key });
      return { outcome: "skipped", taskId: task.id };
    }
    return this.merge(task, link, item);
  }

  private async createExternal(task: TaskRow): Promise<Result> {
    if (!OPEN_STATUSES.includes(task.status)) return { outcome: "skipped", taskId: task.id };
    // A caller-chosen id where the provider takes one; otherwise a placeholder that is re-keyed after the create.
    const externalId = this.chosenIds ? randomUUID() : placeholderId(this.now());
    // The link exists before the item does, so the provider's own webhook for the new item finds it and waits.
    try {
      await this.store.insertLink({ task_id: task.id, provider: this.p, external_id: externalId, external_key: null, external_url: null, external_updated_at: null, synced_at: null, synced_fields: null });
    } catch (e) { if (e instanceof DuplicateError) return { outcome: "pending", taskId: task.id }; throw e; }
    let item: ExternalItem;
    try {
      item = await this.provider.create(fieldsOf(task), externalId);
    } catch (e) {
      return this.createFailed(task, externalId, e);
    }
    const agreed = { external_key: item.externalKey, external_url: item.externalUrl, external_updated_at: item.updatedAt, synced_at: task.updated_at, synced_fields: agreedFields(fieldsOf(task), item) };
    if (this.chosenIds) await this.store.updateLink(this.p, externalId, agreed);
    else if (!(await this.rekey(task.id, externalId, { external_id: item.externalId, ...agreed }, item))) return { outcome: "error", taskId: task.id };
    await this.log("push", task.id, item.externalId, { action: "create", key: item.externalKey, title: task.title, project: task.project });
    return { outcome: "created", taskId: task.id };
  }

  private async createFailed(task: TaskRow, externalId: string, e: unknown): Promise<Result> {
    // A caller-chosen id is simply dropped. A placeholder is the idempotency key: it is kept (so the retry cannot make
    // a second item if this one was made after all) unless the provider refused the request outright.
    if (this.chosenIds || definitive(e)) await this.store.deleteLink(this.p, externalId);
    await this.log("error", task.id, null, { action: "create", error: errMsg(e) });
    return { outcome: "error", taskId: task.id };
  }

  // ───────────── both ─────────────

  async merge(task: TaskRow, link: LinkRow, item: ExternalItem): Promise<Result> {
    const haroldChanged = this.notMine(task) && ts(task.updated_at) > ts(link.synced_at);
    const providerChanged = ts(item.updatedAt) > ts(link.external_updated_at) || this.sameMinuteEdit(link, item);
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

  /** A coarse-timestamp provider (Notion): the item's timestamp equals the agreed one, yet its fields moved on. */
  private sameMinuteEdit(link: LinkRow, item: ExternalItem): boolean {
    if (!this.provider.coarseTimestamps || !link.synced_fields || ts(item.updatedAt) !== ts(link.external_updated_at)) return false;
    return FIELD_KEYS.some(k => !(k === "project" && item.projectUnmapped) && !item.unmapped?.includes(k) && !sameField(k, item.fields[k], link.synced_fields![k]));
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
      const lD = providerChanged && !(k === "project" && item.projectUnmapped) && !item.unmapped?.includes(k) && !sameField(k, l[k], base[k]);
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
    const lookback = new Date(startedAt - (this.opts.defaultLookbackMs ?? 86_400_000)).toISOString();
    const base = state.cursor ?? new Date(startedAt - (o.import ? 0 : this.opts.defaultLookbackMs ?? 86_400_000)).toISOString();
    // A provider with its own opaque cursor (listChanges) keeps it in sync_state.detail.cursor_token, since
    // sync_state.cursor is a timestamp column; there sync_state.cursor only records when the last catchup ran.
    const opaque = typeof this.provider.listChanges === "function";
    const token = typeof state.detail.cursor_token === "string" ? state.detail.cursor_token : null;
    let nextToken: string | null = token;
    let items: ExternalItem[];
    if (o.import) {
      const got = await this.provider.listForImport(this.opts.importWindowDays ?? 30);
      if (Array.isArray(got)) items = got; else { items = got.items; nextToken = got.cursor ?? token; }
    } else if (opaque) {
      const got = await this.provider.listChanges!(token, lookback);
      items = got.items; nextToken = got.cursor ?? token;
    } else items = await this.provider.listChangedSince(base);

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
    const tasks = (await this.store.haroldChangedTasks(this.p)).filter(t => !handled.has(t.id));
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
    const cursor = opaque ? ceiling : laterIso(o.import ? (state.cursor ?? ceiling) : base, candidate);
    const latest = (await this.store.getState(this.p)) ?? state;
    await this.store.setState(this.p, {
      cursor,
      detail: {
        ...latest.detail, last_catchup_at: new Date(startedAt).toISOString(), last_counts: counts,
        ...(o.import ? { imported_at: new Date(startedAt).toISOString() } : {}),
        ...(opaque || nextToken !== token ? { cursor_token: nextToken } : {}),
      },
    });
    return { counts, cursor, previousCursor: state.cursor };
  }
}
