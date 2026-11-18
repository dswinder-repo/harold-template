// Test doubles for the Linear sync: an in-memory Harold store that behaves like the database (the origin
// trigger sets changed_by from x-harold-origin, updated_at moves on every write, unique keys on task_links),
// and an in-memory Linear GraphQL API behind a fetch mock.

import { DuplicateError, type LogEntry, type SyncStateRow, type SyncStore } from "../../src/sync/store.js";
import type { HaroldFields, LinkRow, TaskRow } from "../../src/sync/types.js";
import type { LinearIssue } from "../../src/sync/linear.js";

export class Clock {
  constructor(public t = Date.parse("2026-11-18T15:00:00Z")) {}
  now = () => this.t;
  tick(ms = 1000) { this.t += ms; return new Date(this.t).toISOString(); }
  iso() { return new Date(this.t).toISOString(); }
}

export class MemoryStore implements SyncStore {
  tasks = new Map<string, TaskRow>();
  links: LinkRow[] = [];
  logs: LogEntry[] = [];
  state = new Map<string, SyncStateRow>();
  writes: { op: "insert" | "update"; id: string; origin: string }[] = [];
  private n = 0;
  constructor(private clock: Clock) {}

  /** A task as the owner would create it in Harold (no origin header -> changed_by 'harold'). */
  addHaroldTask(f: Partial<HaroldFields> & { title: string }, id = `t-${++this.n}`): TaskRow {
    const row: TaskRow = { id, ref: `H-${this.n}`, title: f.title, notes: f.notes ?? null, status: f.status ?? "pending", priority: f.priority ?? "medium", due: f.due ?? null, project: f.project ?? null, source: "harold", changed_by: "harold", updated_at: this.clock.tick() };
    this.tasks.set(id, row);
    return { ...row };
  }
  /** The owner edits in Harold. */
  editInHarold(id: string, patch: Partial<HaroldFields>): TaskRow {
    const t = this.tasks.get(id)!;
    Object.assign(t, patch, { changed_by: "harold", updated_at: this.clock.tick() });
    return { ...t };
  }

  async getTask(id: string) { const t = this.tasks.get(id); return t ? { ...t } : null; }
  async insertTask(fields: HaroldFields, origin: string, id?: string) {
    const tid = id ?? `t-${++this.n}`;
    if (this.tasks.has(tid)) throw new DuplicateError("duplicate key value violates unique constraint \"tasks_pkey\"");
    const row: TaskRow = { id: tid, ref: `H-${++this.n}`, ...fields, priority: fields.priority ?? "medium", source: origin, changed_by: origin, updated_at: this.clock.tick() };
    this.tasks.set(tid, row);
    this.writes.push({ op: "insert", id: tid, origin });
    return { ...row };
  }
  async updateTask(id: string, patch: Partial<HaroldFields>, origin: string) {
    const t = this.tasks.get(id);
    if (!t) throw new Error("no row");
    Object.assign(t, patch, { changed_by: origin, updated_at: this.clock.tick() });
    this.writes.push({ op: "update", id, origin });
    return { ...t };
  }
  async findLink(p: string, e: string) { const l = this.links.find(x => x.provider === p && x.external_id === e); return l ? { ...l } : null; }
  async linkForTask(p: string, t: string) { const l = this.links.find(x => x.provider === p && x.task_id === t); return l ? { ...l } : null; }
  async linksForTasks(p: string, ids: string[]) { return this.links.filter(l => l.provider === p && ids.includes(l.task_id)).map(l => ({ ...l })); }
  async insertLink(link: LinkRow) {
    if (this.links.some(l => l.provider === link.provider && (l.external_id === link.external_id || l.task_id === link.task_id))) throw new DuplicateError("duplicate key");
    this.links.push({ ...link });
  }
  async updateLink(p: string, e: string, patch: Partial<LinkRow>) { const l = this.links.find(x => x.provider === p && x.external_id === e); if (l) Object.assign(l, patch); }
  async deleteLink(p: string, e: string) { this.links = this.links.filter(x => !(x.provider === p && x.external_id === e)); }
  async log(e: LogEntry) { this.logs.push(e); }
  async getState(p: string) { const s = this.state.get(p); return s ? { cursor: s.cursor, detail: { ...s.detail } } : null; }
  async setState(p: string, s: SyncStateRow) { this.state.set(p, { cursor: s.cursor, detail: { ...s.detail } }); }
  async haroldChangedTasks() { return [...this.tasks.values()].filter(t => t.changed_by === "harold").map(t => ({ ...t })); }
  async openTasks() { return [...this.tasks.values()].filter(t => t.status === "pending" || t.status === "in_progress").map(t => ({ ...t })); }
}

export interface FakeIssue extends LinearIssue { completedAt?: string | null }

