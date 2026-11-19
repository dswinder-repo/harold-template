// The Notion provider: one Notion database (strictly, one of its data sources) holds the tasks, with the owner's own
// properties mapped to Harold's fields. Notion API version 2026-03-11 (pinned in NOTION_VERSION).
//
// Data sources. Since API version 2025-09-03 a Notion database is a container of one or more data sources, and the
// schema (properties), queries and page parents belong to the data source: POST /v1/data_sources/{id}/query,
// GET /v1/data_sources/{id}, and new pages under parent {type: "data_source_id"}. Version 2026-03-11 also renamed
// `archived` to `in_trash`. Setup records both ids (database_id, data_source_id); everything at run time uses the
// data source.
//
// Where the configuration lives. NOTION_TOKEN (an internal integration secret) is the only required variable. Which
// data source holds the tasks and how its properties map to Harold's fields are NOT environment variables: they are
// saved by the MCP tool sync_setup_notion in sync_state row 'notion', detail.setup (NotionSetup below), so choosing or
// changing the database needs no redeploy. Until a setup is saved the provider is configured but not set up: the
// sync routes skip it with that reason, and the other providers run as usual.
//
// Mapping (property names are the owner's, chosen at setup):
//   title     the data source's title property (required).
//   status    a Status or Select property (required). Harold -> Notion through setup.status_map (Harold status ->
//             option name); a Harold status with no option there is written as the option for the nearest status
//             (cancelled -> completed's option, in_progress -> pending's option). Notion -> Harold through
//             setup.status_in (every option known at setup -> Harold status): mapped options as mapped; an unmapped
//             option of a Status property by its group (To-do -> pending, In progress -> in_progress,
//             Complete -> completed); an unmapped Select option, or an option added after setup, -> pending.
//             Re-run sync_setup_notion after adding options.
//   due       a Date property (optional): the day of date.start; Harold writes {start: day} or clears it (a time of
//             day or an end date set in Notion is dropped when Harold changes the due date).
//   priority  a Select property (optional), through setup.priority_map / priority_in. An empty or unknown option reads
//             as "no priority"; Harold never fills an empty Notion priority with its own default (medium). A select
//             with no options at all (a new database) is set up as High / Medium / Low: writing an option name the
//             select does not have makes Notion add it (checked live), so the options appear on first use.
//   notes     a Rich text property (optional), as plain text (formatting set in Notion is lost when Harold changes
//             it). The page body is never read or written: with no notes property, notes do not sync.
//   project   a Select property (optional), through ProjectMap (`notion_project:` in a harold/projects.md entry, else
//             its name or aliases). Writing an option name Notion does not have yet adds it to the select.
//   key / url "NO-<last 8 hex of the page id>" and the page's own url. (Not the first 8: live, 2026-11-19, every page
//              of a workspace shared them, e.g. 41df7011-d660-81..., so all pages had the same key.)
//
// Changes. listChangedSince queries the data source with a last_edited_time filter sorted ascending, paginated with
// start_cursor. Notion's last_edited_time is rounded to the minute, so (1) the query starts one minute before the
// cursor (re-reading an unchanged page is a no-op in the engine), and (2) the provider declares coarseTimestamps,
// so the engine also treats an item as changed when its timestamp equals the last agreed one but its fields differ
// from the agreed values (an edit made in the same minute as the previous sync).
//
// Creates. Notion assigns page ids (callerChosenIds false) and has no idempotency key. To keep a retried create from
// making a twin, create first looks for a page in the data source with the same title created since the engine's
// placeholder was made (it carries its own timestamp) and returns that page instead of creating another.
//
// Removed. A page in the trash or archived reads as removed (an open Harold task becomes cancelled). Checked live
// (2026-11-18): a data source query never returns a trashed page, and trashing does not move last_edited_time, so the
// catchup cannot see a trash; only the webhook's page.deleted event cancels the Harold task. Without the webhook, the
// task stays open, and the next Harold change to it reads the page (in_trash: true) and logs a skip, as for Linear. A
// page that is no longer in the configured data source (moved out, or another database entirely) reads as not found:
// it stops syncing and nothing in Harold changes. The sync never deletes or trashes a Notion page.
//
// Webhooks (POST /webhooks/notion). When a subscription is created, Notion sends one request whose body is
// {"verification_token": "..."}; the owner pastes that token into Notion's Verify form, and every later event is
// signed with it: X-Notion-Signature: sha256=<hex HMAC-SHA256 of the raw body>. The token request carries the very
// token that signs it, so it cannot be checked and anyone could send one; it is accepted only while the owner has said one is expected
// (sync_setup_notion webhook "expect", a 30-minute window); otherwise 403 and Notion's "Resend token" retries later.
// The accepted token is kept in sync_state detail.webhook (never in sync_log or the function log) and shown to the
// owner only when sync_setup_notion is asked to reveal it. Signatures are checked with NOTION_WEBHOOK_SECRET when it
// is set (no database read), else with the stored token; once NOTION_WEBHOOK_SECRET holds the same value the stored
// copy is erased. Events name the page in entity.id; the engine re-reads it (getOne), so a payload is never trusted.

