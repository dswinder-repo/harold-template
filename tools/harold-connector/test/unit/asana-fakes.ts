// An in-memory Asana API 1.0 behind a fetch mock, enough of it for the Asana provider: /workspaces, /projects,
// /workspaces/{gid}/tags and /tags, /tasks (list by project or assignee + workspace, with modified_since,
// completed_since, limit/offset pagination), /tasks/{gid} (get, put), addTag, removeTag, addProject, removeProject,
// POST /tasks, /webhooks. Objects follow the documented shapes in fixtures/asana/.

import { readFileSync } from "node:fs";
import type { AsanaProject, AsanaTask } from "../../src/sync/asana.js";
import type { Clock } from "./sync-fakes.js";

export const fixture = <T = unknown>(name: string): T => JSON.parse(readFileSync(new URL(`./fixtures/asana/${name}`, import.meta.url), "utf8")) as T;
const taskFixture = fixture<{ data: AsanaTask }>("task.json").data;

export const WS = "5000", ORCHARD = "1331", ACME = "1332", HAROLD = "1333", ME_ONLY = "me";
export const APROJECTS: AsanaProject[] = [
  { gid: ORCHARD, name: "Orchard Labs" }, { gid: ACME, name: "Acme Pilot" }, { gid: HAROLD, name: "Harold" },
];

export interface FakeTask extends AsanaTask { _v?: number; _assignee?: string | null; _deleted?: boolean }

export class FakeAsana {
  tasks = new Map<string, FakeTask>();
  tags = new Map<string, string>([["77", "errands"]]);
  webhooks: { gid: string; target: string; resource: { gid: string } }[] = [];
  projects = [...APROJECTS];
  calls: { method: string; path: string; query: Record<string, string>; body: Record<string, unknown> | null }[] = [];
  pageSize = 2;
  failNext: { status: number; message: string } | null = null;
  private v = 0; private n = 0; private tagN = 100;
  constructor(private clock: Clock) {}

  private stamp(t: FakeTask) { t._v = ++this.v; t.modified_at = this.clock.tick(); return t; }

  /** A task as the owner would make or edit it in Asana. */
  put(t: Partial<FakeTask> & { name: string }, gid = `9${String(++this.n).padStart(5, "0")}`): FakeTask {
    const prev = this.tasks.get(gid);
    const base: FakeTask = { ...taskFixture, completed: false, completed_at: null, due_on: null, notes: "", tags: [], memberships: [], parent: null, permalink_url: `https://app.asana.com/0/0/${gid}` };
    const task = this.stamp({ ...base, ...prev, ...t, gid });
    this.tasks.set(gid, task);
    return task;
  }
  inProject(gid: string) { return this.projects.find(p => p.gid === gid)!; }
  member(...ids: string[]) { return ids.map(id => ({ project: { gid: id, name: this.inProject(id).name }, section: { gid: "1", name: "Untitled section" } })); }
  edit(gid: string, patch: Partial<FakeTask>) { return this.put({ ...this.tasks.get(gid)!, ...patch }, gid); }
  complete(gid: string) { return this.edit(gid, { completed: true, completed_at: this.clock.iso() }); }
  remove(gid: string) { this.tasks.get(gid)!._deleted = true; }
  tagObjs(gids: string[]) { return gids.map(g => ({ gid: g, name: this.tags.get(g)! })); }

  view(t: FakeTask): AsanaTask { const { _v, _assignee, _deleted, ...rest } = t; void _v; void _assignee; void _deleted; return { ...rest }; }

  fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const method = init?.method || "GET";
    const path = url.pathname.replace(/^\/api\/1\.0/, "");
    const query = Object.fromEntries(url.searchParams);
    const body = init?.body ? (JSON.parse(String(init.body)).data as Record<string, unknown>) : null;
    this.calls.push({ method, path, query, body });
    const ok = (data: unknown, extra: object = {}, status = 200) => new Response(JSON.stringify({ data, ...extra }), { status, headers: { "Content-Type": "application/json" } });
    const err = (status: number, message: string) => new Response(JSON.stringify({ errors: [{ message, help: "For more information on API status codes and how to handle them, read the docs on errors: https://developers.asana.com/docs/errors" }] }), { status, headers: { "Content-Type": "application/json", ...(status === 429 ? { "Retry-After": "30" } : {}) } });
    const page = <T>(all: T[]) => {
      const lim = Math.min(Number(query.limit || 100), this.pageSize), start = Number(query.offset || 0);
      return ok(all.slice(start, start + lim), { next_page: start + lim < all.length ? { offset: String(start + lim), path: "/x", uri: "https://app.asana.com/api/1.0/x" } : null });
    };
    if (new Headers(init?.headers).get("authorization") !== "Bearer as-token") return err(401, "Not Authorized");
    if (this.failNext) { const f = this.failNext; this.failNext = null; return err(f.status, f.message); }

