import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { PENDING_RECOVER_MS, SyncEngine, derivedTaskId, isPlaceholder } from "../../src/sync/engine.js";
import { ProjectMap } from "../../src/sync/projectmap.js";
import {
  AsanaProvider, CANCELLED_TAG, IN_PROGRESS_TAG, asanaEntry, asanaEvents, asanaSignatureOk, asanaSyncFromEnv, asanaWebhookToken,
  statusFromAsana, taskToItem, verifyAsanaWebhook, type AsanaTask,
} from "../../src/sync/asana.js";
import { providersFromEnv } from "../../src/sync/registry.js";
import { registerSyncRoutes, type SyncDeps } from "../../src/sync/routes.js";
import { Clock, MemoryStore } from "./sync-fakes.js";
import { ORCHARD, APROJECTS, ASANA_PROJECTS_MD, ACME, FakeAsana, HAROLD, WS, fixture } from "./asana-fakes.js";

const SYNC_SECRET = "sync-secret-abcdef";
const HOOK_SECRET = "b537207f20cbfa02357cf448134da559e8bd39d61597dcd5631b8012eae53e81";
const TOKEN = asanaWebhookToken(SYNC_SECRET);
const map = ProjectMap.fromMarkdown(ASANA_PROJECTS_MD);

let clock: Clock, store: MemoryStore, as: FakeAsana, provider: AsanaProvider, engine: SyncEngine;
const cfg = (project: string | null = null, workspace = WS) => ({ token: "as-token", workspace, project, hookToken: TOKEN });
const setup = (project: string | null = null, workspace = WS) => {
  provider = new AsanaProvider(cfg(project, workspace), map, as.fetch, clock.now);
  engine = new SyncEngine(store, provider, map, { teamKey: project, now: clock.now });
};
beforeEach(() => {
  clock = new Clock();
  store = new MemoryStore(clock);
  as = new FakeAsana(clock);
  setup();
});
const linkOf = (taskId: string) => store.links.find(l => l.task_id === taskId && l.provider === "asana")!;
const writes = () => as.calls.filter(c => c.method !== "GET");
const hookReq = (body: string, headers: Record<string, string>, token: string | null = TOKEN) =>
  new Request(`https://hc.example/webhooks/asana${token ? `?t=${token}` : ""}`, { method: "POST", headers, body });
const sig = (body: string, secret = HOOK_SECRET) => createHmac("sha256", secret).update(body).digest("hex");

describe("Asana configuration", () => {
  it("needs ASANA_ACCESS_TOKEN and ASANA_WORKSPACE; ASANA_PROJECT is optional; the webhook token needs SYNC_SECRET", () => {
    const keep = { ...process.env };
    try {
      for (const k of ["ASANA_ACCESS_TOKEN", "ASANA_WORKSPACE", "ASANA_PROJECT", "SYNC_SECRET"]) delete process.env[k];
      expect(asanaSyncFromEnv()).toBeNull();
      process.env.ASANA_ACCESS_TOKEN = " tok ";
      expect(asanaSyncFromEnv()).toBeNull();
      process.env.ASANA_WORKSPACE = "Example Workspace";
      expect(asanaSyncFromEnv()).toEqual({ token: "tok", workspace: "Example Workspace", project: null, hookToken: "" });
      process.env.ASANA_PROJECT = "Harold"; process.env.SYNC_SECRET = SYNC_SECRET;
      expect(asanaSyncFromEnv()).toEqual({ token: "tok", workspace: "Example Workspace", project: "Harold", hookToken: TOKEN });
    } finally { process.env = keep; }
  });
});

describe("registry", () => {
  it("Asana joins the registry after Todoist when its variables are set, with the project as scope", () => {
    const keep = { ...process.env };
    try {
      for (const k of ["LINEAR_API_KEY", "LINEAR_TEAM_KEY", "TODOIST_API_TOKEN", "ASANA_ACCESS_TOKEN", "ASANA_WORKSPACE", "ASANA_PROJECT"]) delete process.env[k];
      process.env.ASANA_ACCESS_TOKEN = "t"; process.env.ASANA_WORKSPACE = WS; process.env.ASANA_PROJECT = "Harold"; process.env.TODOIST_API_TOKEN = "x";
      expect(providersFromEnv(as.fetch).map(e => [e.name, e.scope])).toEqual([["todoist", null], ["asana", "Harold"]]);
    } finally { process.env = keep; }
  });
});

