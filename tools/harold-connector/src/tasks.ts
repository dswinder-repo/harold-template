// Harold's own task list, for task_list, task_create, task_update and crm_task: the Supabase `tasks` table.
// Every task has a short ref (H-12, set by the database), an optional canonical project (from harold/projects.md),
// an optional contact, and optional links to the same work in outside tools (task_links: provider, external key
// such as ENG-123, URL). `source` (default 'harold' = first created in Harold) and `changed_by` (a database trigger) are
// never written here.
//
// Tolerates the old schema: before the task-list migration is applied the table has no ref / project / source
// column and no task_links table. A select or write that fails with a missing-column (or missing-table) error is
// retried with the old column set, so production works before and after the migration.
//
// Without SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY the tools say plainly that Harold's task list is not configured.

import { resolveContact, type Sb } from "./crm.js";
import { rankProjects, type Project } from "./projects.js";
import { secretScan } from "./text.js";

export interface TaskResult { text: string; isError?: boolean; person?: { name: string } }
export type ProjectsLoader = () => Promise<Project[]>;

export const NOT_CONFIGURED: TaskResult = {
  text: "Harold's task list is not configured on this connector (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set), so no task was created, read or changed. "
    + "List the commitment in the note's Action items with \"(no task: Harold's task list is not configured)\" so a workspace session can create it.",
  isError: true,
};

export const PRIORITIES = ["urgent", "high", "medium", "low"] as const;
export type Priority = typeof PRIORITIES[number];
/** The table's priorities are high | medium | low; "urgent" (kept for older callers) is stored as high. */
const dbPriority = (p: Priority): string => (p === "urgent" ? "high" : p);

const OPEN = ["pending", "in_progress"];
const err = (text: string): TaskResult => ({ text, isError: true });

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Reply = { data: unknown; error: { message: string } | null };

const NEW_COLS = "id, ref, title, description, project, source, status, priority, due_date, completed_at, contact_id, created_at, updated_at";
const OLD_COLS = "id, title, description, status, priority, due_date, completed_at, contact_id, created_at, updated_at";

const likeEsc = (s: string) => s.replace(/[\\%_]/g, m => `\\${m}`);
const isMissingColumn = (m: string) => /column .*does not exist|could not find the '[^']+' column|PGRST204|42703/i.test(m);
const isMissingTable = (m: string) => /relation .*does not exist|could not find the table|PGRST205|42P01/i.test(m);
const isMissingSchema = (m: string) => isMissingColumn(m) || isMissingTable(m);

/** Run a query with the new column set, and again with the old one when the migration is not applied yet. */
async function tryCols(run: (cols: string, migrated: boolean) => PromiseLike<Reply>): Promise<{ data: Row[] | Row | null; error: string | null; migrated: boolean }> {
  let r = await run(NEW_COLS, true);
  let migrated = true;
  if (r.error && isMissingSchema(r.error.message)) { r = await run(OLD_COLS, false); migrated = false; }
  return { data: (r.data as Row[] | Row | null) ?? null, error: r.error ? r.error.message : null, migrated };
}

// ───────────── states, links, display ─────────────

const STATE_WORDS: Record<string, { status: string; label: string }> = {
  todo: { status: "pending", label: "pending" }, pending: { status: "pending", label: "pending" }, open: { status: "pending", label: "pending" }, reopen: { status: "pending", label: "pending" },
  start: { status: "in_progress", label: "in progress" }, started: { status: "in_progress", label: "in progress" }, "in progress": { status: "in_progress", label: "in progress" }, in_progress: { status: "in_progress", label: "in progress" }, doing: { status: "in_progress", label: "in progress" },
  done: { status: "completed", label: "done" }, complete: { status: "completed", label: "done" }, completed: { status: "completed", label: "done" },
  cancel: { status: "cancelled", label: "cancelled" }, cancelled: { status: "cancelled", label: "cancelled" }, canceled: { status: "cancelled", label: "cancelled" },
};
const STATE_LABEL: Record<string, string> = { pending: "pending", in_progress: "in progress", completed: "done", cancelled: "cancelled" };
const stateLabel = (s?: string) => STATE_LABEL[s || ""] || s || "?";

interface Link { task_id: string; provider?: string; external_id?: string; external_key?: string; external_url?: string }

async function linksFor(sb: Sb, ids: string[]): Promise<Map<string, Link[]>> {
  const m = new Map<string, Link[]>();
  if (!ids.length) return m;
  const { data, error } = await sb.from("task_links").select("task_id, provider, external_id, external_key, external_url").in("task_id", ids);
  if (error) return m; // no task_links table yet, or unreadable: the list still works without outside keys
  for (const l of (data || []) as unknown as Link[]) m.set(l.task_id, [...(m.get(l.task_id) || []), l]);
  return m;
}
const linkText = (ls?: Link[]) => (ls || []).map(l => [l.external_key || l.external_id, l.external_url].filter(Boolean).join(" ")).filter(Boolean).join("; ");

