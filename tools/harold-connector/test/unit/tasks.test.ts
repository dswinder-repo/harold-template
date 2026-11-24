// Harold's own task list (task_list, task_create, task_update, crm_task) against an in-memory Supabase:
// create, dedupe, list, update by ref and by outside key (ENG-123 through task_links), project resolution against
// harold/projects.md, the old-schema fallback (no ref/project/source columns, no task_links table) and the plain
// "not configured" answer. Fictional data only.

import { beforeEach, describe, expect, it } from "vitest";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createApp } from "../../src/app.js";
import { _resetIdentityCache } from "../../src/identity.js";
import { issueTokens } from "../../src/oauth.js";
import { config } from "../../src/config.js";
import { HaroldRepo } from "../../src/github.js";
import { parseProjects } from "../../src/projects.js";
import * as tasks from "../../src/tasks.js";
import type * as crm from "../../src/crm.js";
import { FakeGithub, FakeSupabase } from "./fakes.js";
import { OWNER, setTestEnv } from "./env.js";

const BASE = "https://harold-connector.example.com";
const PROJECTS_MD = "## Acme Pilot\n- status: active\n- folder: projects/acme\n- aliases: acme, the pilot\n\n## Fundraise\n- status: active\n- folder: projects/fundraise\n- aliases: raise\n\n## Fundamentals Review\n- status: paused\n- folder: projects/fundamentals\n";

let db: FakeSupabase;
const sb = () => db as unknown as crm.Sb;
const load = async () => parseProjects(PROJECTS_MD);

function migrated() {
  let n = 0;
  db.onInsert.tasks = () => ({ ref: `H-${++n}` });
}
const addTask = (row: Record<string, unknown>) => { db.tables.tasks.push({ id: db.id(), status: "pending", priority: "medium", created_at: "2026-11-01T00:00:00Z", ...row }); return row; };

beforeEach(() => {
  db = new FakeSupabase();
  db.tables.contacts.push({ id: "c-jane", name: "Jane Doe", org: "Acme", category: "partner", status: "active" });
});