import { createHmac, timingSafeEqual } from "node:crypto";
import type { FetchLike } from "../identity.js";
import type { ProviderEntry, SyncProvider, WebhookContext } from "./provider.js";
import type { ProjectMap } from "./projectmap.js";
import type { SyncStore } from "./store.js";
import { STATUSES, PRIORITIES, type ExternalItem, type FieldKey, type HaroldFields, type Priority, type Status, type VerifyResult, type WebhookAction, type WebhookEvent } from "./types.js";

export const NOTION_API = "https://api.notion.com/v1";
export const NOTION_VERSION = "2026-03-11";
/** sync_state row that holds the setup, the webhook token and the cursor. */
export const NOTION_STATE = "notion";
/** How long a verification token is accepted after the owner says one is expected. */
export const WEBHOOK_EXPECT_MS = 30 * 60_000;
/** last_edited_time is minute-granular: queries start this much before the cursor. */
export const CURSOR_OVERLAP_MS = 60_000;
const MAX_PAGES = 100; // 100 pages of 100 = Notion's own 10,000-result query cap
const TEXT_CHUNK = 2000; // Notion's limit per rich-text object

export interface NotionSyncConfig { token: string; webhookSecret: string }

export function notionSyncFromEnv(): NotionSyncConfig | null {
  const token = (process.env.NOTION_TOKEN || "").trim();
  if (!token) return null;
  return { token, webhookSecret: (process.env.NOTION_WEBHOOK_SECRET || "").trim() };
}

// ───────────── setup ─────────────

export const SETUP_FIELDS = ["title", "status", "due", "priority", "notes", "project"] as const;
export type SetupField = typeof SETUP_FIELDS[number];
/** The Notion property types each Harold field accepts. */
export const FIELD_TYPES: Record<SetupField, readonly string[]> = {
  title: ["title"], status: ["status", "select"], due: ["date"], priority: ["select"], notes: ["rich_text"], project: ["select"],
};
export type StatusGroup = "todo" | "in_progress" | "complete";

export interface NotionSetup {
  database_id: string;
  data_source_id: string;
  /** The data source's name when it was set up, for messages. */
  name: string;
  /** Property names; null when the field is not synced. title and status are required. */
  fields: { title: string; status: string; due: string | null; priority: string | null; notes: string | null; project: string | null };
  status_type: "status" | "select";
  /** Harold status -> the option Harold writes (null: none; the nearest status's option is used). */
  status_map: Record<Status, string | null>;
  /** Every status option known at setup -> the Harold status it reads as. */
  status_in: Record<string, Status>;
  priority_map: Record<Priority, string | null>;
  priority_in: Record<string, Priority>;
  saved_at: string;
}

export interface NotionWebhookState { token?: string; received_at?: string; expect_until?: string }

export async function loadNotionState(store: SyncStore): Promise<{ setup: NotionSetup | null; webhook: NotionWebhookState; detail: Record<string, unknown>; cursor: string | null }> {
  const s = await store.getState(NOTION_STATE);
  const detail = s?.detail || {};
  const setup = isSetup(detail.setup) ? detail.setup : null;
  const webhook = (detail.webhook && typeof detail.webhook === "object" ? detail.webhook : {}) as NotionWebhookState;
  return { setup, webhook, detail, cursor: s?.cursor ?? null };
}

function isSetup(v: unknown): v is NotionSetup {
  const s = v as NotionSetup | null;
  return !!s && typeof s === "object" && typeof s.data_source_id === "string" && !!s.fields && typeof s.fields.title === "string" && typeof s.fields.status === "string"
    && !!s.status_map && !!s.status_in;
}

/** Writes part of sync_state 'notion'.detail, keeping everything else (cursor included). */
export async function patchNotionState(store: SyncStore, patch: Record<string, unknown>, cursor?: string | null): Promise<void> {
  const s = (await store.getState(NOTION_STATE)) ?? { cursor: null, detail: {} };
  const detail = { ...s.detail, ...patch };
  for (const [k, v] of Object.entries(patch)) if (v === undefined) delete detail[k];
  await store.setState(NOTION_STATE, { cursor: cursor === undefined ? s.cursor : cursor, detail });
}

// ───────────── Notion objects ─────────────

export interface RichText { type?: string; plain_text?: string; text?: { content: string; link?: unknown } }
export interface SelectOption { id?: string; name: string; color?: string; description?: string | null }
export interface StatusGroupDef { id?: string; name: string; color?: string; option_ids: string[] }
export interface PropertySchema {
  id: string; name: string; type: string; description?: string | null;
  status?: { options: SelectOption[]; groups: StatusGroupDef[]; default_option?: string | null };
  select?: { options: SelectOption[] };
}
export interface DataSource {
  object: "data_source"; id: string; title?: RichText[]; properties: Record<string, PropertySchema>;
  parent?: { type: string; database_id?: string }; in_trash?: boolean; url?: string;
}
export interface PropertyValue {
  id?: string; type: string;
  title?: RichText[]; rich_text?: RichText[];
  status?: { id?: string; name: string; color?: string } | null;
  select?: { id?: string; name: string; color?: string } | null;
  date?: { start: string; end?: string | null; time_zone?: string | null } | null;
}
export interface NotionPage {
  object: "page"; id: string; created_time: string; last_edited_time: string; in_trash?: boolean; is_archived?: boolean; archived?: boolean;
  url: string; parent: { type: string; data_source_id?: string; database_id?: string; page_id?: string };
  properties: Record<string, PropertyValue>;
}