const ref = (t: Row) => String(t.ref || shortId(t.id));
/** due_date is timestamptz stored as UTC midnight (send "YYYY-MM-DD"); read as the first 10 characters, no zone conversion. */
const when = (d?: string | null) => (d ? String(d).slice(0, 10) : "none");
/** The id shown where there is no ref (old schema): its first 8 characters. */
const shortId = (id: string) => String(id).slice(0, 8);

function line(t: Row, links: Map<string, Link[]>, contacts: Map<string, string>): string {
  const outside = linkText(links.get(t.id));
  const parts = [ref(t), t.title, t.project || "no project", t.contact_id ? contacts.get(t.contact_id) || "contact" : "no contact", stateLabel(t.status), `due ${when(t.due_date)}`, t.priority || "no priority"];
  return `- ${parts.join(" · ")}${outside ? `\n  outside: ${outside}` : ""}`;
}

async function contactNames(sb: Sb, rows: Row[]): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  const ids = [...new Set(rows.map(r => r.contact_id).filter(Boolean))] as string[];
  if (!ids.length) return m;
  const { data } = await sb.from("contacts").select("id, name").in("id", ids);
  for (const c of (data || []) as unknown as Row[]) m.set(c.id, c.name);
  return m;
}

const byDue = (a: Row, b: Row) => (a.due_date ? 0 : 1) - (b.due_date ? 0 : 1) || String(a.due_date || "").localeCompare(String(b.due_date || "")) || String(a.created_at || "").localeCompare(String(b.created_at || ""));

// ───────────── projects ─────────────

/** The canonical project name for what the owner called it, or an error listing close matches. */
type Proj = { name: string; error?: undefined } | { error: TaskResult; name?: undefined };
async function resolveProject(load: ProjectsLoader, want: string): Promise<Proj> {
  const projects = await load();
  if (!projects.length) return { error: err("harold/projects.md has no projects (or could not be read), so the project cannot be checked. Leave project out or try again.") };
  const ranked = rankProjects(projects, want);
  const [top, second] = ranked;
  if (top && (top.s >= 100 || (top.s >= 40 && (!second || top.s - second.s >= 20)))) return { name: top.p.name };
  const close = ranked.slice(0, 5).map(x => x.p.name);
  const list = close.length ? `Close matches: ${close.join(", ")}.` : `Active projects: ${projects.filter(p => p.status === "active").map(p => p.name).join(", ") || projects.map(p => p.name).join(", ")}.`;
  return { error: err(`No project matches "${want}" in harold/projects.md. ${list} Pass one of these names (harold_where finds it), or leave project out.`) };
}

// ───────────── finding one task ─────────────

type Found = { row: Row; migrated: boolean } | { error: TaskResult };

async function selectTask(sb: Sb, col: string, val: string): Promise<{ row: Row | null; migrated: boolean; error: string | null }> {
  const r = await tryCols((cols) => sb.from("tasks").select(cols).eq(col, val).limit(2) as unknown as PromiseLike<Reply>);
  if (r.error) return { row: null, migrated: r.migrated, error: r.error };
  return { row: ((r.data as Row[]) || [])[0] || null, migrated: r.migrated, error: null };
}