describe("mapping Asana <-> Harold", () => {
  it("the documented task object becomes Harold fields; priority is unmapped", () => {
    const item = taskToItem(fixture<{ data: AsanaTask }>("task.json").data, map, null);
    expect(item.fields).toEqual({ title: "Buy catnip", notes: "Mittens really likes the stuff from Humboldt.", status: "pending", priority: null, due: "2026-11-20", project: "Orchard" });
    expect(item).toMatchObject({
      externalId: "12345", externalKey: "AS-12345", externalUrl: "https://app.asana.com/0/1331/12345", updatedAt: "2026-11-18T14:55:00.000Z",
      providerProject: "Orchard Labs", projectUnmapped: false, teamKey: null, removed: false, unmapped: ["priority"],
    });
    expect(item.extra).toMatchObject({ tags: [{ gid: "77", name: "errands" }], projectGids: ["1331"], mappedGid: "1331", completed: false });
  });
  it("status: completed and the two status tags, both ways", () => {
    expect(statusFromAsana(false, [])).toBe("pending");
    expect(statusFromAsana(false, [{ name: "In-Progress" }])).toBe("in_progress");
    expect(statusFromAsana(true, [{ name: "errands" }])).toBe("completed");
    expect(statusFromAsana(true, [{ name: CANCELLED_TAG }])).toBe("cancelled");
    expect(IN_PROGRESS_TAG).toBe("in-progress");
  });
  it("a due time alone is read as its day; a task in no project has no Harold project; empty notes are null", () => {
    const item = taskToItem({ gid: "1", name: "T", due_at: "2026-11-20T10:00:00.000Z", notes: "  ", memberships: [] }, map, null);
    expect(item.fields).toMatchObject({ due: "2026-11-20", notes: null, project: null });
    expect(item.projectUnmapped).toBe(false);
  });
  it("with several projects the first one Harold knows is used; with a scope, the scope project", () => {
    const t: AsanaTask = { gid: "1", name: "T", memberships: [{ project: { gid: "9", name: "Random" } }, { project: { gid: "1332", name: "Acme Pilot" } }, { project: { gid: "1331", name: "Orchard Labs" } }] };
    expect(taskToItem(t, map, null).fields.project).toBe("Acme Pilot");
    const scoped = taskToItem(t, map, "1331");
    expect(scoped).toMatchObject({ teamKey: "1331", providerProject: "Orchard Labs" });
    expect(taskToItem(t, map, "orchard labs").teamKey).toBe("orchard labs");
    expect(taskToItem(t, map, "Harold").teamKey).toBe("Acme Pilot");
    expect(taskToItem({ gid: "2", name: "T" }, map, "Harold").teamKey).toBe("(no project)");
  });
  it("an Asana project unknown to Harold is flagged unmapped", () => {
    expect(taskToItem({ gid: "1", name: "T", memberships: [{ project: { gid: "9", name: "Random" } }] }, map, null)).toMatchObject({ projectUnmapped: true, fields: { project: null } });
  });
  it("the project-map cache keeps asana_project", () => {
    expect(map.toProvider("asana", "Orchard")).toBe("Orchard Labs");
    expect(ProjectMap.fromCache(map.toCache()).fromProvider("asana", "orchard labs")).toBe("Orchard");
  });
});