export const plain = (rt: RichText[] | undefined | null) => (rt || []).map(r => r.plain_text ?? r.text?.content ?? "").join("");
/** Plain text as rich-text objects of at most 2000 characters each (Notion's limit per object). */
export function richText(s: string): RichText[] {
  const out: RichText[] = [];
  for (let i = 0; i < s.length; i += TEXT_CHUNK) out.push({ type: "text", text: { content: s.slice(i, i + TEXT_CHUNK) } });
  return out.slice(0, 100);
}
const compactId = (id: string) => id.replace(/-/g, "").toLowerCase();
export const sameId = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && compactId(a) === compactId(b);
export const pageKey = (id: string) => `NO-${compactId(id).slice(-8)}`;
export const dataSourceName = (d: DataSource) => plain(d.title).trim() || "(untitled)";

// ───────────── mapping ─────────────

const fold = (s: string) => s.trim().toLowerCase();

/** A Notion status/select option -> Harold status (the rules in the header). */
export function statusFromNotion(option: string | null | undefined, setup: NotionSetup): Status {
  if (!option) return "pending";
  const exact = setup.status_in[option];
  if (exact) return exact;
  const k = Object.keys(setup.status_in).find(o => fold(o) === fold(option));
  return k ? setup.status_in[k] : "pending";
}

/** The option Harold writes for a status: its own, else the nearest status's. */
export function statusOption(status: Status, setup: NotionSetup): string | null {
  const m = setup.status_map;
  const order: Record<Status, Status[]> = {
    pending: ["pending", "in_progress"], in_progress: ["in_progress", "pending"],
    completed: ["completed", "cancelled"], cancelled: ["cancelled", "completed"],
  };
  for (const s of order[status]) if (m[s]) return m[s];
  return null;
}

export function priorityFromNotion(option: string | null | undefined, setup: NotionSetup): Priority | null {
  if (!option) return null;
  const k = Object.keys(setup.priority_in || {}).find(o => fold(o) === fold(option));
  return k ? setup.priority_in[k] : null;
}

/** The Harold fields this setup does not sync. */
export const unmappedFields = (s: NotionSetup): FieldKey[] =>
  (["due", "priority", "notes", "project"] as const).filter(k => !s.fields[k]);

/** A Notion page as an ExternalItem (null: not a page of the configured data source). */
export function pageToItem(p: NotionPage, setup: NotionSetup, map: ProjectMap): ExternalItem | null {
  if (!sameId(p.parent?.data_source_id, setup.data_source_id)) return null;
  const f = setup.fields;
  const prop = (name: string | null) => (name ? p.properties?.[name] : undefined);
  const statusV = prop(f.status);
  const statusName = (statusV?.status ?? statusV?.select)?.name ?? null;
  const notes = f.notes ? plain(prop(f.notes)?.rich_text) : "";
  const providerProject = f.project ? prop(f.project)?.select?.name?.trim() || null : null;
  const project = map.fromProvider("notion", providerProject);
  const due = f.due ? prop(f.due)?.date?.start ?? null : null;
  return {
    externalId: p.id, externalKey: pageKey(p.id), externalUrl: p.url, updatedAt: p.last_edited_time,
    fields: {
      title: plain(prop(f.title)?.title).trim(),
      notes: notes.trim() ? notes : null,
      status: statusFromNotion(statusName, setup),
      priority: f.priority ? priorityFromNotion(prop(f.priority)?.select?.name, setup) : null,
      due: due ? due.slice(0, 10) : null,
      project,
    },
    providerProject, projectUnmapped: !!providerProject && !project,
    teamKey: null,
    removed: !!(p.in_trash || p.is_archived || p.archived),
    // Fields the owner did not map: the engine never pulls them, so Harold's own values stay.
    ...(unmappedFields(setup).length ? { unmapped: unmappedFields(setup) } : {}),
    extra: { statusOption: statusName },
  };
}

/** The page properties for the given Harold fields; with `current`, only those whose mapped value differs. */
export function propertiesFor(fields: HaroldFields, setup: NotionSetup, map: ProjectMap, current?: ExternalItem): { properties: Record<string, unknown>; changed: string[] } {
  const f = setup.fields;
  const c = current?.fields;
  const props: Record<string, unknown> = {};
  const changed: string[] = [];
  if (!c || fields.title !== c.title) { props[f.title] = { title: richText(fields.title) }; if (c) changed.push("title"); }
  if (f.notes && (!c || (fields.notes || "").trim() !== (c.notes || "").trim())) {
    if (c || fields.notes) { props[f.notes] = { rich_text: richText(fields.notes || "") }; if (c) changed.push("notes"); }
  }
  if (!c || fields.status !== c.status) {
    const opt = statusOption(fields.status, setup);
    // Several Harold statuses can share one option (cancelled written as Done): only send a real change.
    const curOpt = (current?.extra as { statusOption?: string | null } | undefined)?.statusOption ?? null;
    if (opt && opt !== curOpt) {
      props[f.status] = setup.status_type === "status" ? { status: { name: opt } } : { select: { name: opt } };
      if (c) changed.push("status");
    }
  }
  if (f.due && (!c || fields.due !== c.due)) {
    if (c || fields.due) { props[f.due] = { date: fields.due ? { start: fields.due } : null }; if (c) changed.push("due"); }
  }
  if (f.priority && fields.priority !== null && (!c || fields.priority !== c.priority)) {
    const opt = setup.priority_map[fields.priority];
    // Never fill an empty Notion priority with Harold's default.
    const fillingDefault = !!c && c.priority === null && fields.priority === "medium";
    if (opt && !fillingDefault) { props[f.priority] = { select: { name: opt } }; if (c) changed.push("priority"); }
  }
  if (f.project) {
    const differs = !c ? !!fields.project
      : !(fields.project === null && current!.projectUnmapped) && (fields.project || "").toLowerCase() !== (c.project || "").toLowerCase();
    if (differs) {
      const name = map.toProvider("notion", fields.project);
      props[f.project] = { select: name ? { name } : null };
      if (c) changed.push("project");
    }
  }
  return { properties: props, changed };
}

