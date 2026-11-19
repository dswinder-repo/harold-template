// The Asana provider: Asana REST API 1.0 (https://app.asana.com/api/1.0, developers.asana.com/reference) for one
// workspace, optionally kept to one project (ASANA_PROJECT), webhook verification, and the mapping between Asana's
// vocabulary and Harold's.
//
//   status     completed -> completed, or cancelled when the task also carries the tag "cancelled";
//              not completed -> in_progress when it carries the tag "in-progress", else pending.
//              Asana has no in-progress or cancelled state, so those two travel as tags (the same words Todoist uses
//              as labels). Harold in_progress adds the tag "in-progress"; Harold cancelled completes the task and adds
//              "cancelled". The tags are found by name in the workspace and created there the first time they are
//              needed. Every other tag the owner set is left alone. (A section named "In progress" was the other
//              option; it would have to exist, and be found, in every project, and a task sits in a different section
//              of each project it belongs to. A tag is one object for the whole workspace and works on every plan.)
//   priority   not mapped. Asana has a priority only as a custom field that exists on paid plans and that each
//              workspace names and sets up itself. The provider never reads or sends one: items say `unmapped:
//              ["priority"]`, which makes the engine leave Harold's priority alone in both directions.
//   due        due_on (a day). A task that has only a due time (due_at) is read as its UTC day.
//   notes      the task's plain-text notes.
//   project    via ProjectMap (asana_project in the map entry, else name / aliases), looked up among the workspace's
//              projects. A task in several projects maps through the first of them that Harold knows (with
//              ASANA_PROJECT set: through that project). With ASANA_PROJECT set, only that project's tasks sync, new
//              tasks go into it and Harold never moves a task to another project. Without it, a Harold project that
//              Asana has no project for leaves the new task in no project, assigned to the token's owner ("me").
//              Harold clearing a task's project is not sent: Asana has no inbox to move it to.
//   key / url  "AS-<gid>" and the task's permalink_url.
//
// Reading. Asana's task list needs a project, a tag, or assignee + workspace (GET /tasks); it has no workspace-wide
// listing, and the workspace search endpoint is a paid-plan feature. So the provider lists every non-archived project
// of the workspace (or just ASANA_PROJECT) and lists each project's tasks, and, when not kept to one project, also the
// tasks assigned to "me" (which is where a task Harold made with no project lives). Those lists work on the free plan.
// A task in several projects is returned once. The cost is one request per project per catchup (every 10 minutes;
// Asana's free plan allows 150 requests a minute), which is why ASANA_PROJECT is worth setting for a big workspace.
// Catchup uses `modified_since` with the ordinary timestamp cursor. Subtasks are not listed (Asana returns top-level
// tasks only) and a webhook event for one is ignored.
//
// Deleted tasks. Asana's lists never return a deleted task, and the engine only learns of a deletion from (1) a
// webhook event with action "deleted", which cancels the open Harold task, or (2) the next time Harold pushes to a
// linked task and getOne answers 404 (the engine logs a skip and does nothing). Without the webhook, a task deleted in
// Asana stays open in Harold until then. A catchup sweep that fetched every linked task to look for 404s would cost one
// request per linked task every 10 minutes; the webhook is the cheap path, so that is the one chosen. (An Asana task
// that is merely removed from the kept-to project is out of scope and is skipped; nothing is cancelled.)
//
// Writing. POST /tasks and PUT /tasks/{gid}; Asana assigns the gid (callerChosenIds false). Asana has no idempotency
// key: the engine's placeholder id cannot be sent, so a create retried after a crash that happened *after* Asana made
// the task would make a second one. The engine narrows that window: catchup pulls first, and a pull that sees the new
// task adopts the pending link by matching the title (SyncEngine.pendingCreateFor) before the 2-minute recovery
// re-issues the create. A twin appears only if the first create was made and neither the re-key nor the next pull saw it.
//
// Webhooks. Asana creates them through the API (POST /webhooks with resource + target; npm run sync:asana-webhook). Task
// events reach only a webhook on a project (workspace-level webhooks do not carry task events), so there is one webhook
// per project. Each webhook's first delivery is a handshake with X-Hook-Secret, which must be echoed back in the response
// header; later deliveries carry X-Hook-Signature, the hex HMAC-SHA256 of the raw body keyed with that secret. Every
// webhook has its own secret, so the secrets are kept as a list in sync_state (provider "asana") detail.hook_secrets, and a
// signature that matches any of them is good. Because anyone can send a handshake, the target URL carries a token,
// ?t=HMAC-SHA256(SYNC_SECRET, "asana-webhook") in hex, that every delivery (handshake included) must present; without
// SYNC_SECRET the webhook answers 503. Events are compact (a resource gid and an action) and are never trusted: the engine
// re-reads the task with getOne. Heartbeats (an empty events array, every eight hours) are acknowledged and ignored.

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { FetchLike } from "../identity.js";
import type { ProviderEntry, SyncProvider, WebhookContext } from "./provider.js";
import type { ProjectMap } from "./projectmap.js";
import type { ExternalItem, HaroldFields, Status, VerifyResult, WebhookAction, WebhookEvent } from "./types.js";