describe("reading from Asana", () => {
  it("lists every project's tasks and the owner's own list, each task once, across pages (limit/offset)", async () => {
    as.put({ name: "A", memberships: as.member(ORCHARD) });
    as.put({ name: "A2", memberships: as.member(ORCHARD) });
    as.put({ name: "Both", memberships: as.member(ORCHARD, ACME) });
    as.put({ name: "C", memberships: as.member(ACME) });
    as.put({ name: "Loose", memberships: [], _assignee: "me" });
    const items = await provider.listChangedSince("2026-01-01T00:00:00Z");
    expect(items.map(i => i.fields.title).sort()).toEqual(["A", "A2", "Both", "C", "Loose"]);
    const lists = as.calls.filter(c => c.path === "/tasks");
    expect(lists.some(c => c.query.offset)).toBe(true); // paginated with next_page.offset
    expect(lists.every(c => c.query.limit === "100" && c.query.opt_fields!.includes("memberships.project.name"))).toBe(true);
    expect(lists.filter(c => c.query.assignee === "me")).toHaveLength(1);
  });
  it("modified_since is sent and honoured; completed_since drives the import", async () => {
    const old = as.put({ name: "Old", memberships: as.member(ORCHARD) });
    clock.tick(60_000);
    const since = clock.iso();
    clock.tick(1000);
    as.put({ name: "New", memberships: as.member(ORCHARD) });
    expect((await provider.listChangedSince(since)).map(i => i.fields.title)).toEqual(["New"]);
    expect(as.calls.filter(c => c.path === "/tasks")[0].query.modified_since).toBe(since);
    as.complete(old.gid);
    as.put({ name: "Long done", memberships: as.member(ORCHARD), completed: true, completed_at: "2026-01-01T00:00:00Z" });
    const imp = await provider.listForImport(30);
    expect(imp.map(i => i.fields.title).sort()).toEqual(["New", "Old"]);
    expect(as.calls.filter(c => c.path === "/tasks").pop()!.query.completed_since).toBe(new Date(clock.t - 30 * 86_400_000).toISOString());
  });
  it("with ASANA_PROJECT only that project is listed (by name or gid), and no assignee list is made", async () => {
    as.put({ name: "In", memberships: as.member(ORCHARD) });
    as.put({ name: "Out", memberships: as.member(ACME) });
    for (const p of ["Orchard Labs", ORCHARD]) {
      setup(p); as.calls = [];
      expect((await provider.listChangedSince("2026-01-01T00:00:00Z")).map(i => i.fields.title)).toEqual(["In"]);
      expect(as.calls.filter(c => c.path === "/tasks").map(c => c.query.project)).toEqual([ORCHARD]);
    }
    setup("Nope");
    await expect(provider.listChangedSince("2026-01-01T00:00:00Z")).rejects.toThrow(/ASANA_PROJECT/);
  });
  it("the workspace may be given by name or gid; an unknown one is an error", async () => {
    setup(null, "Example Workspace");
    await provider.listChangedSince("2026-01-01T00:00:00Z");
    expect(as.calls.some(c => c.path === "/workspaces")).toBe(true);
    setup(null, "Nowhere");
    await expect(provider.listChangedSince("2026-01-01T00:00:00Z")).rejects.toThrow(/ASANA_WORKSPACE/);
  });
  it("getOne: a deleted or unknown task and a subtask are null; errors carry the status", async () => {
    const t = as.put({ name: "Gone", memberships: as.member(ORCHARD) });
    const sub = as.put({ name: "Sub", parent: { gid: t.gid } });
    expect((await provider.getOne(t.gid))!.fields.title).toBe("Gone");
    expect(await provider.getOne(sub.gid)).toBeNull();
    as.remove(t.gid);
    expect(await provider.getOne(t.gid)).toBeNull();
    as.failNext = { status: 429, message: "rate" };
    await expect(provider.getOne("1")).rejects.toMatchObject({ status: 429, message: expect.stringMatching(/retry after 30/) });
  });
  it("catchup imports a task and then a webhook-less edit comes through the cursor", async () => {
    const a = as.put({ name: "Imported", memberships: as.member(ACME) });
    await engine.catchup({ import: true });
    const task = store.tasks.get(derivedTaskId("asana", a.gid))!;
    expect(task).toMatchObject({ title: "Imported", project: "Acme Pilot", changed_by: "asana" });
    clock.tick(30_000);
    as.edit(a.gid, { name: "Renamed" });
    const r = await engine.catchup();
    expect(r.counts.pulled).toBe(1);
    expect(store.tasks.get(task.id)!.title).toBe("Renamed");
  });
});