// ───────────── setup proposal and validation ─────────────

const props = (d: DataSource) => Object.values(d.properties || {}).map(p => ({ ...p, name: p.name || "" }));
const byName = (d: DataSource, name: string) => {
  const exact = d.properties?.[name];
  if (exact) return { ...exact, name };
  return props(d).find(p => fold(p.name) === fold(name));
};
function pick(d: DataSource, types: readonly string[], re: RegExp | null, taken: Set<string>): PropertySchema | undefined {
  const c = props(d).filter(p => types.includes(p.type) && !taken.has(p.name));
  return (re ? c.find(p => re.test(p.name)) : undefined) ?? (re ? undefined : c[0]);
}
const optionsOf = (p: PropertySchema | undefined): SelectOption[] => (p?.status?.options || p?.select?.options || []);

const STATUS_WORDS: Record<Status, RegExp> = {
  pending: /not started|to.?do|backlog|todo|open|planned|next|inbox/i,
  in_progress: /progress|doing|started|active|working/i,
  completed: /done|complete|finished|closed|shipped/i,
  cancelled: /cancel|won.?t|abandon|dropped|archived|declined/i,
};
const PRIORITY_WORDS: Record<Priority, RegExp> = {
  high: /high|urgent|critical|p0|p1|asap/i, medium: /medium|normal|mid|p2/i, low: /low|minor|p3|p4|someday/i,
};

function groupOf(p: PropertySchema, optionName: string): StatusGroup | null {
  const opt = p.status?.options.find(o => o.name === optionName);
  if (!opt) return null;
  const g = p.status?.groups.find(gr => gr.option_ids.includes(opt.id || ""));
  if (!g) return null;
  const n = fold(g.name);
  return n.startsWith("complete") ? "complete" : n.includes("progress") ? "in_progress" : "todo";
}
const GROUP_STATUS: Record<StatusGroup, Status> = { todo: "pending", in_progress: "in_progress", complete: "completed" };

/** Proposes which option means each Harold status. */
export function proposeStatusMap(p: PropertySchema): Record<Status, string | null> {
  const opts = optionsOf(p).map(o => o.name);
  const out: Record<Status, string | null> = { pending: null, in_progress: null, completed: null, cancelled: null };
  const used = new Set<string>();
  const take = (s: Status, cands: string[]) => {
    const n = cands.find(o => !used.has(o) && STATUS_WORDS[s].test(o)) ?? null;
    if (n) { out[s] = n; used.add(n); }
  };
  if (p.type === "status") {
    const inGroup = (g: StatusGroup) => opts.filter(o => groupOf(p, o) === g);
    take("cancelled", opts);
    take("completed", inGroup("complete"));
    if (!out.completed) { const first = inGroup("complete").find(o => !used.has(o)); if (first) { out.completed = first; used.add(first); } }
    const todo = inGroup("todo");
    const def = p.status?.default_option && todo.includes(p.status.default_option) ? p.status.default_option : null;
    if (def) { out.pending = def; used.add(def); } else take("pending", todo);
    if (!out.pending) { const first = todo.find(o => !used.has(o)); if (first) { out.pending = first; used.add(first); } }
    take("in_progress", inGroup("in_progress"));
    if (!out.in_progress) { const first = inGroup("in_progress").find(o => !used.has(o)); if (first) { out.in_progress = first; used.add(first); } }
  } else {
    for (const s of ["cancelled", "completed", "in_progress", "pending"] as Status[]) take(s, opts);
  }
  return out;
}

/** Every option -> the Harold status it reads as (mapped options first, then Status groups, else pending). */
export function statusInFor(p: PropertySchema, statusMap: Record<Status, string | null>): Record<string, Status> {
  const out: Record<string, Status> = {};
  for (const o of optionsOf(p)) {
    const mapped = (STATUSES as readonly Status[]).find(s => statusMap[s] === o.name);
    const g = p.type === "status" ? groupOf(p, o.name) : null;
    out[o.name] = mapped ?? (g ? GROUP_STATUS[g] : "pending");
  }
  return out;
}

/** Option names Harold writes into a priority select that has no options yet: Notion adds an option on first write
 *  (checked live 2026-11-18: writing an unknown select name creates the option). */
export const NEW_PRIORITY_OPTIONS: Record<Priority, string> = { high: "High", medium: "Medium", low: "Low" };
const emptySelect = (p: PropertySchema | undefined) => !!p && p.type === "select" && optionsOf(p).length === 0;