/** By ref (H-12), by outside key (ENG-123, through task_links) or by uuid. */
async function findTask(sb: Sb, ident: string): Promise<Found> {
  const id = ident.trim();
  if (/^H-\d+$/i.test(id)) {
    const r = await selectTask(sb, "ref", id.toUpperCase());
    if (r.error) return { error: err(isMissingColumn(r.error) ? `Task refs (${id}) need the task-list migration, which is not applied yet. Use the task's id instead.` : `Task error: ${r.error}`) };
    return r.row ? { row: r.row, migrated: r.migrated } : { error: err(`No task ${id.toUpperCase()}. task_list shows the open tasks.`) };
  }
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    const r = await selectTask(sb, "id", id);
    if (r.error) return { error: err(`Task error: ${r.error}`) };
    return r.row ? { row: r.row, migrated: r.migrated } : { error: err(`No task with id ${id}.`) };
  }
  if (/^[0-9a-f]{8}$/i.test(id)) { // the short id shown before the migration: match it against the ids
    const { data, error } = await sb.from("tasks").select("id").limit(1000);
    if (error) return { error: err(`Task error: ${error.message}`) };
    const hits = ((data || []) as unknown as Row[]).filter(r => String(r.id).toLowerCase().startsWith(id.toLowerCase()));
    if (hits.length !== 1) return { error: err(hits.length ? `${id} matches more than one task; use the full id.` : `No task with id ${id}.`) };
    const r = await selectTask(sb, "id", hits[0].id);
    return r.row ? { row: r.row, migrated: r.migrated } : { error: err(`No task with id ${id}.`) };
  }
  if (/^[A-Za-z][A-Za-z0-9]*-\d{1,9}$/.test(id)) {
    const key = id.toUpperCase();
    const { data, error } = await sb.from("task_links").select("task_id, provider, external_key").eq("external_key", key);
    if (error) return { error: err(isMissingSchema(error.message) ? `Outside keys (${key}) need the task-list migration, which is not applied yet. Use the task's id instead.` : `Task error: ${error.message}`) };
    const hits = (data || []) as unknown as Link[];
    if (!hits.length) return { error: err(`No task is linked to ${key}. task_list shows the open tasks with their outside keys.`) };
    const ids = [...new Set(hits.map(h => h.task_id))];
    if (ids.length > 1) return { error: err(`${key} is linked to more than one task (${ids.join(", ")}); update by ref instead.`) };
    const r = await selectTask(sb, "id", ids[0]);
    if (r.error) return { error: err(`Task error: ${r.error}`) };
    return r.row ? { row: r.row, migrated: r.migrated } : { error: err(`${key} is linked to a task that no longer exists.`) };
  }
  return { error: err(`task must be a ref like H-12, an outside key like ENG-123, or a task id (full, or its first 8 characters), got "${ident}"`) };
}

// ───────────── task_list ─────────────

export interface ListArgs { query?: string; project?: string; include_done?: boolean; limit?: number; contact_id?: string; contact_name?: string; org?: string }