    if (method === "GET" && path === "/workspaces") return page([{ gid: WS, name: "Example Workspace", resource_type: "workspace" }, { gid: "5001", name: "Other" }]);
    if (method === "GET" && path === "/projects") return query.workspace === WS ? page(this.projects) : err(400, "workspace: Not a recognized ID");
    if (method === "GET" && path === `/workspaces/${WS}/tags`) return page([...this.tags].map(([gid, name]) => ({ gid, name })));
    if (method === "POST" && path === "/tags") {
      const gid = String(++this.tagN); this.tags.set(gid, String(body!.name)); return ok({ gid, name: body!.name }, {}, 201);
    }
    if (method === "GET" && path === "/webhooks") return page(this.webhooks);
    if (method === "POST" && path === "/webhooks") {
      const w = { gid: String(7000 + this.webhooks.length), target: String(body!.target), resource: { gid: String(body!.resource) } };
      this.webhooks.push(w); return ok(w, {}, 201);
    }
    if (method === "GET" && path === "/tasks") {
      let list = [...this.tasks.values()].filter(t => !t._deleted);
      if (query.project) list = list.filter(t => (t.memberships || []).some(m => m.project?.gid === query.project));
      else if (query.assignee === "me" && query.workspace === WS) list = list.filter(t => t._assignee === "me");
      else return err(400, "Must specify exactly one of project, tag, section, user task list, or assignee + workspace");
      if (query.modified_since) list = list.filter(t => Date.parse(t.modified_at!) >= Date.parse(query.modified_since));
      if (query.completed_since) list = list.filter(t => !t.completed || Date.parse(t.completed_at!) >= Date.parse(query.completed_since));
      list = list.filter(t => !t.parent);
      return page(list.map(t => this.view(t)));
    }
    if (method === "POST" && path === "/tasks") {
      const b = body!;
      const projects = (b.projects as string[] | undefined) || [];
      if (!projects.length && !b.workspace) return err(400, "workspace, projects, or parent must be specified");
      const t = this.put({
        name: String(b.name), notes: (b.notes as string) ?? "", due_on: (b.due_on as string) ?? null, completed: !!b.completed,
        completed_at: b.completed ? this.clock.iso() : null, memberships: this.member(...projects), tags: this.tagObjs((b.tags as string[]) || []),
        _assignee: (b.assignee as string) ?? null,
      });
      return ok(this.view(t), {}, 201);
    }
    const one = path.match(/^\/tasks\/([^/]+)(?:\/(addTag|removeTag|addProject|removeProject))?$/);
    if (one) {
      const t = this.tasks.get(decodeURIComponent(one[1]));
      if (!t || t._deleted) return err(404, "task: Unknown object: " + one[1]);
      if (method === "GET") return ok(this.view(t));
      if (method === "PUT") {
        const { ...patch } = body!;
        if ("completed" in patch) { (patch as Partial<FakeTask>).completed_at = patch.completed ? this.clock.iso() : null; }
        this.edit(t.gid, patch as Partial<FakeTask>);
        return ok(this.view(this.tasks.get(t.gid)!));
      }
      if (method === "POST" && one[2] === "addTag") this.edit(t.gid, { tags: [...(t.tags || []), ...this.tagObjs([String(body!.tag)])] });
      else if (method === "POST" && one[2] === "removeTag") this.edit(t.gid, { tags: (t.tags || []).filter(x => x.gid !== body!.tag) });
      else if (method === "POST" && one[2] === "addProject") this.edit(t.gid, { memberships: [...(t.memberships || []), ...this.member(String(body!.project))] });
      else if (method === "POST" && one[2] === "removeProject") this.edit(t.gid, { memberships: (t.memberships || []).filter(m => m.project?.gid !== body!.project) });
      else return err(404, `fake: unhandled ${method} ${path}`);
      return ok({});
    }
    return err(404, `fake: unhandled ${method} ${path}`);
  };
}

export const ASANA_PROJECTS_MD = `# Projects

## Acme Pilot
- folder: acme-pilot/
- status: active
- aliases: AP, acmepilot

## Orchard
- folder: orchard/
- status: active
- aliases: Orchard
- linear_project: Orchard Labs
- asana_project: Orchard Labs

## Side Project
- folder: side-project/
- status: active
- aliases: side, hobby
`;