export function proposePriorityMap(p: PropertySchema | undefined): Record<Priority, string | null> {
  const out: Record<Priority, string | null> = { high: null, medium: null, low: null };
  if (emptySelect(p)) return { ...NEW_PRIORITY_OPTIONS };
  const opts = optionsOf(p).map(o => o.name);
  for (const pr of PRIORITIES) out[pr] = opts.find(o => fold(o) === pr) ?? opts.find(o => PRIORITY_WORDS[pr].test(o)) ?? null;
  return out;
}

export function priorityInFor(p: PropertySchema | undefined, m: Record<Priority, string | null>): Record<string, Priority> {
  const out: Record<string, Priority> = {};
  // A select with no options yet: the names Harold will write (Notion creates them) read back as their priority.
  if (emptySelect(p)) for (const pr of PRIORITIES) if (m[pr]) out[m[pr]!] = pr;
  for (const o of optionsOf(p)) {
    const mapped = PRIORITIES.find(pr => m[pr] === o.name) ?? PRIORITIES.find(pr => PRIORITY_WORDS[pr].test(o.name));
    if (mapped) out[o.name] = mapped;
  }
  return out;
}

/** Which property would hold each field, guessed from the types and names. */
export function proposeFields(d: DataSource): Record<SetupField, string | null> {
  const taken = new Set<string>();
  const use = (p: PropertySchema | undefined) => { if (p) taken.add(p.name); return p?.name ?? null; };
  const title = use(pick(d, ["title"], null, taken));
  const status = use(pick(d, ["status"], /status|state|stage/i, taken) ?? pick(d, ["status"], null, taken) ?? pick(d, ["select"], /status|state|stage/i, taken));
  const due = use(pick(d, ["date"], /due|deadline|by when|date/i, taken) ?? (props(d).filter(p => p.type === "date" && !taken.has(p.name)).length === 1 ? pick(d, ["date"], null, taken) : undefined));
  const priority = use(pick(d, ["select"], /priorit/i, taken));
  const notes = use(pick(d, ["rich_text"], /note|description|details|summary/i, taken));
  const project = use(pick(d, ["select"], /project|area/i, taken));
  return { title, status, due, priority, notes, project };
}

export interface SetupOverrides {
  fields?: Partial<Record<SetupField, string | null>>;
  status_map?: Partial<Record<Status, string | null>>;
  priority_map?: Partial<Record<Priority, string | null>>;
}

/** The proposed setup for a data source with the owner's overrides, and every problem found. */
export function buildSetup(d: DataSource, databaseId: string, o: SetupOverrides = {}, now: () => number = Date.now): { setup: NotionSetup | null; problems: string[]; notes: string[] } {
  const problems: string[] = [];
  const notes: string[] = [];
  const guess = proposeFields(d);
  const chosen: Record<SetupField, string | null> = { ...guess };
  const resolved: Partial<Record<SetupField, PropertySchema>> = {};
  for (const k of SETUP_FIELDS) {
    if (o.fields && k in o.fields) {
      const v = o.fields[k];
      chosen[k] = v === null || v === undefined || ["", "none"].includes(fold(v)) ? null : v;
    }
    const name = chosen[k];
    if (!name) continue;
    const p = byName(d, name);
    if (!p) { problems.push(`There is no property called "${name}" in ${dataSourceName(d)} (for ${k}).`); continue; }
    if (!FIELD_TYPES[k].includes(p.type)) { problems.push(`"${p.name}" is a ${p.type} property; ${k} needs a ${FIELD_TYPES[k].join(" or ")} property.`); continue; }
    chosen[k] = p.name; resolved[k] = p;
  }
  if (!chosen.title) problems.push("No title property was found.");
  if (!chosen.status) problems.push(`No Status or Select property was found for the status. Name one with fields.status.`);
  const names = SETUP_FIELDS.map(k => chosen[k]).filter(Boolean) as string[];
  const dup = names.find((n, i) => names.indexOf(n) !== i);
  if (dup) problems.push(`"${dup}" is chosen for two fields; each property can hold only one.`);

  const statusP = resolved.status;
  const statusMap: Record<Status, string | null> = statusP ? proposeStatusMap(statusP) : { pending: null, in_progress: null, completed: null, cancelled: null };
  if (statusP) {
    const opts = optionsOf(statusP).map(x => x.name);
    for (const [k, v] of Object.entries(o.status_map || {}) as [Status, string | null | undefined][]) {
      if (!(STATUSES as readonly string[]).includes(k)) { problems.push(`"${k}" is not a Harold status (pending, in_progress, completed, cancelled).`); continue; }
      if (v === null || v === undefined || ["", "none"].includes(fold(v))) { statusMap[k] = null; continue; }
      const hit = opts.find(x => fold(x) === fold(v));
      if (!hit) problems.push(`"${v}" is not an option of ${statusP.name} (options: ${opts.join(", ") || "none"}).`);
      else statusMap[k] = hit;
    }
    if (!statusMap.pending) problems.push(`No option of ${statusP.name} was chosen for "pending" (to do). Name one with status_map.pending.`);
    if (!statusMap.completed) problems.push(`No option of ${statusP.name} was chosen for "completed" (done). Name one with status_map.completed.`);
    if (!statusMap.in_progress) notes.push(`No option means "in progress": a Harold task in progress is written as "${statusMap.pending ?? "the to-do option"}".`);
    if (!statusMap.cancelled) notes.push(`No option means "cancelled": a cancelled Harold task is written as "${statusMap.completed ?? "the done option"}", and reads back as completed.`);
  }
  const priorityP = resolved.priority;
  const priorityMap = proposePriorityMap(priorityP);
  if (priorityP) {
    const opts = optionsOf(priorityP).map(x => x.name);
    for (const [k, v] of Object.entries(o.priority_map || {}) as [Priority, string | null | undefined][]) {
      if (!(PRIORITIES as readonly string[]).includes(k)) { problems.push(`"${k}" is not a Harold priority (high, medium, low).`); continue; }
      if (v === null || v === undefined || ["", "none"].includes(fold(v))) { priorityMap[k] = null; continue; }
      const hit = opts.find(x => fold(x) === fold(v));
      if (hit) priorityMap[k] = hit;
      else if (!opts.length) priorityMap[k] = v.trim(); // no options yet: Notion creates the named one on first write
      else problems.push(`"${v}" is not an option of ${priorityP.name} (options: ${opts.join(", ")}).`);
    }
    if (!opts.length) notes.push(`${priorityP.name} has no options yet: Harold writes ${PRIORITIES.filter(pr => priorityMap[pr]).map(pr => `"${priorityMap[pr]}"`).join(", ")}, and Notion adds each option the first time it is written.`);
    const missing = PRIORITIES.filter(pr => !priorityMap[pr]);
    if (missing.length) notes.push(`No ${priorityP.name} option was found for ${missing.join(" and ")}: Harold leaves the priority as it is in Notion for those.`);
  }
  if (!chosen.notes) notes.push("No text property for notes: notes are not synced (the page body is never read or written).");
  if (!chosen.due) notes.push("No date property: due dates are not synced.");
  if (!chosen.priority) notes.push("No priority property: priorities are not synced.");
  if (!chosen.project) notes.push("No project property: projects are not synced.");
  if (problems.length) return { setup: null, problems, notes };
  return {
    setup: {
      database_id: databaseId, data_source_id: d.id, name: dataSourceName(d),
      fields: { title: chosen.title!, status: chosen.status!, due: chosen.due, priority: chosen.priority, notes: chosen.notes, project: chosen.project },
      status_type: statusP!.type === "status" ? "status" : "select",
      status_map: statusMap, status_in: statusInFor(statusP!, statusMap),
      priority_map: priorityMap, priority_in: priorityInFor(priorityP, priorityMap),
      saved_at: new Date(now()).toISOString(),
    },
    problems, notes,
  };
}

