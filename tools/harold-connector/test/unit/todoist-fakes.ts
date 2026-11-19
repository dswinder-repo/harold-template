// An in-memory Todoist API v1 behind a fetch mock, enough of it for the Todoist provider: /projects (paginated),
// /sync (full and incremental sync by sync_token, and commands with uuid idempotency and temp_id_mapping),
// /tasks/{id}, and /tasks/completed/by_completion_date (paginated). Objects follow the documented shapes in
// fixtures/todoist/.

import type { TodoistProject, TodoistTask } from "../../src/sync/todoist.js";
import type { Clock } from "./sync-fakes.js";
import { readFileSync } from "node:fs";

export const fixture = <T = unknown>(name: string): T => JSON.parse(readFileSync(new URL(`./fixtures/todoist/${name}`, import.meta.url), "utf8")) as T;
const taskFixture = fixture<TodoistTask>("task.json");
const tombstone = fixture<{ items: TodoistTask[] }>("sync-deleted-tombstone.json").items[0];
const projectsFixture = fixture<{ results: TodoistProject[] }>("projects-page.json");

export interface FakeTask extends TodoistTask { _v?: number }

export const TPROJECTS: TodoistProject[] = [
  ...(projectsFixture.results as TodoistProject[]),
  { id: "6Orchard0000000", name: "Orchard Labs", inbox_project: false, is_deleted: false },
  { id: "6Harold00000000", name: "Harold", inbox_project: false, is_deleted: false },
  { id: "6Random00000000", name: "Random Todoist Project", inbox_project: false, is_deleted: false },
];
export const INBOX = TPROJECTS[0].id;

export class FakeTodoist {
  tasks = new Map<string, FakeTask>();
  projects = [...TPROJECTS];
  calls: { method: string; path: string; query: Record<string, string>; form: Record<string, string> }[] = [];
  /** item_add uuids already applied, with the id they made (Todoist's command idempotency). */
  applied = new Map<string, string>();
  pageSize = 2;
  failNext: { status: number; error: string } | null = null;
  private v = 0;
  private n = 0;
  constructor(private clock: Clock) {}

  private stamp(t: FakeTask) { t._v = ++this.v; t.updated_at = this.clock.tick(); return t; }

  /** A task as the owner would make or edit it in Todoist. */
  put(t: Partial<FakeTask> & { content: string }, id = `6Td${String(++this.n).padStart(13, "0")}`): FakeTask {
    const prev = this.tasks.get(id);
    const base = { ...(taskFixture as unknown as FakeTask), labels: [], section_id: null, project_id: INBOX, description: "", priority: 1, due: null, checked: false, is_deleted: false, completed_at: null, added_at: this.clock.iso() };
    const task = this.stamp({ ...base, ...prev, ...t, id });
    this.tasks.set(id, task);
    return task;
  }
  edit(id: string, patch: Partial<FakeTask>) { return this.put({ ...this.tasks.get(id)!, ...patch }, id); }
  complete(id: string) { return this.edit(id, { checked: true, completed_at: this.clock.iso() }); }
  /** Deleted in Todoist: incremental sync then returns the tombstone recorded live (fixtures/todoist/sync-deleted-tombstone.json):
   *  content "", project_id a placeholder, updated_at null, added_at at the epoch. */
  remove(id: string) {
    const t: FakeTask = { ...(tombstone as FakeTask), id, _v: ++this.v };
    this.tasks.set(id, t);
    return t;
  }

  /** The task as the API returns it (no fake bookkeeping). */
  view(t: FakeTask): TodoistTask { const { _v, ...rest } = t; void _v; return { ...rest }; }

  fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const method = init?.method || "GET";
    const path = url.pathname.replace(/^\/api\/v1/, "");
    const query = Object.fromEntries(url.searchParams);
    const form = init?.body ? Object.fromEntries(new URLSearchParams(String(init.body))) : {};
    this.calls.push({ method, path, query, form });
    const ok = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });
    const err = (status: number, error: string) => new Response(JSON.stringify({ error, error_tag: "FAKE", http_code: status }), { status, headers: { "Content-Type": "application/json" } });
    if (new Headers(init?.headers).get("authorization") !== "Bearer td-token") return err(401, "Unauthorized");
    if (this.failNext) { const f = this.failNext; this.failNext = null; return err(f.status, f.error); }

    if (method === "GET" && path === "/projects") {
      const start = Number(query.cursor || 0), size = 2;
      const page = this.projects.slice(start, start + size);
      return ok({ results: page, next_cursor: start + size < this.projects.length ? String(start + size) : null });
    }
    if (method === "GET" && path === "/tasks/completed/by_completion_date") {
      const since = Date.parse(query.since), until = Date.parse(query.until);
      let list = [...this.tasks.values()].filter(t => t.checked && !t.is_deleted && t.completed_at && Date.parse(t.completed_at) >= since && Date.parse(t.completed_at) < until);
      if (query.project_id) list = list.filter(t => t.project_id === query.project_id);
      list.sort((a, b) => a.id.localeCompare(b.id));
      const start = Number(query.cursor || 0);
      const more = start + this.pageSize < list.length;
      return ok({ items: list.slice(start, start + this.pageSize).map(t => this.view(t)), ...(more ? { next_cursor: String(start + this.pageSize) } : {}) });
    }
    const one = path.match(/^\/tasks\/([^/]+)$/);
    if (method === "GET" && one) {
      const t = this.tasks.get(decodeURIComponent(one[1]));
      return t && !t.is_deleted ? ok(this.view(t)) : err(404, "Task not found");
    }
    if (method === "POST" && path === "/sync") {
      if (form.commands) return ok(this.runCommands(JSON.parse(form.commands)));
      const token = form.sync_token;
      const types = JSON.parse(form.resource_types || "[]") as string[];
      if (!types.includes("items")) return err(400, "fake: items not requested");
      const full = token === "*";
      const since = full ? 0 : Number(String(token).replace(/^tok-/, ""));
      if (!full && !/^tok-\d+$/.test(token)) return err(400, "Invalid sync token");
      const items = [...this.tasks.values()].filter(t => full ? !t.checked && !t.is_deleted : (t._v ?? 0) > since).map(t => this.view(t));
      return ok({ sync_token: `tok-${this.v}`, full_sync: full, full_sync_date_utc: full ? this.clock.iso() : undefined, items, projects: full ? this.projects : [] });
    }
    return err(404, `fake: unhandled ${method} ${path}`);
  };

  private runCommands(cmds: { type: string; uuid: string; temp_id?: string; args: Record<string, unknown> }[]) {
    const sync_status: Record<string, unknown> = {};
    const temp_id_mapping: Record<string, string> = {};
    const resolve = (id: unknown) => temp_id_mapping[String(id)] ?? String(id);
    for (const c of cmds) {
      const fail = (error: string, http_code = 400) => { sync_status[c.uuid] = { error_code: 20, error, error_tag: "FAKE", http_code, error_extra: {} }; };
      if (c.type === "item_add") {
        const done = this.applied.get(c.uuid);
        if (done) { temp_id_mapping[c.temp_id!] = done; sync_status[c.uuid] = "ok"; continue; }
        const a = c.args as Partial<FakeTask> & { content: string };
        if (!a.content) { fail("content is required"); continue; }
        const t = this.put({ content: a.content, description: a.description ?? "", priority: a.priority ?? 1, due: a.due ?? null, labels: a.labels ?? [], project_id: (a.project_id as string) ?? INBOX });
        this.applied.set(c.uuid, t.id);
        temp_id_mapping[c.temp_id!] = t.id;
        sync_status[c.uuid] = "ok";
        continue;
      }
      const t = this.tasks.get(resolve(c.args.id));
      if (!t) { fail("Item not found", 404); continue; }
      if (c.type === "item_update") {
        const { id: _id, ...patch } = c.args; void _id;
        const p = patch as Partial<FakeTask>;
        if (p.due && typeof p.due === "object") p.due = { date: (p.due as { date: string }).date, string: (p.due as { date: string }).date, is_recurring: false, timezone: null };
        this.edit(t.id, p);
      } else if (c.type === "item_complete") this.complete(t.id);
      else if (c.type === "item_uncomplete") this.edit(t.id, { checked: false, completed_at: null });
      else if (c.type === "item_move") this.edit(t.id, { project_id: String(c.args.project_id) });
      else { fail(`fake: unknown command ${c.type}`); continue; }
      sync_status[c.uuid] = "ok";
    }
    return { sync_token: `tok-${this.v}`, sync_status, temp_id_mapping };
  }
}

export const TODOIST_PROJECTS_MD = `# Projects

## Acme Pilot
- folder: acme-pilot/
- status: active
- aliases: AP, acmepilot

## Orchard
- folder: orchard/
- status: active
- aliases: Orchard
- linear_project: Orchard Labs
- todoist_project: Orchard Labs

## Side Project
- folder: side-project/
- status: active
- aliases: side, hobby
`;