export const ASANA_API = "https://app.asana.com/api/1.0";
export const IN_PROGRESS_TAG = "in-progress";
export const CANCELLED_TAG = "cancelled";
const MAX_PAGES = 100;
const MAX_HOOK_SECRETS = 100;
export const TASK_FIELDS = [
  "name", "notes", "completed", "completed_at", "due_on", "due_at", "modified_at", "permalink_url",
  "memberships.project.name", "tags.name", "parent",
].join(",");

export interface AsanaSyncConfig {
  token: string;
  /** Workspace gid or name. */
  workspace: string;
  /** Project gid or name, or null for the whole workspace. */
  project: string | null;
  /** The token every webhook delivery must carry in ?t=, or "" when SYNC_SECRET is not set (the webhook is then off). */
  hookToken: string;
}

/** The ?t= value for the webhook target URL: HMAC-SHA256 of the sync secret, so the secret itself never leaves. */
export const asanaWebhookToken = (syncSecret: string): string =>
  syncSecret ? createHmac("sha256", syncSecret).update("asana-webhook").digest("hex") : "";

export function asanaSyncFromEnv(): AsanaSyncConfig | null {
  const token = (process.env.ASANA_ACCESS_TOKEN || "").trim();
  const workspace = (process.env.ASANA_WORKSPACE || "").trim();
  if (!token || !workspace) return null;
  return { token, workspace, project: (process.env.ASANA_PROJECT || "").trim() || null, hookToken: asanaWebhookToken((process.env.SYNC_SECRET || "").trim()) };
}

// ───────────── mapping ─────────────

export interface AsanaTask {
  gid: string; name: string; notes?: string | null; completed?: boolean | null; completed_at?: string | null;
  due_on?: string | null; due_at?: string | null; modified_at?: string | null; permalink_url?: string | null;
  memberships?: { project?: { gid: string; name?: string } | null; section?: { gid: string; name?: string } | null }[];
  tags?: { gid: string; name?: string }[]; parent?: { gid: string } | null; resource_type?: string; resource_subtype?: string;
}
export interface AsanaProject { gid: string; name: string; archived?: boolean }

const hasTag = (tags: { name?: string }[] | undefined, name: string) => (tags || []).some(t => (t.name || "").trim().toLowerCase() === name);

export function statusFromAsana(completed: boolean | null | undefined, tags: { name?: string }[] | undefined): Status {
  if (completed) return hasTag(tags, CANCELLED_TAG) ? "cancelled" : "completed";
  return hasTag(tags, IN_PROGRESS_TAG) ? "in_progress" : "pending";
}