const HAROLD_STATUS_WORDS: Record<Status, string> = { pending: "to do (pending)", in_progress: "in progress", completed: "done (completed)", cancelled: "cancelled" };

/** The setup in plain English, for the owner to confirm. */
export function describeSetup(s: NotionSetup): string {
  const f = s.fields;
  const lines = [
    `Database: ${s.name} (data source ${s.data_source_id}, database ${s.database_id}).`,
    `- Task title: the "${f.title}" property.`,
    `- Status: the "${f.status}" ${s.status_type === "status" ? "Status" : "Select"} property.`,
    ...STATUSES.map(st => `    Harold "${HAROLD_STATUS_WORDS[st]}" is written as: ${s.status_map[st] ? `"${s.status_map[st]}"` : `"${statusOption(st, s) ?? "?"}" (no option of its own)`}`),
    `    Reading from Notion: ${Object.entries(s.status_in).map(([o, st]) => `"${o}" = ${st.replace("_", " ")}`).join("; ") || "no options"}; any other option = pending.`,
    `- Due date: ${f.due ? `the "${f.due}" date property (the day only).` : "not synced."}`,
    `- Priority: ${f.priority ? `the "${f.priority}" property (${PRIORITIES.map(p => `${p} = ${s.priority_map[p] ? `"${s.priority_map[p]}"` : "none"}`).join(", ")}).` : "not synced."}`,
    `- Notes: ${f.notes ? `the "${f.notes}" text property, as plain text.` : "not synced (no text property chosen; the page body is never used)."}`,
    `- Project: ${f.project ? `the "${f.project}" select property, matched to harold/projects.md by notion_project:, else by name or alias.` : "not synced."}`,
  ];
  return lines.join("\n");
}

// ───────────── webhook ─────────────