export async function listTasks(sb: Sb | null, load: ProjectsLoader | null, a: ListArgs): Promise<TaskResult> {
  if (!sb) return NOT_CONFIGURED;
  let contactId = a.contact_id, contactName = "";
  if (!contactId && a.contact_name) {
    const r = await resolveContact(sb, a.contact_name, a.org);
    if ("error" in r) return r.error;
    contactId = r.id; contactName = r.name;
  }
  let project: string | undefined;
  if (a.project?.trim()) {
    if (!load) return err("Projects are not available to check the project filter.");
    const p = await resolveProject(load, a.project.trim());
    if (p.error) return p.error;
    project = p.name;
  }
  const q = a.query?.trim();
  const r = await tryCols((cols, migrated) => {
    let b = sb.from("tasks").select(cols);
    if (!a.include_done) b = b.in("status", OPEN);
    if (contactId) b = b.eq("contact_id", contactId);
    if (project && migrated) b = b.eq("project", project);
    if (q) { const e = likeEsc(q).replace(/["\\,()]/g, " "); b = b.or(`title.ilike."%${e}%",description.ilike."%${e}%"`); }
    return b.order("due_date", { ascending: true, nullsFirst: false }).limit(Math.min(a.limit ?? 50, 100)) as unknown as PromiseLike<Reply>;
  });
  if (r.error) return err(`Task error: ${r.error}`);
  const rows = ((r.data as Row[]) || []).sort(byDue);
  const what = [q ? `matching "${q}"` : "", project ? `in ${project}` : "", contactName ? `for ${contactName}` : ""].filter(Boolean).join(" ");
  const old = r.migrated ? "" : "\n(Harold's task list migration is not applied yet: no refs, projects or outside keys. Tasks are shown by id.)";
  if (project && !r.migrated) return err(`Cannot filter by project: tasks have no project column until the task-list migration is applied.`);
  if (!rows.length) return { text: `No ${a.include_done ? "" : "open "}tasks${what ? " " + what : ""}.${old}` };
  const [links, names] = await Promise.all([r.migrated ? linksFor(sb, rows.map(x => x.id)) : Promise.resolve(new Map<string, Link[]>()), contactNames(sb, rows)]);
  return { text: `${a.include_done ? "Tasks" : "Open tasks"}${what ? " " + what : ""} (${rows.length}, by due date):\n${rows.map(t => line(t, links, names)).join("\n")}${old}` };
}

// ───────────── task_create ─────────────

export interface CreateArgs { title: string; description?: string; due_date?: string; project?: string; priority?: Priority; contact_id?: string; contact_name?: string; org?: string }

export async function createTask(sb: Sb | null, load: ProjectsLoader | null, a: CreateArgs): Promise<TaskResult> {
  if (!sb) return NOT_CONFIGURED;
  const title = a.title.trim();
  if (!title) return err("title is required");
  const hit = secretScan(`${title}\n${a.description || ""}`);
  if (hit) return err(`Refused: the task looks like it contains a secret (pattern ${hit}). Secrets never go into a task; remove it and try again.`);
  if (a.due_date && !/^\d{4}-\d{2}-\d{2}$/.test(a.due_date)) return err(`due_date must be YYYY-MM-DD, got "${a.due_date}"`);

  let project: string | undefined;
  if (a.project?.trim()) {
    if (!load) return err("Projects are not available to check the project name.");
    const p = await resolveProject(load, a.project.trim());
    if (p.error) return p.error;
    project = p.name;
  }
  let contactId = a.contact_id, contactName = "";
  if (!contactId && a.contact_name) {
    const r = await resolveContact(sb, a.contact_name, a.org);
    if ("error" in r) return r.error;
    contactId = r.id; contactName = r.name;
  }

  // The same open title in the same project: return it instead of creating a duplicate.
  const same = await tryCols((cols) => sb.from("tasks").select(cols).in("status", OPEN).ilike("title", likeEsc(title)).limit(20) as unknown as PromiseLike<Reply>);
  if (same.error) return err(`Task error: ${same.error}`);
  const dup = ((same.data as Row[]) || []).find(t => !same.migrated || (t.project || null) === (project || null));
  if (dup) return { text: `Already open, not created again: ${ref(dup)} ${dup.title}${dup.project ? ` · ${dup.project}` : ""} (due ${when(dup.due_date)})` };

  const rec: Row = { title, description: a.description?.trim() || "", status: "pending", priority: dbPriority(a.priority || "medium") };
  if (a.due_date) rec.due_date = a.due_date;
  if (contactId) rec.contact_id = contactId;
  let ins = await sb.from("tasks").insert({ ...rec, ...(project ? { project } : {}) }).select(NEW_COLS).single();
  let migrated = true;
  if (ins.error && isMissingSchema(ins.error.message)) {
    migrated = false;
    ins = await sb.from("tasks").insert(rec).select(OLD_COLS).single();
  }
  if (ins.error) return err(`Task error: ${ins.error.message}`);
  const t = ins.data as unknown as Row;
  const notes: string[] = [];
  if (!migrated) notes.push(`Harold's task list migration is not applied yet: saved without ${project ? `the project "${project}", ` : ""}a ref. Its id is ${shortId(t.id)}.`);
  if (a.priority === "urgent") notes.push("Priority urgent is stored as high.");
  if (!a.due_date) notes.push("No due date: add one if the owner gave or implied one.");
  return {
    text: `Created ${ref(t)}${project && migrated ? ` in ${project}` : ""}${contactName ? ` for ${contactName}` : ""}, due ${when(t.due_date)}: ${title}${notes.length ? "\n" + notes.join("\n") : ""}`,
    person: contactName ? { name: contactName } : undefined,
  };
}

// ───────────── task_update ─────────────

export interface UpdateArgs { task: string; state?: string; title?: string; description?: string; due_date?: string; priority?: Priority; project?: string }

export async function updateTask(sb: Sb | null, load: ProjectsLoader | null, a: UpdateArgs): Promise<TaskResult> {
  if (!sb) return NOT_CONFIGURED;
  if (a.title !== undefined && !a.title.trim()) return err("title cannot be empty");
  if (a.due_date !== undefined && a.due_date !== "none" && !/^\d{4}-\d{2}-\d{2}$/.test(a.due_date)) return err(`due_date must be YYYY-MM-DD or "none" to clear it, got "${a.due_date}"`);
  const hit = secretScan(`${a.title || ""}\n${a.description || ""}`);
  if (hit) return err(`Refused: the change looks like it contains a secret (pattern ${hit}). Secrets never go into a task; remove it and try again.`);
  if ([a.state, a.title, a.description, a.due_date, a.priority, a.project].every(v => v === undefined)) return err("Nothing to change: pass at least one of state, title, description, priority, due_date or project.");
  let status: { status: string; label: string } | undefined;
  if (a.state !== undefined) {
    status = STATE_WORDS[a.state.trim().toLowerCase()];
    if (!status) return err(`State "${a.state}" is not one of: todo (pending), start (in progress), done (complete), cancel.`);
  }
  let project: string | null | undefined;
  if (a.project !== undefined) {
    if (!a.project.trim() || a.project.trim().toLowerCase() === "none") project = null;
    else {
      if (!load) return err("Projects are not available to check the project name.");
      const p = await resolveProject(load, a.project.trim());
      if (p.error) return p.error;
      project = p.name;
    }
  }

  const found = await findTask(sb, a.task);
  if ("error" in found) return found.error;
  const { row, migrated } = found;
  const patch: Row = {};
  const changes: string[] = [];
  if (status && status.status !== row.status) {
    patch.status = status.status;
    changes.push(`state ${stateLabel(row.status)} -> ${status.label}`);
  }
  if (a.title !== undefined && a.title.trim() !== row.title) { patch.title = a.title.trim(); changes.push(`title "${row.title}" -> "${patch.title}"`); }
  if (a.description !== undefined && (a.description || "") !== (row.description || "")) { patch.description = a.description; changes.push(a.description ? "description updated" : "description cleared"); }
  if (a.due_date !== undefined) {
    const want = a.due_date === "none" ? null : a.due_date;
    if (want !== (row.due_date ? when(row.due_date) : null)) { patch.due_date = want; changes.push(`due ${when(row.due_date)} -> ${want || "none"}`); }
  }
  if (a.priority !== undefined && dbPriority(a.priority) !== row.priority) { patch.priority = dbPriority(a.priority); changes.push(`priority ${row.priority || "none"} -> ${patch.priority}`); }
  if (project !== undefined) {
    if (!migrated) return err("Cannot set a project: tasks have no project column until the task-list migration is applied.");
    if (project !== (row.project || null)) { patch.project = project; changes.push(`project ${row.project || "none"} -> ${project || "none"}`); }
  }
  if (!changes.length) return { text: `${ref(row)} already says that: nothing to change.` };
  patch.updated_at = new Date().toISOString();

  const { error } = await sb.from("tasks").update(patch).eq("id", row.id).select("id").single();
  if (error) return err(`Task error: ${error.message}`);
  const links = migrated ? linkText((await linksFor(sb, [row.id])).get(row.id)) : "";
  return { text: `Updated ${ref(row)} (${row.title}): ${changes.join("; ")}.${links ? `\noutside: ${links}` : ""}${patch.status !== undefined ? "\nReversible: set the state back any time; nothing is deleted." : ""}` };
}

// ───────────── harold_today: what is overdue or due today ─────────────

/** Open tasks due today (in the owner's time zone, HAROLD_TZ) or earlier, for the morning brief. "" when the task list is not configured, unreadable or has none. */
export async function dueTodayText(sb: Sb | null, todayIso: string): Promise<string> {
  if (!sb) return "";
  try {
    const r = await tryCols((cols) => sb.from("tasks").select(cols).in("status", OPEN).not("due_date", "is", null).limit(500) as unknown as PromiseLike<Reply>);
    if (r.error) return "";
    const rows = ((r.data as Row[]) || []).filter(t => when(t.due_date) <= todayIso).sort(byDue);
    if (!rows.length) return "";
    const L = rows.map(t => `- ${ref(t)} · ${t.title} · ${t.project || "no project"} · due ${when(t.due_date)}${when(t.due_date) < todayIso ? " (overdue)" : " (today)"}`);
    return `Open tasks overdue or due today (${rows.length}):\n${L.join("\n")}`;
  } catch { return ""; }
}

// ───────────── crm_task: the same task list, contact-filtered ─────────────

export interface TaskArgs {
  action: "create" | "update" | "complete" | "cancel" | "list"; task_id?: string; contact_name?: string; contact_id?: string; org?: string;
  title?: string; description?: string; priority?: "high" | "medium" | "low"; due_date?: string; status?: "pending" | "in_progress" | "completed" | "cancelled";
}

export async function crmTask(sb: Sb | null, load: ProjectsLoader | null, a: TaskArgs): Promise<TaskResult> {
  if (!sb) return NOT_CONFIGURED;
  switch (a.action) {
    case "list": return listTasks(sb, load, { contact_id: a.contact_id, contact_name: a.contact_name, org: a.org, limit: 20 });
    case "create":
      if (!a.title) return err("title required for create");
      return createTask(sb, load, { title: a.title, description: a.description, due_date: a.due_date, priority: a.priority, contact_id: a.contact_id, contact_name: a.contact_name, org: a.org });
    case "complete": case "cancel":
      if (!a.task_id) return err(`task_id required for ${a.action}`);
      return updateTask(sb, load, { task: a.task_id, state: a.action === "complete" ? "done" : "cancel" });
    case "update":
      if (!a.task_id) return err("task_id required for update");
      return updateTask(sb, load, { task: a.task_id, state: a.status, title: a.title, description: a.description, due_date: a.due_date, priority: a.priority });
    default: return err(`Unknown action: ${(a as { action: string }).action}`);
  }
}