export const STATES = [
  { id: "s-backlog", name: "Backlog", type: "backlog", position: 0 },
  { id: "s-todo", name: "Todo", type: "unstarted", position: 1 },
  { id: "s-prog", name: "In Progress", type: "started", position: 2 },
  { id: "s-done", name: "Done", type: "completed", position: 3 },
  { id: "s-cancel", name: "Canceled", type: "canceled", position: 4 },
];
export const LPROJECTS = [{ id: "p-ap", name: "Acme Pilot" }, { id: "p-orchard", name: "Orchard Labs" }, { id: "p-orphan", name: "Random Linear Project" }];

/** Linear's GraphQL API, enough of it for the provider. */
export class FakeLinear {
  issues = new Map<string, FakeIssue>();
  calls: { query: string; variables: Record<string, unknown> }[] = [];
  pageSize = 2;
  private n = 0;
  constructor(private clock: Clock, public team = "ENG") {}

  /** An issue as the owner would make or edit it in Linear. */
  put(i: Partial<FakeIssue> & { title: string }, id = `lin-${++this.n}`): FakeIssue {
    const num = ++this.n;
    const prev = this.issues.get(id);
    const issue: FakeIssue = {
      id, identifier: prev?.identifier ?? `${this.team}-${num}`, url: prev?.url ?? `https://linear.app/x/issue/${this.team}-${num}`,
      description: null, priority: 3, dueDate: null, state: { type: "unstarted", name: "Todo" }, project: null, team: { key: this.team },
      ...prev, ...i, updatedAt: this.clock.tick(),
    };
    this.issues.set(id, issue);
    return issue;
  }
  edit(id: string, patch: Partial<FakeIssue>) { return this.put({ ...this.issues.get(id)!, ...patch }, id); }

  fetch = async (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const { query, variables } = JSON.parse(String(init?.body)) as { query: string; variables: Record<string, unknown> };
    this.calls.push({ query, variables });
    const ok = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200, headers: { "Content-Type": "application/json" } });
    if (query.includes("teams(")) return ok({ teams: { nodes: [{ id: "team-1", states: { nodes: STATES }, projects: { nodes: LPROJECTS } }] } });
    if (query.includes("issueCreate")) {
      const inp = variables.in as Record<string, unknown>;
      const st = STATES.find(s => s.id === inp.stateId);
      const pj = LPROJECTS.find(p => p.id === inp.projectId);
      const issue = this.put({ title: String(inp.title), description: (inp.description as string) ?? null, priority: (inp.priority as number) ?? 0, dueDate: (inp.dueDate as string) ?? null, state: st ? { type: st.type, name: st.name } : { type: "backlog", name: "Backlog" }, project: pj ? { name: pj.name } : null }, String(inp.id));
      return ok({ issueCreate: { success: true, issue } });
    }
    if (query.includes("issueUpdate")) {
      const inp = variables.in as Record<string, unknown>;
      const cur = this.issues.get(String(variables.id))!;
      const patch: Partial<FakeIssue> = {};
      if ("title" in inp) patch.title = inp.title as string;
      if ("description" in inp) patch.description = inp.description as string;
      if ("priority" in inp) patch.priority = inp.priority as number;
      if ("dueDate" in inp) patch.dueDate = inp.dueDate as string | null;
      if ("stateId" in inp) { const st = STATES.find(s => s.id === inp.stateId)!; patch.state = { type: st.type, name: st.name }; }
      if ("projectId" in inp) { const pj = LPROJECTS.find(p => p.id === inp.projectId); patch.project = pj ? { name: pj.name } : null; }
      const issue = this.put({ ...cur, ...patch }, cur.id);
      return ok({ issueUpdate: { success: true, issue } });
    }
    if (query.includes("issue(id")) return ok({ issue: this.issues.get(String(variables.id)) ?? null });
    if (query.includes("issues(")) {
      const f = variables.filter as Record<string, any>;
      let list = [...this.issues.values()].filter(i => i.team?.key === f.team.key.eq);
      if (f.updatedAt?.gt) list = list.filter(i => Date.parse(i.updatedAt) > Date.parse(f.updatedAt.gt));
      if (f.or) {
        const since = Date.parse(f.or[1].completedAt.gt);
        list = list.filter(i => !["completed", "canceled"].includes(i.state?.type || "") || (i.completedAt && Date.parse(i.completedAt) > since));
      }
      list.sort((a, b) => a.id.localeCompare(b.id));
      const start = variables.after ? Number(variables.after) : 0;
      const page = list.slice(start, start + this.pageSize);
      const more = start + this.pageSize < list.length;
      return ok({ issues: { nodes: page, pageInfo: { hasNextPage: more, endCursor: more ? String(start + this.pageSize) : null } } });
    }
    return new Response(JSON.stringify({ errors: [{ message: `fake: unhandled ${query.slice(0, 40)}` }] }), { status: 200 });
  };
}

export const PROJECTS_MD = `# Projects

## Acme Pilot
- folder: acme-pilot/
- status: active
- aliases: AP, acmepilot

## Orchard
- folder: orchard/
- status: active
- aliases: Orchard Labs
- linear_project: Orchard Labs

## Side Project
- folder: side-project/
- status: active
- aliases: side, hobby
`;