/** sha256=<hex HMAC-SHA256 of the raw body keyed with the verification token>, compared in constant time. */
export function notionSignatureOk(rawBody: string, header: string | null, token: string): boolean {
  if (!header || !token) return false;
  const m = header.trim().match(/^sha256=([0-9a-f]{64})$/i);
  if (!m) return false;
  const want = createHmac("sha256", token).update(rawBody, "utf8").digest();
  const got = Buffer.from(m[1], "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}

const EVENT_ACTIONS: Record<string, WebhookAction> = {
  "page.created": "create", "page.properties_updated": "update", "page.content_updated": "update",
  "page.undeleted": "update", "page.moved": "update", "page.deleted": "remove",
};

interface NotionEvent {
  type?: string; timestamp?: string; entity?: { id?: string; type?: string };
  data?: { parent?: { id?: string; type?: string; data_source_id?: string } };
}

/** The events of a signed delivery that concern the configured data source (a parent naming another one is dropped). */
export function notionEvents(rawBody: string, setup: NotionSetup | null): VerifyResult {
  let e: NotionEvent;
  try { e = JSON.parse(rawBody); } catch { return { ok: false, status: 400, reason: "body is not JSON" }; }
  const action = EVENT_ACTIONS[e.type || ""];
  const id = e.entity?.type === "page" ? e.entity.id : undefined;
  if (!action || typeof id !== "string") return { ok: true, events: [] };
  const parent = e.data?.parent;
  if (setup && parent) {
    if (parent.data_source_id && !sameId(parent.data_source_id, setup.data_source_id)) return { ok: true, events: [] };
    if (!parent.data_source_id && ["database", "database_id"].includes(parent.type || "") && parent.id && !sameId(parent.id, setup.database_id)) return { ok: true, events: [] };
  }
  const ev: WebhookEvent = { action, externalId: id, updatedAt: e.timestamp ?? null, teamKey: null };
  return { ok: true, events: [ev] };
}

/** True when the body is Notion's one-time verification request: {"verification_token": "..."} and nothing else. */
/** The token of Notion's one-time verification request: a body with a verification_token and none of an event's fields
 *  (other fields Notion may add are allowed). The request is only accepted while the owner expects one. */
export function verificationToken(rawBody: string): string | null {
  try {
    const b = JSON.parse(rawBody) as Record<string, unknown>;
    if (b && typeof b === "object" && typeof b.verification_token === "string" && !("type" in b) && !("entity" in b) && b.verification_token.length >= 8 && b.verification_token.length <= 500) return b.verification_token;
  } catch { /* not JSON */ }
  return null;
}

/**
 * The whole of /webhooks/notion's check. The verification request is accepted (and its token stored) only while the
 * owner expects one; a signed event is checked with NOTION_WEBHOOK_SECRET, else the stored token.
 */
export async function verifyNotionWebhook(rawBody: string, header: string | null, cfg: NotionSyncConfig, ctx: WebhookContext | undefined, now: number): Promise<VerifyResult> {
  const store = () => ctx?.store() ?? null;
  // The verification request is recognised by its body (it carries verification_token), signed or not: Notion signs
  // it too, but with nothing stored yet there is no secret to check that signature against.
  const token = verificationToken(rawBody);
  if (token || !header) {
    if (!token) return { ok: false, status: 401, reason: "missing X-Notion-Signature" };
    const st = store();
    if (!st) return { ok: false, status: 503, reason: "Supabase is not configured, so the verification token cannot be kept" };
    const { webhook } = await loadNotionState(st);
    const until = Date.parse(webhook.expect_until || "");
    if (!Number.isFinite(until) || until < now) {
      return { ok: false, status: 403, reason: "no verification token is expected: ask Harold to expect the Notion webhook (sync_setup_notion), then press Resend token in Notion" };
    }
    await patchNotionState(st, { webhook: { token, received_at: new Date(now).toISOString() } });
    return { ok: true, events: [] };
  }
  let secret = cfg.webhookSecret;
  let setup: NotionSetup | null = null;
  const st = store();
  if (!secret) {
    if (!st) return { ok: false, status: 503, reason: "NOTION_WEBHOOK_SECRET is not set and Supabase is not configured" };
    const s = await loadNotionState(st);
    secret = s.webhook.token || "";
    setup = s.setup;
    if (!secret) return { ok: false, status: 503, reason: "no Notion webhook token yet (NOTION_WEBHOOK_SECRET is not set and none was received)" };
  }
  if (!notionSignatureOk(rawBody, header, secret)) return { ok: false, status: 401, reason: "bad signature" };
  if (!setup && st) setup = (await loadNotionState(st)).setup; // only after the signature checked out
  return notionEvents(rawBody, setup);
}

// ───────────── API ─────────────

/** An error answer from Notion; `status` lets the engine tell a refused request (4xx) from a failed one. */
export class NotionError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); }
}

export class NotionClient {
  constructor(private token: string, private fetchImpl: FetchLike) {}
  async call<T>(method: "GET" | "POST" | "PATCH", path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { Authorization: `Bearer ${this.token}`, "Notion-Version": NOTION_VERSION };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const r = await this.fetchImpl(NOTION_API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    let j: unknown = null;
    try { j = await r.json(); } catch { /* not JSON */ }
    if (!r.ok) {
      const e = (j || {}) as { code?: string; message?: string };
      throw new NotionError(`Notion answered HTTP ${r.status}${e.code ? ` ${e.code}` : ""}${e.message ? `: ${e.message}` : ""} (${method} ${path})`, r.status, e.code);
    }
    return j as T;
  }
  /** Every result of a paginated POST (query or search). */
  async all<T>(path: string, body: Record<string, unknown>): Promise<T[]> {
    const out: T[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const d = await this.call<{ results: T[]; has_more?: boolean; next_cursor?: string | null }>("POST", path, { ...body, page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) });
      out.push(...(d.results || []));
      if (!d.has_more || !d.next_cursor) break;
      cursor = d.next_cursor;
    }
    return out;
  }
  dataSources() { return this.all<DataSource>("/search", { filter: { property: "object", value: "data_source" } }); }
  dataSource(id: string) { return this.call<DataSource>("GET", `/data_sources/${encodeURIComponent(id)}`); }
  database(id: string) { return this.call<{ object: "database"; id: string; title?: RichText[]; data_sources?: { id: string; name: string }[] }>("GET", `/databases/${encodeURIComponent(id)}`); }
}

// ───────────── provider ─────────────

