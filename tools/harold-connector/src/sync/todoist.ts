// The Todoist provider: Todoist API v1 (https://api.todoist.com/api/v1, which replaced REST v2 and Sync v9 in 2025)
// for one account, optionally kept to one project (TODOIST_PROJECT), webhook verification, and the mapping between
// Todoist's vocabulary and Harold's.
//
//   status     checked -> completed, or cancelled when the task also carries the label "cancelled";
//              not checked -> in_progress when it carries the label "in-progress", else pending.
//              Todoist has no in-progress or cancelled state, so those two travel as labels: Harold in_progress adds
//              "in-progress" (task open); Harold cancelled completes the task and adds "cancelled". Every other label
//              the owner set is left alone. A task deleted in Todoist (is_deleted) is reported as removed, which the
//              engine turns into cancelled for an open Harold task; nothing is ever deleted in Harold, and the sync
//              never deletes in Todoist. Incremental sync returns a deleted task as a tombstone (content "", project_id
//              a placeholder, updated_at null), so a tombstone is kept even when the sync is kept to one project;
//              GET /tasks/{id} answers 404 for it. A completed task is still returned by GET /tasks/{id} (checked true).
//   priority   Todoist's API counts the other way round from its apps: 4 = p1 (urgent), 3 = p2, 2 = p3, 1 = p4 (none).
//              4, 3 -> high; 2 -> medium; 1 -> low. Harold high -> 3 (p2), medium -> 2 (p3), low -> 1 (p4).
//              As with Linear, only a priority whose mapped value differs is sent, so a p1 task stays p1.
//   due        due.date, date part only (a time of day or a recurrence is read as its day). Harold sets
//              due {date: "YYYY-MM-DD"} or clears it with due: null (a recurring due date set from Harold loses its
//              recurrence: Harold has none to send).
//   notes      the task's description.
//   project    via ProjectMap (todoist_project in the map entry, else name / aliases). With TODOIST_PROJECT set, only
//              that project's tasks sync, new tasks go into it and Harold never moves a task to another project.
//   key / url  "TD-<id>" (Todoist tasks have no short key of their own) and https://app.todoist.com/app/task/<id>.
//
// Reads use the Sync endpoint's incremental sync: the engine stores Todoist's opaque sync_token (listChanges), not a
// timestamp. The first import adds tasks completed in the window from /tasks/completed/by_completion_date.
// Writes go through /sync commands (item_add, item_update, item_move, item_complete, item_uncomplete): one request per
// change, each command's uuid making a retry idempotent. Todoist assigns task ids itself (callerChosenIds false): the
// engine's placeholder link id is used as item_add's uuid, so a create retried after a crash returns the same task.
//
// Webhooks: X-Todoist-Hmac-SHA256 is the base64 HMAC-SHA256 of the raw body keyed with the app's client secret
// (TODOIST_CLIENT_SECRET). Webhooks need a Todoist app (App Console) with the webhook URL and the events set, and the
// connector using that app's token (its test token, or an OAuth token for it). Then changes made by any client on the
// account (the app, the web, another token) arrive within a few seconds. Without that, the 10-minute catchup is the
// only path from Todoist to Harold.

import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { FetchLike } from "../identity.js";
import type { ChangeBatch, ProviderEntry, SyncProvider } from "./provider.js";
import type { ProjectMap } from "./projectmap.js";
import type { ExternalItem, HaroldFields, Priority, Status, VerifyResult, WebhookAction, WebhookEvent } from "./types.js";

export const TODOIST_API = "https://api.todoist.com/api/v1";
/** Todoist re-delivers a failed webhook up to three times, 15 minutes apart; this window still accepts those. */
export const TODOIST_WEBHOOK_MAX_AGE_MS = 60 * 60_000;
export const IN_PROGRESS_LABEL = "in-progress";
export const CANCELLED_LABEL = "cancelled";
const MAX_PAGES = 50;

export interface TodoistSyncConfig { token: string; project: string | null; clientSecret: string }

export function todoistSyncFromEnv(): TodoistSyncConfig | null {
  const token = (process.env.TODOIST_API_TOKEN || "").trim();
  if (!token) return null;
  return { token, project: (process.env.TODOIST_PROJECT || "").trim() || null, clientSecret: (process.env.TODOIST_CLIENT_SECRET || "").trim() };
}

// ───────────── mapping ─────────────

const hasLabel = (labels: string[] | undefined, l: string) => (labels || []).some(x => x.toLowerCase() === l);