describe("Harold -> Asana", () => {
  it("creates the task with mapped fields in the mapped project; the placeholder link is re-keyed to the gid", async () => {
    const t = store.addHaroldTask({ title: "Draft deck", notes: "v1", priority: "high", due: "2026-11-25", project: "Orchard", status: "in_progress" });
    expect((await engine.fromHarold(t)).outcome).toBe("created");
    const post = writes().find(c => c.path === "/tasks")!;
    expect(post.body).toEqual({ name: "Draft deck", notes: "v1", due_on: "2026-11-25", tags: [expect.any(String)], projects: [ORCHARD] });
    const link = linkOf(t.id);
    expect(isPlaceholder(link.external_id)).toBe(false);
    expect(as.tasks.has(link.external_id)).toBe(true);
    expect(link).toMatchObject({ external_key: `AS-${link.external_id}`, external_url: `https://app.asana.com/0/0/${link.external_id}`, synced_at: t.updated_at });
    expect(link.synced_fields).toMatchObject({ title: "Draft deck", status: "in_progress", project: "Orchard", priority: "high" });
    expect(as.tags.get((post.body!.tags as string[])[0])).toBe("in-progress"); // tag created on first use
    expect(store.tasks.get(t.id)!.priority).toBe("high"); // Harold's priority is kept
  });
  it("a Harold project Asana does not have: no project, assigned to me, in the workspace", async () => {
    const t = store.addHaroldTask({ title: "Hobby thing", project: "Side Project" });
    await engine.fromHarold(t);
    expect(writes().find(c => c.path === "/tasks")!.body).toEqual({ name: "Hobby thing", workspace: WS, assignee: "me" });
    // ...and it is found again by the owner-list read
    expect((await provider.listChangedSince("2026-01-01T00:00:00Z")).map(i => i.fields.title)).toContain("Hobby thing");
  });
  it("with ASANA_PROJECT new tasks go into that project whatever Harold's project is", async () => {
    setup(HAROLD);
    const t = store.addHaroldTask({ title: "Scoped", project: "Acme Pilot" });
    await engine.fromHarold(t);
    expect(writes().find(c => c.path === "/tasks")!.body).toEqual({ name: "Scoped", projects: [HAROLD] });
  });
  it("update sends only what differs; a due date clears with null; priority is never sent", async () => {
    const t = store.addHaroldTask({ title: "Walk", due: "2026-11-25" });
    await engine.fromHarold(t);
    const gid = linkOf(t.id).external_id;
    store.editInHarold(t.id, { due: "2026-11-26" });
    as.calls = [];
    expect((await engine.fromHarold((await store.getTask(t.id))!)).outcome).toBe("pushed");
    expect(writes()).toEqual([{ method: "PUT", path: `/tasks/${gid}`, query: {}, body: { due_on: "2026-11-26" } }]);
    store.editInHarold(t.id, { due: null, priority: "low" });
    as.calls = [];
    await engine.fromHarold((await store.getTask(t.id))!);
    expect(writes().map(c => c.body)).toEqual([{ due_on: null }]);
    expect(as.tasks.get(gid)!.due_on).toBeNull();
    store.editInHarold(t.id, { priority: "high" });
    as.calls = [];
    await engine.fromHarold((await store.getTask(t.id))!);
    expect(writes()).toEqual([]);
  });
  it("statuses travel as completed + tags; the owner's own tags survive", async () => {
    const t = store.addHaroldTask({ title: "Status walk" });
    await engine.fromHarold(t);
    const gid = linkOf(t.id).external_id;
    as.edit(gid, { tags: as.tagObjs(["77"]) });
    await engine.fromProvider((await provider.getOne(gid))!);
    const step = async (status: "pending" | "in_progress" | "completed" | "cancelled") => {
      store.editInHarold(t.id, { status });
      as.calls = [];
      await engine.fromHarold((await store.getTask(t.id))!);
      return { tags: as.tasks.get(gid)!.tags!.map(x => x.name), completed: as.tasks.get(gid)!.completed };
    };
    expect(await step("in_progress")).toEqual({ tags: ["errands", "in-progress"], completed: false });
    expect(await step("completed")).toEqual({ tags: ["errands"], completed: true });
    expect(await step("cancelled")).toEqual({ tags: ["errands", "cancelled"], completed: true });
    expect(await step("pending")).toEqual({ tags: ["errands"], completed: false });
    expect(store.tasks.get(t.id)!.status).toBe("pending");
  });
  it("a project change moves the task (added to the new, removed from the old mapped one); clearing is not sent", async () => {
    const a = as.put({ name: "Mover", memberships: as.member(ACME) });
    await engine.fromProvider((await provider.getOne(a.gid))!);
    const task = store.tasks.get(derivedTaskId("asana", a.gid))!;
    expect(task).toMatchObject({ project: "Acme Pilot", priority: "medium" });
    store.editInHarold(task.id, { project: "Orchard" });
    await engine.fromHarold((await store.getTask(task.id))!);
    expect(as.tasks.get(a.gid)!.memberships!.map(m => m.project!.gid)).toEqual([ORCHARD]);
    store.editInHarold(task.id, { project: null });
    as.calls = [];
    await engine.fromHarold((await store.getTask(task.id))!);
    expect(writes()).toEqual([]);
  });
  it("Asana's own change reaches Harold without clearing Harold's priority", async () => {
    const t = store.addHaroldTask({ title: "Prio", priority: "high" });
    await engine.fromHarold(t);
    const gid = linkOf(t.id).external_id;
    clock.tick(10_000);
    as.edit(gid, { name: "Prio renamed", completed: true, completed_at: clock.iso() });
    expect((await engine.fromProvider((await provider.getOne(gid))!)).outcome).toBe("pulled");
    expect(store.tasks.get(t.id)).toMatchObject({ title: "Prio renamed", status: "completed", priority: "high" });
  });
  it("a refused create (4xx) drops the placeholder link; a failed one (5xx) keeps it; a deleted linked task is skipped", async () => {
    const a = store.addHaroldTask({ title: "Refused" });
    as.failNext = { status: 400, message: "bad" };
    expect((await engine.fromHarold(a)).outcome).toBe("error");
    expect(store.links.filter(l => l.task_id === a.id)).toHaveLength(0);
    const b = store.addHaroldTask({ title: "Failed" });
    as.failNext = { status: 500, message: "boom" };
    await engine.fromHarold(b);
    expect(isPlaceholder(linkOf(b.id).external_id)).toBe(true);
    const c = store.addHaroldTask({ title: "Will vanish" });
    await engine.fromHarold(c);
    as.remove(linkOf(c.id).external_id);
    store.editInHarold(c.id, { title: "Edited after delete" });
    expect((await engine.fromHarold((await store.getTask(c.id))!)).outcome).toBe("skipped");
    expect(store.logs.some(l => l.kind === "skip" && l.provider === "asana")).toBe(true);
  });
  it("a create that Asana made but the engine never confirmed is adopted by title on the next catchup, not duplicated", async () => {
    const t = store.addHaroldTask({ title: "Crashy" });
    as.failNext = null;
    // the create reached Asana, but the answer was lost: simulate by making the task and leaving a stale placeholder link
    const made = as.put({ name: "Crashy", memberships: [], _assignee: "me" });
    const ph = `pending:${clock.t - PENDING_RECOVER_MS - 1}:aaaaaaaa-0000-4000-8000-000000000000`;
    await store.insertLink({ task_id: t.id, provider: "asana", external_id: ph, external_key: null, external_url: null, external_updated_at: null, synced_at: null, synced_fields: null });
    const before = as.tasks.size;
    await engine.catchup();
    expect(as.tasks.size).toBe(before);
    expect(linkOf(t.id).external_id).toBe(made.gid);
  });
});