/** The status tag a Harold status needs (none for pending and completed). */
export const tagFor = (status: Status): string | null => status === "in_progress" ? IN_PROGRESS_TAG : status === "cancelled" ? CANCELLED_TAG : null;

const sameName = (a: string | null | undefined, b: string | null | undefined) => (a || "").trim().toLowerCase() === (b || "").trim().toLowerCase();
/** Whether a project (gid and name) is the one ASANA_PROJECT names. */
const isScope = (p: { gid?: string; name?: string } | null | undefined, scope: string | null) => !!p && !!scope && (p.gid === scope || sameName(p.name, scope));

/**
 * An Asana task as an ExternalItem. `scope` is ASANA_PROJECT (a gid or a name) or null. With a scope, teamKey is that
 * same string when the task belongs to the project (the engine compares it with the configured scope) and otherwise
 * the name of another project of the task, so the engine ignores it.
 */
export function taskToItem(t: AsanaTask, map: ProjectMap, scope: string | null, now: () => number = Date.now): ExternalItem {
  const projects = (t.memberships || []).map(m => m.project).filter((p): p is { gid: string; name?: string } => !!p);
  const inScope = scope ? projects.find(p => isScope(p, scope)) : undefined;
  const mapped = projects.find(p => p.name && map.fromProvider("asana", p.name));
  const chosen = inScope ?? mapped ?? projects[0];
  const providerProject = chosen?.name?.trim() || null;
  const project = map.fromProvider("asana", providerProject);
  const due = t.due_on || (t.due_at ? t.due_at.slice(0, 10) : null);
  return {
    externalId: t.gid, externalKey: `AS-${t.gid}`, externalUrl: t.permalink_url || `https://app.asana.com/0/0/${t.gid}`,
    updatedAt: t.modified_at || t.completed_at || new Date(now()).toISOString(),
    fields: {
      title: t.name, notes: t.notes?.trim() ? t.notes : null, status: statusFromAsana(t.completed, t.tags),
      priority: null, due, project,
    },
    providerProject, projectUnmapped: !!providerProject && !project,
    teamKey: scope ? (inScope ? scope : (providerProject || "(no project)")) : null,
    removed: false,
    extra: { tags: (t.tags || []).map(x => ({ gid: x.gid, name: x.name || "" })), projectGids: projects.map(p => p.gid), mappedGid: project ? chosen?.gid : undefined, completed: !!t.completed },
    unmapped: ["priority"],
  };
}

// ───────────── webhook ─────────────

/** Hex HMAC-SHA256 of the raw body keyed with a webhook's secret, compared in constant time. */
export function asanaSignatureOk(rawBody: string, header: string | null, secret: string): boolean {
  if (!header || !secret) return false;
  const h = header.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(h)) return false;
  const want = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  return timingSafeEqual(Buffer.from(h, "hex"), want);
}

const sha = (s: string) => createHash("sha256").update(s).digest();
const tokenOk = (given: string | null, want: string) => !!given && !!want && timingSafeEqual(sha(given), sha(want));

const EVENT_ACTIONS: Record<string, WebhookAction> = { added: "create", changed: "update", undeleted: "update", removed: "update", deleted: "remove" };