export function statusFromTodoist(checked: boolean | null | undefined, labels: string[] | undefined): Status {
  if (checked) return hasLabel(labels, CANCELLED_LABEL) ? "cancelled" : "completed";
  return hasLabel(labels, IN_PROGRESS_LABEL) ? "in_progress" : "pending";
}

/** The task's labels for a Harold status: the two status labels set or cleared, every other label kept. */
export function labelsFor(status: Status, labels: string[] | undefined): string[] {
  const rest = (labels || []).filter(l => !["in-progress", "cancelled"].includes(l.toLowerCase()));
  if (status === "in_progress") rest.push(IN_PROGRESS_LABEL);
  if (status === "cancelled") rest.push(CANCELLED_LABEL);
  return rest;
}

export function priorityFromTodoist(p: number | null | undefined): Priority {
  if (p === 4 || p === 3) return "high";
  if (p === 2) return "medium";
  return "low";
}

export function priorityToTodoist(p: Priority | null): number | null {
  return p === "high" ? 3 : p === "medium" ? 2 : p === "low" ? 1 : null;
}

export interface TodoistTask {
  id: string; content: string; description?: string | null; priority?: number | null;
  due?: { date: string; string?: string; is_recurring?: boolean; timezone?: string | null } | null;
  checked?: boolean | null; is_deleted?: boolean | null; project_id?: string | null; labels?: string[];
  updated_at?: string | null; added_at?: string | null; completed_at?: string | null; parent_id?: string | null;
}
export interface TodoistProject { id: string; name: string; inbox_project?: boolean; is_deleted?: boolean }

export const taskUrl = (id: string) => `https://app.todoist.com/app/task/${id}`;

/** A Todoist task as an ExternalItem. `scoped` (TODOIST_PROJECT set): the item's teamKey is its project name, so the
 *  engine ignores tasks of other projects; otherwise there is no scope. */
export function taskToItem(t: TodoistTask, projectName: string | null, map: ProjectMap, scoped: boolean, now: () => number = Date.now): ExternalItem {
  const providerProject = projectName?.trim() || null;
  const project = map.fromProvider("todoist", providerProject);
  return {
    externalId: t.id, externalKey: `TD-${t.id}`, externalUrl: taskUrl(t.id),
    // A deletion tombstone has updated_at null and added_at at the epoch: it counts as now.
    updatedAt: t.updated_at || t.completed_at || (t.is_deleted ? null : t.added_at) || new Date(now()).toISOString(),
    fields: {
      title: t.content, notes: t.description?.trim() ? t.description : null,
      status: statusFromTodoist(t.checked, t.labels), priority: priorityFromTodoist(t.priority),
      due: t.due?.date ? t.due.date.slice(0, 10) : null, project,
    },
    providerProject, projectUnmapped: !!providerProject && !project,
    teamKey: scoped ? providerProject : null, removed: !!t.is_deleted,
    extra: { labels: t.labels || [], projectId: t.project_id ?? null, checked: !!t.checked },
  };
}

// ───────────── webhook ─────────────

/** Base64 HMAC-SHA256 of the raw body with the client secret, compared in constant time. */
export function todoistSignatureOk(rawBody: string, header: string | null, secret: string): boolean {
  if (!header || !secret) return false;
  const want = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  const h = header.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(h)) return false;
  const got = Buffer.from(h, "base64");
  return got.length === want.length && timingSafeEqual(got, want);
}

const EVENT_ACTIONS: Record<string, WebhookAction> = {
  "item:added": "create", "item:updated": "update", "item:completed": "update", "item:uncompleted": "update", "item:deleted": "remove",
};

export function verifyTodoistWebhook(rawBody: string, header: string | null, secret: string, now: number): VerifyResult {
  if (!secret) return { ok: false, status: 503, reason: "TODOIST_CLIENT_SECRET is not set" };
  if (!todoistSignatureOk(rawBody, header, secret)) return { ok: false, status: 401, reason: "bad signature" };
  let p: { event_name?: string; event_data?: Record<string, unknown>; triggered_at?: string };
  try { p = JSON.parse(rawBody); } catch { return { ok: false, status: 400, reason: "body is not JSON" }; }
  // Todoist signs no timestamp header; triggered_at inside the signed body is the freshness check.
  const t = Date.parse(String(p.triggered_at || ""));
  if (!Number.isFinite(t) || now - t > TODOIST_WEBHOOK_MAX_AGE_MS || t - now > 5 * 60_000) return { ok: false, status: 401, reason: "stale or missing triggered_at" };
  const action = EVENT_ACTIONS[p.event_name || ""];
  const d = p.event_data as { id?: unknown; updated_at?: string | null } | undefined;
  if (!action || !d || typeof d.id !== "string") return { ok: true, events: [] };
  const ev: WebhookEvent = { action, externalId: d.id, updatedAt: d.updated_at ?? p.triggered_at ?? null, teamKey: null };
  return { ok: true, events: [ev] };
}