describe("Asana webhook", () => {
  const raw = JSON.stringify(fixture("webhook-events.json"));
  const ctx = () => ({ store: () => store });
  const handshake = async (secret = HOOK_SECRET, token: string | null = TOKEN) =>
    verifyAsanaWebhook(hookReq("{}", { "x-hook-secret": secret }, token), "{}", cfg(), ctx());

  it("the handshake stores the secret in sync_state and echoes it in the response header", async () => {
    const r = await handshake();
    expect(r).toEqual({ ok: true, events: [], reply: { status: 200, headers: { "X-Hook-Secret": HOOK_SECRET } } });
    expect((await store.getState("asana"))!.detail.hook_secrets).toEqual([HOOK_SECRET]);
    await handshake("another-webhook-secret");
    await handshake();
    expect((await store.getState("asana"))!.detail.hook_secrets).toEqual(["another-webhook-secret", HOOK_SECRET]);
  });
  it("a handshake without the right ?t= token, or without SYNC_SECRET, stores nothing", async () => {
    expect(await handshake(HOOK_SECRET, "wrong")).toMatchObject({ ok: false, status: 401 });
    expect(await handshake(HOOK_SECRET, null)).toMatchObject({ ok: false, status: 401 });
    expect(await verifyAsanaWebhook(hookReq("{}", { "x-hook-secret": "s" }), "{}", { hookToken: "" }, ctx())).toMatchObject({ ok: false, status: 503 });
    expect(await store.getState("asana")).toBeNull();
    expect(await verifyAsanaWebhook(hookReq("{}", { "x-hook-secret": "s" }), "{}", cfg(), { store: () => null })).toMatchObject({ ok: false, status: 503 });
  });
  it("accepts the documented delivery signed with a stored secret (hex HMAC-SHA256) and maps its events", async () => {
    await handshake();
    const r = await verifyAsanaWebhook(hookReq(raw, { "x-hook-signature": sig(raw) }), raw, cfg(), ctx());
    expect(r).toEqual({ ok: true, events: [
      { action: "update", externalId: "12345", updatedAt: "2026-11-18T15:00:01.000Z", teamKey: null },
      { action: "create", externalId: "67890", updatedAt: "2026-11-18T15:00:03.000Z", teamKey: null },
      { action: "remove", externalId: "55555", updatedAt: "2026-11-18T15:00:04.000Z", teamKey: null },
    ] });
  });
  it("any of several stored secrets will do; a wrong secret, tampered body, missing or malformed header is 401", async () => {
    await handshake("second-webhook"); await handshake();
    expect(await verifyAsanaWebhook(hookReq(raw, { "x-hook-signature": sig(raw, "second-webhook") }), raw, cfg(), ctx())).toMatchObject({ ok: true });
    for (const [body, header] of [[raw, sig(raw, "other")], [raw.replace("12345", "99999"), sig(raw)], [raw, sig(raw).slice(0, 20)], [raw, ""], [raw, "zz".repeat(32)]] as const) {
      expect(await verifyAsanaWebhook(hookReq(body, header ? { "x-hook-signature": header } : {}), body, cfg(), ctx())).toMatchObject({ ok: false, status: 401 });
    }
    expect(asanaSignatureOk(raw, null, HOOK_SECRET)).toBe(false);
  });
  it("no stored secret: even a correctly signed body is refused", async () => {
    expect(await verifyAsanaWebhook(hookReq(raw, { "x-hook-signature": sig(raw) }), raw, cfg(), ctx())).toMatchObject({ ok: false, status: 401 });
  });
  it("heartbeats, stories, unknown actions and bad JSON give no events", async () => {
    await handshake();
    const hb = JSON.stringify(fixture("webhook-heartbeat.json"));
    expect(await verifyAsanaWebhook(hookReq(hb, { "x-hook-signature": sig(hb) }), hb, cfg(), ctx())).toEqual({ ok: true, events: [] });
    expect(asanaEvents(JSON.stringify({ events: [{ action: "weird", resource: { gid: "1", resource_type: "task" } }, { action: "changed", resource: { gid: "2", resource_type: "story" } }] }))).toEqual([]);
    expect(asanaEvents("nope")).toBeNull();
    const bad = "nope";
    expect(await verifyAsanaWebhook(hookReq(bad, { "x-hook-signature": sig(bad) }), bad, cfg(), ctx())).toMatchObject({ ok: false, status: 400 });
  });

  describe("through the route", () => {
    const deps = (): SyncDeps => ({
      store: () => store, providers: () => [{ ...asanaEntry(cfg(), as.fetch, clock.now), build: () => provider }],
      projects: async () => ({ map, readAt: clock.iso(), stale: false }), housekeeping: async () => undefined, syncSecret: () => SYNC_SECRET, now: clock.now,
    });
    const app = () => { const a = new Hono(); registerSyncRoutes(a, deps()); return a; };
    it("the handshake answers 200 with X-Hook-Secret echoed and syncs nothing; a signed event pulls the task", async () => {
      const a = app();
      const hs = await a.request(`/webhooks/asana?t=${TOKEN}`, { method: "POST", headers: { "x-hook-secret": HOOK_SECRET }, body: "{}" });
      expect(hs.status).toBe(200);
      expect(hs.headers.get("x-hook-secret")).toBe(HOOK_SECRET);
      expect(as.calls).toEqual([]);
      const t = as.put({ name: "From the hook", memberships: as.member(ACME) });
      const body = JSON.stringify({ events: [{ action: "added", created_at: clock.iso(), resource: { gid: t.gid, resource_type: "task" }, parent: { gid: ACME, resource_type: "project" } }] });
      const res = await a.request(`/webhooks/asana?t=${TOKEN}`, { method: "POST", headers: { "x-hook-signature": sig(body) }, body });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ ok: true, results: [{ outcome: "pulled" }] });
      expect(store.tasks.get(derivedTaskId("asana", t.gid))).toMatchObject({ title: "From the hook", project: "Acme Pilot" });
      // a deleted event cancels the open task
      const del = JSON.stringify({ events: [{ action: "deleted", created_at: clock.iso(), resource: { gid: t.gid, resource_type: "task" } }] });
      expect((await (await a.request(`/webhooks/asana?t=${TOKEN}`, { method: "POST", headers: { "x-hook-signature": sig(del) }, body: del })).json())).toMatchObject({ results: [{ outcome: "pulled" }] });
      expect(store.tasks.get(derivedTaskId("asana", t.gid))!.status).toBe("cancelled");
    });
    it("a forged delivery is refused before any task is read", async () => {
      const res = await app().request(`/webhooks/asana?t=${TOKEN}`, { method: "POST", headers: { "x-hook-signature": sig(raw, "x") }, body: raw });
      expect(res.status).toBe(401);
      expect(as.calls).toEqual([]);
    });
  });
});

describe("registering the webhooks", () => {
  it("creates one webhook per project with the tokened target; running it again creates none", async () => {
    const r = await provider.registerWebhooks("https://hc.example/", SYNC_SECRET);
    expect(r.map(x => x.status)).toEqual(["created", "created", "created"]);
    expect(as.webhooks.map(w => w.resource.gid)).toEqual(APROJECTS.map(p => p.gid));
    expect(as.webhooks[0].target).toBe(`https://hc.example/webhooks/asana?t=${TOKEN}`);
    expect((await provider.registerWebhooks("https://hc.example", SYNC_SECRET)).map(x => x.status)).toEqual(["exists", "exists", "exists"]);
    expect(as.webhooks).toHaveLength(3);
  });
  it("with ASANA_PROJECT only that project; no SYNC_SECRET is an error", async () => {
    setup("Harold");
    expect((await provider.registerWebhooks("https://hc.example", SYNC_SECRET)).map(x => x.project)).toEqual([HAROLD]);
    await expect(provider.registerWebhooks("https://hc.example", "")).rejects.toThrow(/SYNC_SECRET/);
  });
});