/** Notion in the provider registry. Its setup lives in the database, so `prepare` loads it before `build`. */
export function notionEntry(cfg: NotionSyncConfig, fetchImpl: FetchLike, now: () => number = Date.now): ProviderEntry {
  let setup: NotionSetup | null = null;
  return {
    name: "notion", scope: null,
    verifyWebhook: (req, raw, ctx) => verifyNotionWebhook(raw, req.headers.get("x-notion-signature"), cfg, ctx, now()),
    prepare: async st => {
      setup = (await loadNotionState(st)).setup;
      return setup ? null : "Notion is connected (NOTION_TOKEN) but not set up yet: ask Harold to set up the Notion task sync (sync_setup_notion) to choose the database and map its fields";
    },
    build: map => {
      if (!setup) throw new Error("Notion is not set up (sync_setup_notion)");
      return new NotionProvider(cfg, setup, map, fetchImpl, now);
    },
  };
}

export class NotionProvider implements SyncProvider {
  readonly name = "notion";
  readonly displayName = "Notion";
  readonly itemNoun = "page";
  readonly callerChosenIds = false;
  readonly coarseTimestamps = true;
  private api: NotionClient;
  constructor(private cfg: NotionSyncConfig, private setup: NotionSetup, private map: ProjectMap, fetchImpl: FetchLike, private now: () => number = Date.now) {
    this.api = new NotionClient(cfg.token, fetchImpl);
  }

  async verifyWebhook(req: Request, rawBody: string, ctx?: WebhookContext): Promise<VerifyResult> {
    return verifyNotionWebhook(rawBody, req.headers.get("x-notion-signature"), this.cfg, ctx, this.now());
  }

  private get queryPath() { return `/data_sources/${encodeURIComponent(this.setup.data_source_id)}/query`; }

  private items(pages: NotionPage[]): ExternalItem[] {
    return pages.map(p => pageToItem(p, this.setup, this.map)).filter((x): x is ExternalItem => !!x);
  }

  async listChangedSince(cursor: string): Promise<ExternalItem[]> {
    const from = new Date(Date.parse(cursor) - CURSOR_OVERLAP_MS).toISOString();
    const pages = await this.api.all<NotionPage>(this.queryPath, {
      filter: { timestamp: "last_edited_time", last_edited_time: { on_or_after: from } },
      sorts: [{ timestamp: "last_edited_time", direction: "ascending" }],
    });
    return this.items(pages);
  }

  /** Every open page, plus finished ones edited within the window (Notion keeps no completion date). */
  async listForImport(completedWithinDays: number): Promise<ExternalItem[]> {
    const since = this.now() - completedWithinDays * 86_400_000;
    const pages = await this.api.all<NotionPage>(this.queryPath, { sorts: [{ timestamp: "last_edited_time", direction: "ascending" }] });
    return this.items(pages).filter(i => !i.removed && (i.fields.status === "pending" || i.fields.status === "in_progress" || Date.parse(i.updatedAt) >= since));
  }

  async getOne(externalId: string): Promise<ExternalItem | null> {
    let p: NotionPage;
    try { p = await this.api.call<NotionPage>("GET", `/pages/${encodeURIComponent(externalId)}`); }
    catch (e) { if (e instanceof NotionError && (e.status === 404 || e.status === 400)) return null; throw e; }
    return pageToItem(p, this.setup, this.map);
  }

  /** A page with this title created since the engine's placeholder was made: the result of an earlier attempt. */
  private async earlierCreate(title: string, externalId: string): Promise<ExternalItem | null> {
    const m = externalId.match(/^pending:(\d+):/);
    if (!m) return null;
    const since = new Date(Number(m[1]) - CURSOR_OVERLAP_MS).toISOString();
    const d = await this.api.call<{ results: NotionPage[] }>("POST", this.queryPath, {
      filter: { and: [
        { timestamp: "created_time", created_time: { on_or_after: since } },
        { property: this.setup.fields.title, title: { equals: title } },
      ] },
      sorts: [{ timestamp: "created_time", direction: "ascending" }],
      page_size: 5,
    });
    const hit = this.items(d.results || []).find(i => !i.removed && i.fields.title === title.trim());
    return hit ?? null;
  }

  async create(fields: HaroldFields, externalId: string): Promise<ExternalItem> {
    const earlier = await this.earlierCreate(fields.title, externalId);
    if (earlier) return earlier;
    const { properties } = propertiesFor(fields, this.setup, this.map);
    const p = await this.api.call<NotionPage>("POST", "/pages", { parent: { type: "data_source_id", data_source_id: this.setup.data_source_id }, properties });
    const item = pageToItem(p, this.setup, this.map);
    if (!item) throw new NotionError(`Notion created page ${p.id} outside the configured data source`, 500);
    return item;
  }

  async update(current: ExternalItem, fields: HaroldFields): Promise<{ item: ExternalItem; changed: string[] }> {
    const { properties, changed } = propertiesFor(fields, this.setup, this.map, current);
    if (!changed.length) return { item: current, changed: [] };
    const p = await this.api.call<NotionPage>("PATCH", `/pages/${encodeURIComponent(current.externalId)}`, { properties });
    const item = pageToItem(p, this.setup, this.map);
    if (!item) throw new NotionError(`Notion page ${current.externalId} is no longer in ${this.setup.name}`, 500);
    return { item, changed };
  }
}