// ───────────── provider ─────────────

/** An error answer from Todoist; `status` lets the engine tell a refused request (4xx) from a failed one. */
export class TodoistError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

/** Todoist in the provider registry. */
export function todoistEntry(cfg: TodoistSyncConfig, fetchImpl: FetchLike, now: () => number = Date.now): ProviderEntry {
  return {
    name: "todoist", scope: cfg.project,
    verifyWebhook: (req, raw) => verifyTodoistWebhook(raw, req.headers.get("x-todoist-hmac-sha256"), cfg.clientSecret, now()),
    build: map => new TodoistProvider(cfg, map, fetchImpl, now),
  };
}

/** A UUID for a sync command, stable for a given key (the engine's placeholder id), so a retry repeats the command. */
export function commandUuid(key: string, salt = ""): string {
  const m = key.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  if (m && !salt) return m[0].toLowerCase();
  const h = createHash("sha256").update(`${salt}:${key}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${((parseInt(h[16], 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

interface Command { type: string; uuid: string; temp_id?: string; args: Record<string, unknown> }
interface SyncResponse {
  sync_token?: string; full_sync?: boolean; items?: TodoistTask[]; projects?: TodoistProject[];
  sync_status?: Record<string, unknown>; temp_id_mapping?: Record<string, string>;
}

export class TodoistProvider implements SyncProvider {
  readonly name = "todoist";
  readonly displayName = "Todoist";
  readonly itemNoun = "task";
  readonly callerChosenIds = false;
  private projectList?: Promise<Map<string, TodoistProject>>;
  constructor(private cfg: TodoistSyncConfig, private map: ProjectMap, private fetchImpl: FetchLike, private now: () => number = Date.now) {}

  async verifyWebhook(req: Request, rawBody: string): Promise<VerifyResult> {
    return verifyTodoistWebhook(rawBody, req.headers.get("x-todoist-hmac-sha256"), this.cfg.clientSecret, this.now());
  }

  private async call<T>(method: "GET" | "POST", path: string, o: { query?: Record<string, string | undefined>; form?: Record<string, string> } = {}): Promise<T> {
    const url = new URL(TODOIST_API + path);
    for (const [k, v] of Object.entries(o.query || {})) if (v !== undefined) url.searchParams.set(k, v);
    const headers: Record<string, string> = { Authorization: `Bearer ${this.cfg.token}` };
    let body: string | undefined;
    if (o.form) { headers["Content-Type"] = "application/x-www-form-urlencoded"; body = new URLSearchParams(o.form).toString(); }
    const r = await this.fetchImpl(url.toString(), { method, headers, body });
    let j: unknown = null;
    try { j = await r.json(); } catch { /* not JSON */ }
    if (!r.ok) {
      const e = (j || {}) as { error?: string; error_tag?: string };
      throw new TodoistError(`Todoist answered HTTP ${r.status}${e.error ? `: ${e.error}` : ""}${e.error_tag ? ` (${e.error_tag})` : ""} (${method} ${path})`, r.status);
    }
    return j as T;
  }

  private projects(): Promise<Map<string, TodoistProject>> {
    this.projectList ||= (async () => {
      const out = new Map<string, TodoistProject>();
      let cursor: string | undefined;
      for (let page = 0; page < MAX_PAGES; page++) {
        const d = await this.call<{ results: TodoistProject[]; next_cursor: string | null }>("GET", "/projects", { query: { limit: "200", cursor } });
        for (const p of d.results || []) out.set(p.id, p);
        if (!d.next_cursor) break;
        cursor = d.next_cursor;
      }
      return out;
    })();
    return this.projectList;
  }

  /** The configured TODOIST_PROJECT, or null when the sync covers every project. */
  private async scopeProject(): Promise<TodoistProject | null> {
    if (!this.cfg.project) return null;
    const want = this.cfg.project.toLowerCase();
    const p = [...(await this.projects()).values()].find(x => !x.is_deleted && x.name.toLowerCase() === want);
    if (!p) throw new Error(`Todoist project "${this.cfg.project}" (TODOIST_PROJECT) not found`);
    return p;
  }

  private async toItems(tasks: TodoistTask[]): Promise<ExternalItem[]> {
    const projects = await this.projects();
    const scope = await this.scopeProject();
    // A deleted task comes back from incremental sync as a tombstone whose project_id is a placeholder
    // ("2222222222222222"), so it is kept whatever its project: the engine only acts on one it has a link for.
    return tasks
      .filter(t => !scope || t.project_id === scope.id || t.is_deleted)
      .map(t => taskToItem(t, (t.project_id && projects.get(t.project_id)?.name) || null, this.map, !!scope, this.now));
  }

  private async sync(token: string): Promise<SyncResponse> {
    const d = await this.call<SyncResponse>("POST", "/sync", { form: { sync_token: token, resource_types: JSON.stringify(["items", "projects"]) } });
    if (d.projects?.length) {
      const known = await this.projects();
      for (const p of d.projects) known.set(p.id, p);
    }
    return d;
  }

  async listChanges(cursor: string | null, lookbackSince: string): Promise<ChangeBatch> {
    let d: SyncResponse;
    try { d = await this.sync(cursor || "*"); }
    catch (e) {
      // A stored token Todoist no longer accepts: start again from a full sync rather than fail every 10 minutes.
      // (Live, 2026-11-18: Todoist answers a malformed or unknown token with HTTP 200 and a full sync instead, which
      // returns every active task as changed; the engine finds them unchanged. This branch covers an explicit 400.)
      if (cursor && e instanceof TodoistError && e.status === 400) return this.listChanges(null, lookbackSince);
      throw e;
    }
    let tasks = d.items || [];
    // No token yet: a full sync returns every active task; only those changed within the look-back count as changes.
    if (!cursor) { const since = Date.parse(lookbackSince); tasks = tasks.filter(t => Date.parse(t.updated_at || t.added_at || "") >= since); }
    return { items: await this.toItems(tasks), cursor: d.sync_token ?? cursor };
  }

  async listChangedSince(cursor: string): Promise<ExternalItem[]> {
    return (await this.listChanges(null, cursor)).items;
  }

  async listForImport(completedWithinDays: number): Promise<ChangeBatch> {
    const full = await this.sync("*");
    const scope = await this.scopeProject();
    const byId = new Map<string, TodoistTask>();
    for (const t of full.items || []) if (!t.is_deleted) byId.set(t.id, t);
    const until = new Date(this.now()).toISOString(), since = new Date(this.now() - completedWithinDays * 86_400_000).toISOString();
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const d = await this.call<{ items: TodoistTask[]; next_cursor?: string | null }>("GET", "/tasks/completed/by_completion_date", {
        query: { since, until, limit: "200", cursor, project_id: scope?.id },
      });
      for (const t of d.items || []) if (!byId.has(t.id)) byId.set(t.id, t);
      if (!d.next_cursor) break;
      cursor = d.next_cursor;
    }
    return { items: await this.toItems([...byId.values()]), cursor: full.sync_token ?? null };
  }

  async getOne(externalId: string): Promise<ExternalItem | null> {
    let t: TodoistTask;
    try { t = await this.call<TodoistTask>("GET", `/tasks/${encodeURIComponent(externalId)}`); }
    catch (e) { if (e instanceof TodoistError && (e.status === 404 || e.status === 400)) return null; throw e; }
    const projects = await this.projects();
    // getOne answers for any project: the engine compares teamKey against TODOIST_PROJECT.
    return taskToItem(t, (t.project_id && projects.get(t.project_id)?.name) || null, this.map, !!this.cfg.project, this.now);
  }

  /** The Todoist project a Harold project goes to: undefined when it should stay where it is. */
  private async projectIdFor(haroldProject: string | null): Promise<string | undefined> {
    if (this.cfg.project) return undefined; // kept to one project: never moved
    const want = this.map.toProvider("todoist", haroldProject)?.toLowerCase();
    if (!want) return undefined;
    return [...(await this.projects()).values()].find(p => !p.is_deleted && p.name.toLowerCase() === want)?.id;
  }

  private async inboxId(): Promise<string | undefined> {
    if (this.cfg.project) return undefined;
    return [...(await this.projects()).values()].find(p => p.inbox_project && !p.is_deleted)?.id;
  }

  private async commands(cmds: Command[]): Promise<SyncResponse> {
    const d = await this.call<SyncResponse>("POST", "/sync", { form: { commands: JSON.stringify(cmds) } });
    for (const c of cmds) {
      const st = d.sync_status?.[c.uuid];
      if (st !== "ok") {
        const e = (st || {}) as { error?: string; error_tag?: string; http_code?: number };
        throw new TodoistError(`Todoist ${c.type} failed: ${e.error || "no status"}${e.error_tag ? ` (${e.error_tag})` : ""}`, e.http_code ?? 500);
      }
    }
    return d;
  }

  async create(fields: HaroldFields, externalId: string): Promise<ExternalItem> {
    const scope = await this.scopeProject();
    const args: Record<string, unknown> = { content: fields.title };
    if (fields.notes) args.description = fields.notes;
    const pr = priorityToTodoist(fields.priority); if (pr !== null) args.priority = pr;
    if (fields.due) args.due = { date: fields.due };
    const labels = labelsFor(fields.status, []); if (labels.length) args.labels = labels;
    const pj = scope?.id ?? (await this.projectIdFor(fields.project)); if (pj) args.project_id = pj;
    // uuid and temp_id both come from the engine's key: re-sending the same create returns the task already made.
    const uuid = commandUuid(externalId), tempId = commandUuid(externalId, "temp");
    const cmds: Command[] = [{ type: "item_add", uuid, temp_id: tempId, args }];
    if (fields.status === "completed" || fields.status === "cancelled") cmds.push({ type: "item_complete", uuid: commandUuid(externalId, "complete"), args: { id: tempId } });
    const d = await this.commands(cmds);
    const id = d.temp_id_mapping?.[tempId];
    if (!id) throw new TodoistError("Todoist item_add returned no id for the new task", 500);
    const item = await this.getOne(id);
    if (!item) throw new TodoistError(`Todoist task ${id} was created but cannot be read back`, 500);
    return item;
  }

  async update(current: ExternalItem, fields: HaroldFields): Promise<{ item: ExternalItem; changed: string[] }> {
    const c = current.fields;
    const extra = (current.extra || {}) as { labels?: string[]; projectId?: string | null; checked?: boolean };
    const id = current.externalId;
    const upd: Record<string, unknown> = {};
    const changed: string[] = [];
    const cmds: Command[] = [];
    if (fields.title !== c.title) { upd.content = fields.title; changed.push("title"); }
    if ((fields.notes || null) !== (c.notes || null)) { upd.description = fields.notes || ""; changed.push("notes"); }
    if (fields.due !== c.due) { upd.due = fields.due ? { date: fields.due } : null; changed.push("due"); }
    if (fields.priority !== null && fields.priority !== c.priority) { upd.priority = priorityToTodoist(fields.priority); changed.push("priority"); }
    if (fields.status !== c.status) {
      const labels = labelsFor(fields.status, extra.labels);
      if (JSON.stringify(labels) !== JSON.stringify(extra.labels || [])) upd.labels = labels;
      changed.push("status");
    }
    // A fresh uuid per command: two different updates must never look like a retry of each other.
    const u = (_type: string) => randomUUID();
    if (Object.keys(upd).length) cmds.push({ type: "item_update", uuid: u("update"), args: { id, ...upd } });
    if (fields.status !== c.status) {
      const close = fields.status === "completed" || fields.status === "cancelled";
      if (close && !extra.checked) cmds.push({ type: "item_complete", uuid: u("complete"), args: { id } });
      if (!close && extra.checked) cmds.push({ type: "item_uncomplete", uuid: u("uncomplete"), args: { id } });
    }
    if (projectDiffers(current, fields.project)) {
      // Harold has no project: the task goes back to the Inbox (unless the sync is kept to one project).
      const pj = fields.project === null ? await this.inboxId() : await this.projectIdFor(fields.project);
      if (pj && pj !== extra.projectId) { cmds.push({ type: "item_move", uuid: u("move"), args: { id, project_id: pj } }); changed.push("project"); }
    }
    if (!cmds.length) return { item: current, changed: [] };
    await this.commands(cmds);
    const item = await this.getOne(id);
    if (!item) throw new TodoistError(`Todoist task ${id} cannot be read back after the update`, 500);
    return { item, changed };
  }
}

/** Project differs, except that a Todoist project unknown to Harold is never treated as "Harold has none". */
export function projectDiffers(item: ExternalItem, haroldProject: string | null): boolean {
  if (haroldProject === null && item.projectUnmapped) return false;
  return (haroldProject || "").toLowerCase() !== (item.fields.project || "").toLowerCase();
}