/** The events of a (signed) body: task events only, one per task and action; heartbeats and other resources give none. */
export function asanaEvents(rawBody: string): WebhookEvent[] | null {
  let p: { events?: { action?: string; created_at?: string; resource?: { gid?: string; resource_type?: string }; parent?: { resource_type?: string } | null }[] };
  try { p = JSON.parse(rawBody); } catch { return null; }
  const seen = new Set<string>();
  const out: WebhookEvent[] = [];
  for (const e of Array.isArray(p.events) ? p.events : []) {
    const action = EVENT_ACTIONS[e.action || ""];
    if (!action || e.resource?.resource_type !== "task" || typeof e.resource.gid !== "string") continue;
    const k = `${e.resource.gid}:${action}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ action, externalId: e.resource.gid, updatedAt: e.created_at ?? null, teamKey: null });
  }
  return out;
}

/** The handshake and the deliveries of an Asana webhook (see the header). The store keeps one secret per webhook. */
export async function verifyAsanaWebhook(req: Request, rawBody: string, cfg: Pick<AsanaSyncConfig, "hookToken">, ctx?: WebhookContext): Promise<VerifyResult> {
  if (!cfg.hookToken) return { ok: false, status: 503, reason: "SYNC_SECRET is not set (the Asana webhook target carries a token made from it)" };
  let given: string | null = null;
  try { given = new URL(req.url).searchParams.get("t"); } catch { /* no URL */ }
  if (!tokenOk(given, cfg.hookToken)) return { ok: false, status: 401, reason: "bad webhook token" };
  const store = ctx?.store();
  if (!store) return { ok: false, status: 503, reason: "Supabase is not configured (the Asana webhook secrets are kept there)" };

  const hook = req.headers.get("x-hook-secret");
  if (hook) {
    const secret = hook.trim();
    if (!secret || secret.length > 256) return { ok: false, status: 400, reason: "bad X-Hook-Secret" };
    const state = (await store.getState("asana")) ?? { cursor: null, detail: {} };
    const known = Array.isArray(state.detail.hook_secrets) ? (state.detail.hook_secrets as unknown[]).filter((s): s is string => typeof s === "string") : [];
    const secrets = [...known.filter(s => s !== secret), secret].slice(-MAX_HOOK_SECRETS);
    await store.setState("asana", { cursor: state.cursor, detail: { ...state.detail, hook_secrets: secrets } });
    return { ok: true, events: [], reply: { status: 200, headers: { "X-Hook-Secret": secret } } };
  }

  const state = await store.getState("asana");
  const secrets = Array.isArray(state?.detail.hook_secrets) ? (state!.detail.hook_secrets as unknown[]).filter((s): s is string => typeof s === "string") : [];
  const sig = req.headers.get("x-hook-signature");
  if (!secrets.some(s => asanaSignatureOk(rawBody, sig, s))) return { ok: false, status: 401, reason: "bad signature" };
  const events = asanaEvents(rawBody);
  if (!events) return { ok: false, status: 400, reason: "body is not JSON" };
  return { ok: true, events };
}

// ───────────── provider ─────────────

/** An error answer from Asana; `status` lets the engine tell a refused request (4xx) from a failed one. */
export class AsanaError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

/** Asana in the provider registry. */
export function asanaEntry(cfg: AsanaSyncConfig, fetchImpl: FetchLike, now: () => number = Date.now): ProviderEntry {
  return {
    name: "asana", scope: cfg.project,
    verifyWebhook: (req, raw, ctx) => verifyAsanaWebhook(req, raw, cfg, ctx),
    build: map => new AsanaProvider(cfg, map, fetchImpl, now),
  };
}

interface Page<T> { data: T[]; next_page?: { offset?: string } | null }

export class AsanaProvider implements SyncProvider {
  readonly name = "asana";
  readonly displayName = "Asana";
  readonly itemNoun = "task";
  readonly callerChosenIds = false;
  private ws?: Promise<string>;
  private projectList?: Promise<AsanaProject[]>;
  private tagList?: Promise<Map<string, string>>;
  constructor(private cfg: AsanaSyncConfig, private map: ProjectMap, private fetchImpl: FetchLike, private now: () => number = Date.now) {}

  async verifyWebhook(req: Request, rawBody: string, ctx?: WebhookContext): Promise<VerifyResult> {
    return verifyAsanaWebhook(req, rawBody, this.cfg, ctx);
  }

  private async call<T>(method: "GET" | "POST" | "PUT", path: string, o: { query?: Record<string, string | undefined>; data?: Record<string, unknown> } = {}): Promise<T> {
    const url = new URL(ASANA_API + path);
    for (const [k, v] of Object.entries(o.query || {})) if (v !== undefined) url.searchParams.set(k, v);
    const headers: Record<string, string> = { Authorization: `Bearer ${this.cfg.token}`, Accept: "application/json" };
    let body: string | undefined;
    if (o.data) { headers["Content-Type"] = "application/json"; body = JSON.stringify({ data: o.data }); }
    const r = await this.fetchImpl(url.toString(), { method, headers, body });
    let j: unknown = null;
    try { j = await r.json(); } catch { /* not JSON */ }
    if (!r.ok) {
      const e = ((j || {}) as { errors?: { message?: string }[] }).errors?.[0]?.message;
      const retry = r.status === 429 ? ` (rate limited; retry after ${r.headers.get("retry-after") || "?"} s)` : "";
      throw new AsanaError(`Asana answered HTTP ${r.status}${e ? `: ${e}` : ""}${retry} (${method} ${path})`, r.status);
    }
    return j as T;
  }

  private async list<T>(path: string, query: Record<string, string | undefined>): Promise<T[]> {
    const out: T[] = [];
    let offset: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const d = await this.call<Page<T>>("GET", path, { query: { ...query, limit: "100", offset } });
      out.push(...(d.data || []));
      offset = d.next_page?.offset || undefined;
      if (!offset) return out;
    }
    throw new AsanaError(`Asana list ${path} has more than ${MAX_PAGES} pages`, 500);
  }

  /** ASANA_WORKSPACE as a gid: a number is taken as it is, a name is looked up among the token's workspaces. */
  private workspace(): Promise<string> {
    this.ws ||= (async () => {
      if (/^\d+$/.test(this.cfg.workspace)) return this.cfg.workspace;
      const all = await this.list<{ gid: string; name: string }>("/workspaces", {});
      const w = all.find(x => sameName(x.name, this.cfg.workspace));
      if (!w) throw new Error(`Asana workspace "${this.cfg.workspace}" (ASANA_WORKSPACE) not found`);
      return w.gid;
    })();
    return this.ws;
  }

  private projects(): Promise<AsanaProject[]> {
    this.projectList ||= (async () => this.list<AsanaProject>("/projects", { workspace: await this.workspace(), archived: "false", opt_fields: "name,archived" }))();
    return this.projectList;
  }

  /** The configured ASANA_PROJECT, or null when the sync covers the whole workspace. */
  private async scopeProject(): Promise<AsanaProject | null> {
    if (!this.cfg.project) return null;
    const p = (await this.projects()).find(x => isScope(x, this.cfg.project));
    if (!p) throw new Error(`Asana project "${this.cfg.project}" (ASANA_PROJECT) not found in the workspace`);
    return p;
  }

  /** Every project a webhook is needed on: the kept-to project, or each project of the workspace. */
  async webhookProjects(): Promise<AsanaProject[]> {
    return (await this.scopeProject()) ? [(await this.scopeProject())!] : this.projects();
  }

  /** Every task in scope that matches `extra` (modified_since / completed_since), once each. */
  private async fetchTasks(extra: Record<string, string>): Promise<AsanaTask[]> {
    const scope = await this.scopeProject();
    const byGid = new Map<string, AsanaTask>();
    const take = (ts: AsanaTask[]) => { for (const t of ts) if (!t.parent && !byGid.has(t.gid)) byGid.set(t.gid, t); };
    for (const p of scope ? [scope] : await this.projects()) take(await this.list<AsanaTask>("/tasks", { project: p.gid, opt_fields: TASK_FIELDS, ...extra }));
    // A task Harold made with no project lives only in the owner's own list.
    if (!scope) take(await this.list<AsanaTask>("/tasks", { assignee: "me", workspace: await this.workspace(), opt_fields: TASK_FIELDS, ...extra }));
    return [...byGid.values()];
  }

  private items(tasks: AsanaTask[]): ExternalItem[] {
    return tasks.map(t => taskToItem(t, this.map, this.cfg.project, this.now));
  }

  async listChangedSince(cursor: string): Promise<ExternalItem[]> {
    return this.items(await this.fetchTasks({ modified_since: cursor }));
  }

  async listForImport(completedWithinDays: number): Promise<ExternalItem[]> {
    // completed_since: every incomplete task, plus those completed since then.
    return this.items(await this.fetchTasks({ completed_since: new Date(this.now() - completedWithinDays * 86_400_000).toISOString() }));
  }

  async getOne(externalId: string): Promise<ExternalItem | null> {
    let t: AsanaTask;
    try { t = (await this.call<{ data: AsanaTask }>("GET", `/tasks/${encodeURIComponent(externalId)}`, { query: { opt_fields: TASK_FIELDS } })).data; }
    catch (e) { if (e instanceof AsanaError && (e.status === 404 || e.status === 400 || e.status === 403)) return null; throw e; }
    if (t.parent) return null; // a subtask: Harold has no subtasks
    return taskToItem(t, this.map, this.cfg.project, this.now);
  }

  // ----- tags -----

  private tags(): Promise<Map<string, string>> {
    this.tagList ||= (async () => {
      const m = new Map<string, string>();
      for (const t of await this.list<{ gid: string; name: string }>(`/workspaces/${await this.workspace()}/tags`, { opt_fields: "name" })) m.set(t.name.trim().toLowerCase(), t.gid);
      return m;
    })();
    return this.tagList;
  }

  /** The gid of a workspace tag by name, creating the tag the first time it is needed. */
  private async tagGid(name: string): Promise<string> {
    const known = await this.tags();
    const have = known.get(name);
    if (have) return have;
    const made = await this.call<{ data: { gid: string } }>("POST", "/tags", { data: { workspace: await this.workspace(), name } });
    known.set(name, made.data.gid);
    return made.data.gid;
  }

  // ----- projects -----

  /** The Asana project a Harold project goes to; undefined when it should stay where it is (or Asana has none). */
  private async projectGidFor(haroldProject: string | null): Promise<string | undefined> {
    const scope = await this.scopeProject();
    if (scope) return scope.gid;
    const want = this.map.toProvider("asana", haroldProject)?.toLowerCase();
    if (!want) return undefined;
    return (await this.projects()).find(p => sameName(p.name, want))?.gid;
  }

  async create(fields: HaroldFields, _externalId: string): Promise<ExternalItem> {
    // Asana has no idempotency key, so the engine's placeholder cannot be sent (see the header).
    const data: Record<string, unknown> = { name: fields.title };
    if (fields.notes) data.notes = fields.notes;
    if (fields.due) data.due_on = fields.due;
    if (fields.status === "completed" || fields.status === "cancelled") data.completed = true;
    const tag = tagFor(fields.status); if (tag) data.tags = [await this.tagGid(tag)];
    const pj = await this.projectGidFor(fields.project);
    if (pj) data.projects = [pj];
    else { data.workspace = await this.workspace(); data.assignee = "me"; }
    const made = await this.call<{ data: AsanaTask }>("POST", "/tasks", { data, query: { opt_fields: TASK_FIELDS } });
    const item = await this.getOne(made.data.gid);
    if (!item) throw new AsanaError(`Asana task ${made.data.gid} was created but cannot be read back`, 500);
    return item;
  }

  async update(current: ExternalItem, fields: HaroldFields): Promise<{ item: ExternalItem; changed: string[] }> {
    const c = current.fields;
    const extra = (current.extra || {}) as { tags?: { gid: string; name: string }[]; projectGids?: string[]; mappedGid?: string; completed?: boolean };
    const id = encodeURIComponent(current.externalId);
    const changed: string[] = [];
    const put: Record<string, unknown> = {};
    if (fields.title !== c.title) { put.name = fields.title; changed.push("title"); }
    if ((fields.notes || null) !== (c.notes || null)) { put.notes = fields.notes || ""; changed.push("notes"); }
    if (fields.due !== c.due) { put.due_on = fields.due; changed.push("due"); }
    // priority is not mapped: never sent.
    if (fields.status !== c.status) {
      const done = fields.status === "completed" || fields.status === "cancelled";
      if (done !== !!extra.completed) put.completed = done;
      changed.push("status");
    }
    const projectChange = projectDiffers(current, fields.project) ? await this.projectGidFor(fields.project) : undefined;
    const toAdd = projectChange && !(extra.projectGids || []).includes(projectChange) ? projectChange : undefined;
    if (toAdd) changed.push("project");
    // Status tags: the wanted one added, the other status tag removed; the owner's own tags untouched.
    const want = tagFor(fields.status);
    const wantGid = fields.status !== c.status && want ? await this.tagGid(want) : undefined;
    const drop = fields.status !== c.status
      ? (extra.tags || []).filter(t => [IN_PROGRESS_TAG, CANCELLED_TAG].includes(t.name.trim().toLowerCase()) && t.name.trim().toLowerCase() !== want)
      : [];
    const haveWanted = !!want && (extra.tags || []).some(t => t.name.trim().toLowerCase() === want);
    if (!Object.keys(put).length && !toAdd && !drop.length && !(wantGid && !haveWanted)) return { item: current, changed: [] };

    if (Object.keys(put).length) await this.call("PUT", `/tasks/${id}`, { data: put });
    if (wantGid && !haveWanted) await this.call("POST", `/tasks/${id}/addTag`, { data: { tag: wantGid } });
    for (const t of drop) await this.call("POST", `/tasks/${id}/removeTag`, { data: { tag: t.gid } });
    if (toAdd) {
      await this.call("POST", `/tasks/${id}/addProject`, { data: { project: toAdd } });
      // Moved, not copied: leave the project the old Harold project mapped to (never one Harold has no say over).
      if (extra.mappedGid && extra.mappedGid !== toAdd && !this.cfg.project) await this.call("POST", `/tasks/${id}/removeProject`, { data: { project: extra.mappedGid } });
    }
    const item = await this.getOne(current.externalId);
    if (!item) throw new AsanaError(`Asana task ${current.externalId} cannot be read back after the update`, 500);
    return { item, changed };
  }

  /** Registers a webhook on each project (see npm run sync:asana-webhook); skips a project that already has one for this target. */
  async registerWebhooks(baseUrl: string, syncSecret: string): Promise<{ project: string; name: string; status: "created" | "exists" | "failed"; error?: string }[]> {
    if (!syncSecret) throw new Error("SYNC_SECRET is not set (the webhook target carries a token made from it)");
    const target = `${baseUrl.replace(/\/+$/, "")}/webhooks/asana?t=${asanaWebhookToken(syncSecret)}`;
    const ws = await this.workspace();
    const existing = await this.list<{ target?: string; resource?: { gid?: string } }>("/webhooks", { workspace: ws, opt_fields: "target,resource.gid" });
    const out: { project: string; name: string; status: "created" | "exists" | "failed"; error?: string }[] = [];
    for (const p of await this.webhookProjects()) {
      if (existing.some(w => w.target === target && w.resource?.gid === p.gid)) { out.push({ project: p.gid, name: p.name, status: "exists" }); continue; }
      try { await this.call("POST", "/webhooks", { data: { resource: p.gid, target } }); out.push({ project: p.gid, name: p.name, status: "created" }); }
      catch (e) { out.push({ project: p.gid, name: p.name, status: "failed", error: e instanceof Error ? e.message : String(e) }); }
    }
    return out;
  }
}

/** Project differs, except that an Asana project unknown to Harold is never treated as "Harold has none" and a Harold
 *  project of null is not sent (Asana has no inbox to move a task to). */
export function projectDiffers(item: ExternalItem, haroldProject: string | null): boolean {
  if (haroldProject === null) return false;
  return haroldProject.toLowerCase() !== (item.fields.project || "").toLowerCase();
}