describe("task_create", () => {
  beforeEach(migrated);

  it("inserts with the canonical project and contact (never source or changed_by), and returns the ref", async () => {
    const r = await tasks.createTask(sb(), load, { title: "Send the revised deck", due_date: "2026-11-20", project: "the pilot", priority: "high", contact_name: "Jane Doe" });
    expect(r.isError, r.text).toBeFalsy();
    expect(r.text).toMatch(/^Created H-1 in Acme Pilot for Jane Doe, due 2026-11-20: Send the revised deck/);
    expect(db.tables.tasks[0]).toMatchObject({ title: "Send the revised deck", project: "Acme Pilot", status: "pending", priority: "high", due_date: "2026-11-20", contact_id: "c-jane", ref: "H-1" });
    expect(db.tables.tasks[0]).not.toHaveProperty("completed_at");
    expect(db.tables.tasks[0]).not.toHaveProperty("changed_by");
    expect(db.tables.tasks[0]).not.toHaveProperty("source"); // the default 'harold' is right for the connector
    expect(r.person).toEqual({ name: "Jane Doe" });
  });

  it("returns the existing open task for the same title and project instead of a duplicate", async () => {
    await tasks.createTask(sb(), load, { title: "Send the deck", project: "Acme Pilot" });
    const again = await tasks.createTask(sb(), load, { title: "send the DECK", project: "acme" });
    expect(again.text).toMatch(/^Already open, not created again: H-1 Send the deck · Acme Pilot/);
    expect(db.tables.tasks).toHaveLength(1);
    // another project, or none, is a different task
    await tasks.createTask(sb(), load, { title: "Send the deck", project: "Fundraise" });
    await tasks.createTask(sb(), load, { title: "Send the deck" });
    expect(db.tables.tasks).toHaveLength(3);
    // a closed task does not block a new one
    db.tables.tasks[0].status = "completed";
    await tasks.createTask(sb(), load, { title: "Send the deck", project: "Acme Pilot" });
    expect(db.tables.tasks).toHaveLength(4);
  });

  it("refuses an unknown project and lists the close matches; writes nothing", async () => {
    const r = await tasks.createTask(sb(), load, { title: "x", project: "Fund" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/No project matches "Fund" in harold\/projects\.md\. Close matches: .*Fundraise.*Fundamentals Review/);
    const none = await tasks.createTask(sb(), load, { title: "x", project: "Zzz Nothing" });
    expect(none.text).toMatch(/Projects: Acme Pilot, Fundraise/);
    expect(db.tables.tasks).toHaveLength(0);
  });

  it("refuses a secret, a bad date, an unknown contact; stores nothing", async () => {
    expect((await tasks.createTask(sb(), load, { title: "key lin_api_abcdefghijklmnopqrstuvwxyz0123" })).text).toMatch(/Refused: the task looks like it contains a secret/);
    expect((await tasks.createTask(sb(), load, { title: "x", due_date: "friday" })).text).toMatch(/due_date must be YYYY-MM-DD/);
    expect((await tasks.createTask(sb(), load, { title: "x", contact_name: "Nobody Here" })).isError).toBe(true);
    expect(db.tables.tasks).toHaveLength(0);
  });
});

describe("task_list", () => {
  beforeEach(() => {
    migrated();
    db.tables.contacts.push({ id: "c-sam", name: "Sam Lee", org: "Beta" });
    addTask({ ref: "H-1", title: "Send the deck", project: "Acme Pilot", contact_id: "c-jane", due_date: "2026-11-20", priority: "high" });
    addTask({ ref: "H-2", title: "Draft the term sheet", description: "for the raise", project: "Fundraise", due_date: "2026-11-19" });
    addTask({ ref: "H-3", title: "Old thing", status: "completed" });
    addTask({ ref: "H-4", title: "Undated", status: "in_progress" });
    db.tables.task_links.push({ task_id: db.tables.tasks[1].id, provider: "linear", external_id: "uuid-1", external_key: "ENG-123", external_url: "https://linear.app/x/issue/ENG-123" });
  });

  it("lists open tasks by due date with ref, project, contact, status, due, priority and the outside key and URL", async () => {
    const r = await tasks.listTasks(sb(), load, {});
    expect(r.text).toMatch(/^Open tasks \(3, by due date\):/);
    const lines = r.text.split("\n");
    expect(lines[1]).toBe("- H-2 · Draft the term sheet · Fundraise · no contact · pending · due 2026-11-19 · medium");
    expect(lines[2]).toBe("  outside: ENG-123 https://linear.app/x/issue/ENG-123");
    expect(lines[3]).toBe("- H-1 · Send the deck · Acme Pilot · Jane Doe · pending · due 2026-11-20 · high");
    expect(lines[4]).toMatch(/^- H-4 · Undated · no project · no contact · in progress · due none/);
    expect(r.text).not.toMatch(/Old thing/);
  });

  it("filters by text (title or description), project and contact; include_done shows closed tasks", async () => {
    expect((await tasks.listTasks(sb(), load, { query: "deck" })).text).toMatch(/\(1, by due date\)[\s\S]*H-1/);
    expect((await tasks.listTasks(sb(), load, { query: "raise" })).text).toMatch(/H-2/);
    const proj = await tasks.listTasks(sb(), load, { project: "raise" });
    expect(proj.text).toMatch(/in Fundraise \(1/);
    expect(proj.text).not.toMatch(/H-1/);
    expect((await tasks.listTasks(sb(), load, { contact_name: "Jane Doe" })).text).toMatch(/for Jane Doe \(1[\s\S]*H-1/);
    expect((await tasks.listTasks(sb(), load, { include_done: true })).text).toMatch(/^Tasks \(4,[\s\S]*Old thing · no project · no contact · done/);
    expect((await tasks.listTasks(sb(), load, { query: "zebra" })).text).toBe("No open tasks matching \"zebra\".");
  });
});

describe("due dates", () => {
  it("are sent as YYYY-MM-DD (UTC midnight) and read as the first 10 characters", async () => {
    migrated();
    await tasks.createTask(sb(), load, { title: "Summer task", due_date: "2026-07-04" });
    expect(db.tables.tasks[0].due_date).toBe("2026-07-04");
    addTask({ ref: "H-9", title: "Stored by the database", due_date: "2026-11-20T00:00:00+00:00" });
    expect((await tasks.listTasks(sb(), load, {})).text).toMatch(/Stored by the database .* due 2026-11-20/);
  });
});

describe("task_update", () => {
  beforeEach(() => {
    migrated();
    addTask({ ref: "H-12", title: "Call the landlord", project: "Acme Pilot", due_date: "2026-10-30", priority: "medium" });
    db.tables.task_links.push({ task_id: db.tables.tasks[0].id, provider: "linear", external_id: "uuid-9", external_key: "ENG-123", external_url: "https://linear.app/x/issue/ENG-123" });
  });

  it("by ref: state with before -> after, reversible, completed_at set and cleared", async () => {
    const start = await tasks.updateTask(sb(), load, { task: "H-12", state: "start" });
    expect(start.text).toMatch(/^Updated H-12 \(Call the landlord\): state pending -> in progress\./);
    expect(start.text).toMatch(/outside: ENG-123 https:\/\/linear\.app/);
    expect(start.text).toMatch(/Reversible/);
    const done = await tasks.updateTask(sb(), load, { task: "h-12", state: "Done" });
    expect(done.text).toMatch(/state in progress -> done/);
    expect(db.tables.tasks[0].status).toBe("completed");
    expect(db.tables.tasks[0]).not.toHaveProperty("completed_at"); // set by the database trigger
    const back = await tasks.updateTask(sb(), load, { task: "H-12", state: "todo" });
    expect(back.text).toMatch(/state done -> pending/);
    expect(db.tables.tasks[0].status).toBe("pending");
    const cancel = await tasks.updateTask(sb(), load, { task: "H-12", state: "cancel" });
    expect(db.tables.tasks[0].status).toBe("cancelled");
    expect(cancel.text).toMatch(/state pending -> cancelled/);
    expect(db.tables.tasks).toHaveLength(1); // nothing is ever deleted
  });

  it("by outside key (ENG-123 via task_links) and by uuid", async () => {
    const r = await tasks.updateTask(sb(), load, { task: "eng-123", state: "done" });
    expect(r.isError, r.text).toBeFalsy();
    expect(r.text).toMatch(/^Updated H-12 .*state pending -> done/);
    expect(db.tables.tasks[0].status).toBe("completed");
    const byId = await tasks.updateTask(sb(), load, { task: String(db.tables.tasks[0].id), title: "Call the property manager" });
    expect(byId.text).toMatch(/title "Call the landlord" -> "Call the property manager"/);
    expect((await tasks.updateTask(sb(), load, { task: "ENG-999", state: "done" })).text).toMatch(/No task is linked to ENG-999/);
  });
  it("by every provider's outside key shape (Todoist, Asana, Notion), and H-n stays Harold's own ref", async () => {
    const keys = [["todoist", "TD-6Xr4PqW8mNc2", "TD-6Xr4PqW8mNc2"], ["asana", "AS-1201234567890123", "as-1201234567890123"], ["notion", "NO-1a2b3c4d", "no-1a2b3c4d"]];
    for (const [provider, key, typed] of keys) {
      const t = addTask({ title: `Task ${provider}`, ref: `H-${provider.length + 50}` }) as Record<string, unknown>;
      const row = db.tables.tasks[db.tables.tasks.length - 1];
      db.tables.task_links.push({ task_id: row.id, provider, external_id: `x-${provider}`, external_key: key, external_url: "https://example.com" });
      const r = await tasks.updateTask(sb(), load, { task: typed, state: "done" });
      expect(r.isError, `${provider}: ${r.text}`).toBeFalsy();
      expect(r.text).toMatch(new RegExp(`^Updated ${t.ref} `));
    }
    expect((await tasks.updateTask(sb(), load, { task: "TD-nope", state: "done" })).text).toMatch(/No task is linked to TD-nope/);
    expect((await tasks.updateTask(sb(), load, { task: "H-9999", state: "done" })).text).toMatch(/No task H-9999/);
  });

  it("title, description, priority, due date ('none' clears), project; an unchanged field is not written", async () => {
    const r = await tasks.updateTask(sb(), load, { task: "H-12", description: "Ask about the lease", priority: "low", due_date: "2026-11-02", project: "Fundraise" });
    expect(r.text).toMatch(/description updated; due 2026-10-30 -> 2026-11-02; priority medium -> low; project Acme Pilot -> Fundraise/);
    expect(db.tables.tasks[0]).toMatchObject({ project: "Fundraise", priority: "low", due_date: "2026-11-02" });
    expect(db.tables.tasks[0]).not.toHaveProperty("changed_by");
    expect((await tasks.updateTask(sb(), load, { task: "H-12", due_date: "none" })).text).toMatch(/due 2026-11-02 -> none/);
    expect(db.tables.tasks[0].due_date).toBeNull();
    const writes = db.updates.length;
    expect((await tasks.updateTask(sb(), load, { task: "H-12", title: "Call the landlord" })).text).toMatch(/already says that/);
    expect(db.updates).toHaveLength(writes);
  });

  it("refuses bad input before any write", async () => {
    const cases: [Partial<tasks.UpdateArgs>, RegExp][] = [
      [{ task: "12", state: "done" }, /task must be a ref like H-12/],
      [{ task: "H-99", state: "done" }, /No task H-99/],
      [{ task: "H-12", state: "Nope" }, /State "Nope" is not one of/],
      [{ task: "H-12" }, /Nothing to change/],
      [{ task: "H-12", due_date: "friday" }, /due_date must be YYYY-MM-DD or "none"/],
      [{ task: "H-12", project: "Zzz Nothing" }, /No project matches "Zzz Nothing"/],
      [{ task: "H-12", description: "key lin_api_abcdefghijklmnopqrstuvwxyz0123" }, /Refused: the change looks like it contains a secret/],
    ];
    for (const [args, re] of cases) {
      const r = await tasks.updateTask(sb(), load, args as tasks.UpdateArgs);
      expect(r.isError, JSON.stringify(args)).toBe(true);
      expect(r.text).toMatch(re);
    }
    expect(db.updates).toHaveLength(0);
  });
});

describe("old schema (task-list migration not applied)", () => {
  beforeEach(() => {
    db.missingColumns.tasks = ["ref", "project", "source", "changed_by"];
    db.missingTables.add("task_links");
  });

  it("create falls back to the old column set and says what was not stored", async () => {
    const r = await tasks.createTask(sb(), load, { title: "Send the deck", project: "Acme Pilot", contact_name: "Jane Doe" });
    expect(r.isError, r.text).toBeFalsy();
    expect(r.text).toMatch(/migration is not applied yet: saved without the project "Acme Pilot", a ref\. Its id is [0-9a-f]{8}\./);
    expect(db.tables.tasks[0]).toMatchObject({ title: "Send the deck", status: "pending", contact_id: "c-jane" });
    expect(db.tables.tasks[0]).not.toHaveProperty("project");
    expect(db.tables.tasks[0]).not.toHaveProperty("source");
    // dedupe still works on the title
    expect((await tasks.createTask(sb(), load, { title: "Send the deck" })).text).toMatch(/^Already open/);
    expect(db.tables.tasks).toHaveLength(1);
  });

  it("list works without refs and links, shows ids, and says the migration is pending", async () => {
    addTask({ title: "Send the deck", due_date: "2026-11-20" });
    const r = await tasks.listTasks(sb(), load, {});
    expect(r.isError).toBeFalsy();
    expect(r.text).toMatch(/- [0-9a-f]{8} · Send the deck · no project · no contact · pending · due 2026-11-20 · medium/);
    expect(r.text).toMatch(/migration is not applied yet/);
    expect((await tasks.listTasks(sb(), load, { project: "Acme Pilot" })).text).toMatch(/Cannot filter by project/);
  });

  it("update works by uuid; a ref or outside key explains the migration; setting a project is refused", async () => {
    addTask({ title: "Send the deck" });
    const id = String(db.tables.tasks[0].id);
    const r = await tasks.updateTask(sb(), load, { task: id, state: "done" });
    expect(r.isError, r.text).toBeFalsy();
    expect(r.text).toMatch(/state pending -> done/);
    expect(db.tables.tasks[0].status).toBe("completed");
    const short = await tasks.updateTask(sb(), load, { task: id.slice(0, 8), title: "Send the deck v2" });
    expect(short.text).toMatch(/^Updated [0-9a-f]{8} .*title "Send the deck" -> "Send the deck v2"/);
    expect((await tasks.updateTask(sb(), load, { task: "H-1", state: "done" })).text).toMatch(/refs \(H-1\) need the task-list migration/);
    expect((await tasks.updateTask(sb(), load, { task: "ENG-123", state: "done" })).text).toMatch(/Outside keys \(ENG-123\) need the task-list migration/);
    expect((await tasks.updateTask(sb(), load, { task: id, project: "Fundraise" })).text).toMatch(/Cannot set a project/);
  });
});

describe("harold_today: overdue and due-today tasks", () => {
  const TODAY = "2026-11-18";
  beforeEach(() => {
    migrated();
    addTask({ ref: "H-1", title: "Overdue thing", project: "Acme Pilot", due_date: "2026-11-16T00:00:00Z" });
    addTask({ ref: "H-2", title: "Today thing", due_date: "2026-11-18T00:00:00Z" });
    addTask({ ref: "H-3", title: "Tomorrow thing", due_date: "2026-11-19T00:00:00Z" });
    addTask({ ref: "H-4", title: "Done thing", status: "completed", due_date: "2026-11-10T00:00:00Z" });
    addTask({ ref: "H-5", title: "Undated" });
  });
  it("lists open tasks due today or earlier, by day in the owner's time zone, with ref, title, project, due", async () => {
    const t = await tasks.dueTodayText(sb(), TODAY);
    expect(t).toBe("Open tasks overdue or due today (2):\n- H-1 · Overdue thing · Acme Pilot · due 2026-11-16 (overdue)\n- H-2 · Today thing · no project · due 2026-11-18 (today)");
  });
  it("compares the stored day with today's date in the owner's time zone", async () => {
    expect(await tasks.dueTodayText(sb(), "2026-11-19")).toMatch(/Tomorrow thing/);
    expect(await tasks.dueTodayText(sb(), "2026-11-17")).not.toMatch(/Today thing/);
  });
  it("is empty when nothing is due, not configured, or the table cannot be read", async () => {
    expect(await tasks.dueTodayText(sb(), "2026-01-01")).toBe("");
    expect(await tasks.dueTodayText(null, TODAY)).toBe("");
    db.missingTables.add("tasks");
    expect(await tasks.dueTodayText(sb(), TODAY)).toBe("");
  });
});

describe("crm_task (the same task list, contact-filtered)", () => {
  beforeEach(migrated);

  it("creates for a contact, lists only that contact's tasks, completes by ref", async () => {
    const r = await tasks.crmTask(sb(), load, { action: "create", contact_name: "Jane Doe", title: "Send deck", due_date: "2026-10-03" });
    expect(r.text).toMatch(/^Created H-1 for Jane Doe, due 2026-10-03: Send deck/);
    expect(db.tables.tasks[0]).toMatchObject({ contact_id: "c-jane", status: "pending", priority: "medium", due_date: "2026-10-03" });
    addTask({ ref: "H-2", title: "Unrelated" });
    const list = await tasks.crmTask(sb(), load, { action: "list", contact_name: "Jane Doe" });
    expect(list.text).toMatch(/H-1/);
    expect(list.text).not.toMatch(/Unrelated/);
    expect((await tasks.crmTask(sb(), load, { action: "complete" })).isError).toBe(true);
    const done = await tasks.crmTask(sb(), load, { action: "complete", task_id: "H-1" });
    expect(done.text).toMatch(/Updated H-1 \(Send deck\): state pending -> done/);
    const upd = await tasks.crmTask(sb(), load, { action: "update", task_id: "H-1", status: "pending", priority: "high" });
    expect(upd.text).toMatch(/state done -> pending; priority medium -> high/);
  });
});

describe("through the MCP app", () => {
  let client: Client;
  const text = (r: unknown) => ((r as { content: { text: string }[] }).content[0].text);

  async function connect(supabase: () => crm.Sb | null) {
    const gh = new FakeGithub();
    gh.users.set("tok-owner", OWNER);
    gh.files.set("harold/projects.md", PROJECTS_MD);
    setTestEnv({ PUBLIC_BASE_URL: BASE });
    _resetIdentityCache();
    const app = createApp({ fetch: gh.fetch, tools: { repoFor: () => new HaroldRepo("tok-owner", "example/harold", "main", gh.fetch), supabase } });
    const t = issueTokens(config(), { gh: "tok-owner", login: OWNER.login, uid: OWNER.id, client_id: "test" });
    client = new Client({ name: "tasks-test", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), {
      fetch: async (u, init) => app.fetch(new Request(u, init)),
      requestInit: { headers: { Authorization: `Bearer ${t.access_token}` } },
    }));
  }

  it("task_create, task_list, task_update work end to end; the tools are not open-world", async () => {
    migrated();
    await connect(() => sb());
    const { tools } = await client.listTools();
    expect(tools.find(t => t.name === "task_list")!.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false });
    for (const n of ["task_create", "task_update", "crm_task"]) expect(tools.find(t => t.name === n)!.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, openWorldHint: false });
    expect(tools.find(t => t.name === "crm_task")!.description).toMatch(/same task list/);
    const c = await client.callTool({ name: "task_create", arguments: { title: "Send the deck", project: "acme", due_date: "2026-11-20" } });
    expect(c.isError, text(c)).toBeFalsy();
    expect(text(c)).toMatch(/Created H-1 in Acme Pilot/);
    const l = await client.callTool({ name: "task_list", arguments: { project: "Acme Pilot" } });
    expect(text(l)).toMatch(/H-1 · Send the deck · Acme Pilot/);
    const u = await client.callTool({ name: "task_update", arguments: { task: "H-1", state: "done" } });
    expect(text(u)).toMatch(/state pending -> done/);
  });

  it("harold_today appends overdue and due-today tasks, and stays silent when the task list is not configured", async () => {
    migrated();
    addTask({ ref: "H-1", title: "Overdue thing", due_date: "2020-01-01T00:00:00Z" });
    await connect(() => sb());
    const r = await client.callTool({ name: "harold_today", arguments: {} });
    expect(r.isError, text(r)).toBeFalsy();
    expect(text(r)).toMatch(/## Open tasks overdue or due today \(1\):\n- H-1 · Overdue thing · no project · due 2020-01-01 \(overdue\)/);
    await connect(() => null);
    const none = await client.callTool({ name: "harold_today", arguments: {} });
    expect(none.isError, text(none)).toBeFalsy();
    expect(text(none)).not.toMatch(/overdue or due today/);
  });

  it("not configured: the three tools say so plainly and touch nothing", async () => {
    await connect(() => null);
    for (const [name, args] of [["task_create", { title: "Send the deck" }], ["task_list", {}], ["task_update", { task: "H-1", state: "done" }], ["crm_task", { action: "list" }]] as const) {
      const r = await client.callTool({ name, arguments: args });
      expect(r.isError, name).toBe(true);
      expect(text(r)).toMatch(/Harold's task list is not configured on this connector \(SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set\)/);
    }
  });

  it("instructions tell the model to turn commitments into tasks without being asked, with refs", async () => {
    await connect(() => null);
    const i = client.getInstructions() || "";
    expect(i).toMatch(/Turn commitments into tasks without being asked/);
    expect(i).toMatch(/call task_list to see what is already open/);
    expect(i).toMatch(/call task_create once per new commitment/);
    expect(i).toMatch(/"Follow up: <who> owes <what>"/);
    expect(i).toMatch(/contact_name/);
    expect(i).toMatch(/every item carries its task ref/);
    expect(i).toMatch(/Keep Harold's task list truthful with task_update/);
    expect(i).not.toMatch(/Linear|task manager/);
  });
});
