import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { derivedTaskId } from "../../src/sync/engine.js";
import { LinearProvider, linearEntry } from "../../src/sync/linear.js";
import { ProjectMap } from "../../src/sync/projectmap.js";
import type { ProviderEntry } from "../../src/sync/provider.js";
import { providersFromEnv } from "../../src/sync/registry.js";
import { registerSyncRoutes, type SyncDeps } from "../../src/sync/routes.js";
import { TodoistProvider, todoistEntry } from "../../src/sync/todoist.js";
import { Clock, FakeLinear, MemoryStore } from "./sync-fakes.js";
import { FakeTodoist, TODOIST_PROJECTS_MD } from "./todoist-fakes.js";

const LINEAR_SECRET = "whsec-test-0123456789";
const TODOIST_SECRET = "todoist-client-secret-0123";
const SYNC_SECRET = "sync-secret-abcdef";
const map = ProjectMap.fromMarkdown(TODOIST_PROJECTS_MD);

let clock: Clock, store: MemoryStore, linear: FakeLinear, td: FakeTodoist;
let linearP: LinearProvider, todoistP: TodoistProvider;
let lin: ProviderEntry, tdo: ProviderEntry;
beforeEach(() => {
  clock = new Clock();
  store = new MemoryStore(clock);
  linear = new FakeLinear(clock);
  td = new FakeTodoist(clock);
  linearP = new LinearProvider({ key: "k", team: "ENG", webhookSecret: LINEAR_SECRET }, map, linear.fetch, clock.now);
  todoistP = new TodoistProvider({ token: "td-token", project: null, clientSecret: TODOIST_SECRET }, map, td.fetch, clock.now);
  lin = { ...linearEntry({ key: "k", team: "ENG", webhookSecret: LINEAR_SECRET }, linear.fetch, clock.now), build: () => linearP };
  tdo = { ...todoistEntry({ token: "td-token", project: null, clientSecret: TODOIST_SECRET }, td.fetch, clock.now), build: () => todoistP };
});

const deps = (over: Partial<SyncDeps> = {}): SyncDeps => ({
  store: () => store, providers: () => [lin, tdo], projects: async () => ({ map, readAt: clock.iso(), stale: false }),
  housekeeping: async () => undefined, syncSecret: () => SYNC_SECRET, now: clock.now, ...over,
});
const appWith = (d: SyncDeps) => { const a = new Hono(); registerSyncRoutes(a, d); return a; };
const post = (app: Hono, path: string, body: unknown = {}) =>
  app.request(path, { method: "POST", headers: { "x-harold-sync-secret": SYNC_SECRET, "Content-Type": "application/json" }, body: JSON.stringify(body) });
const linkOf = (taskId: string, provider: string) => store.links.find(l => l.task_id === taskId && l.provider === provider);
const tdHook = (event: string, id: string, secret = TODOIST_SECRET) => {
  const body = JSON.stringify({ event_name: event, user_id: "2671355", event_data: { id, updated_at: clock.iso() }, triggered_at: clock.iso(), version: "10" });
  return { body, headers: { "x-todoist-hmac-sha256": createHmac("sha256", secret).update(body).digest("base64") } };
};

describe("provider registry from the environment", () => {
  it("builds each configured provider, Linear first; none configured -> empty", () => {
    const keep = { ...process.env };
    try {
      for (const k of ["LINEAR_API_KEY", "LINEAR_TEAM_KEY", "LINEAR_WEBHOOK_SECRET", "TODOIST_API_TOKEN", "TODOIST_PROJECT", "TODOIST_CLIENT_SECRET"]) delete process.env[k];
      expect(providersFromEnv(linear.fetch)).toEqual([]);
      process.env.TODOIST_API_TOKEN = "t"; process.env.TODOIST_PROJECT = "Harold";
      expect(providersFromEnv(linear.fetch).map(e => [e.name, e.scope])).toEqual([["todoist", "Harold"]]);
      process.env.LINEAR_API_KEY = "k"; process.env.LINEAR_TEAM_KEY = "ENG";
      expect(providersFromEnv(linear.fetch).map(e => [e.name, e.scope])).toEqual([["linear", "ENG"], ["todoist", "Harold"]]);
    } finally { process.env = keep; }
  });
});

describe("routes with several providers", () => {
  it("no provider configured: push and catchup answer 503 and nothing is read", async () => {
    const app = appWith(deps({ providers: () => [], store: () => { throw new Error("store must not be touched"); } }));
    const t = store.addHaroldTask({ title: "Harold only" });
    const r1 = await post(app, "/sync/push", { task_id: t.id });
    expect(r1.status).toBe(503);
    expect(await r1.json()).toMatchObject({ error: expect.stringMatching(/no task provider/) });
    expect((await post(app, "/sync/catchup")).status).toBe(503);
  });

  it("/sync/push pushes to every provider and lists each result", async () => {
    const t = store.addHaroldTask({ title: "Everywhere", project: "Orchard" });
    const res = await post(appWith(deps()), "/sync/push", { task_id: t.id });
    expect(res.status).toBe(200);
    const j = await res.json() as Record<string, unknown>;
    expect(j).toMatchObject({ ok: true, results: { linear: { outcome: "created" }, todoist: { outcome: "created" } } });
    expect(j).not.toHaveProperty("outcome"); // several providers: no single result at the top
    expect(linkOf(t.id, "linear")!.external_key).toMatch(/^ENG-/);
    expect(linkOf(t.id, "todoist")!.external_key).toMatch(/^TD-/);
  });

  it("/sync/push: one provider failing is logged and does not stop the other", async () => {
    const t = store.addHaroldTask({ title: "Half" });
    await post(appWith(deps()), "/sync/push", { task_id: t.id });
    store.editInHarold(t.id, { title: "Half edited" });
    td.failNext = { status: 500, error: "boom" }; // the Todoist read of the linked task fails
    const res = await post(appWith(deps()), "/sync/push", { task_id: t.id });
    expect(res.status).toBe(200);
    const j = await res.json() as { ok: boolean; results: Record<string, { outcome: string; error?: string }> };
    expect(j.ok).toBe(false);
    expect(j.results.linear.outcome).toBe("pushed");
    expect(j.results.todoist).toMatchObject({ outcome: "error", error: expect.stringMatching(/HTTP 500/) });
    expect(store.logs.find(l => l.kind === "error" && l.provider === "todoist")!.detail).toMatchObject({ phase: "push" });
    expect(linear.issues.get(linkOf(t.id, "linear")!.external_id)!.title).toBe("Half edited");
  });

  it("/sync/push with every provider failing answers 500", async () => {
    const t = store.addHaroldTask({ title: "Nowhere" });
    await post(appWith(deps({ providers: () => [tdo] })), "/sync/push", { task_id: t.id });
    store.editInHarold(t.id, { title: "Nowhere edited" });
    td.failNext = { status: 500, error: "boom" };
    expect((await post(appWith(deps({ providers: () => [tdo] })), "/sync/push", { task_id: t.id })).status).toBe(500);
  });

  it("/sync/catchup runs each provider on its own cursor; one failing does not stop the other", async () => {
    store.state.set("linear", { cursor: new Date(clock.t - 1000).toISOString(), detail: {} });
    linear.put({ title: "From Linear" });
    td.put({ content: "From Todoist" });
    clock.tick(60_000);
    const res = await post(appWith(deps()), "/sync/catchup");
    const j = await res.json() as { ok: boolean; results: Record<string, { counts: { pulled: number; created: number } }> };
    expect(j.ok).toBe(true);
    expect(j.results.linear.counts.pulled).toBe(1);
    expect(j.results.todoist.counts.pulled).toBe(1);
    // Each task also went to the other tool, created by that provider's push phase.
    expect(j.results.todoist.counts.created + j.results.linear.counts.created).toBeGreaterThanOrEqual(1);
    expect(store.state.get("linear")!.cursor).toMatch(/^2026-/);
    expect(store.state.get("linear")!.detail).not.toHaveProperty("cursor_token");
    expect(store.state.get("todoist")!.detail.cursor_token).toMatch(/^tok-/);

    clock.tick(60_000);
    linear.put({ title: "Second from Linear" });
    clock.tick(60_000);
    td.failNext = { status: 503, error: "down" };
    const r2 = await post(appWith(deps()), "/sync/catchup");
    expect(r2.status).toBe(200);
    const j2 = await r2.json() as { ok: boolean; results: Record<string, { counts?: { pulled: number }; error?: string }> };
    expect(j2.ok).toBe(false);
    expect(j2.results.linear.counts!.pulled).toBe(1);
    expect(j2.results.todoist.error).toMatch(/HTTP 503/);
    expect(store.logs.some(l => l.kind === "error" && l.provider === "todoist" && l.detail.phase === "catchup")).toBe(true);
  });

  it("/sync/catchup {provider} runs one provider; {import, provider} imports from one; an unknown name is 400", async () => {
    linear.put({ title: "Linear open" });
    td.put({ content: "Todoist open" });
    const app = appWith(deps());
    const r = await post(app, "/sync/catchup", { import: true, provider: "todoist" });
    const j = await r.json() as Record<string, unknown>;
    expect(j).toMatchObject({ ok: true, import: true, counts: { imported: 1 }, results: { todoist: { counts: { imported: 1 } } } });
    expect(j.results).not.toHaveProperty("linear");
    expect(linear.calls.some(c => c.query.includes("issues("))).toBe(false);
    expect((await post(app, "/sync/catchup", { provider: "asana" })).status).toBe(400);
  });

  it("a change from Linear's webhook goes on to Todoist straight away, and nothing echoes back to Linear", async () => {
    const i = linear.put({ title: "Hooked in Linear" });
    const body = JSON.stringify({ action: "create", type: "Issue", data: { id: i.id, team: { key: "ENG" } }, webhookTimestamp: clock.t });
    const res = await appWith(deps()).request("/webhooks/linear", { method: "POST", headers: { "linear-signature": createHmac("sha256", LINEAR_SECRET).update(body).digest("hex") }, body });
    const j = await res.json() as { results: { outcome: string }[]; fanout: Record<string, { outcome: string }[]> };
    expect(j.results[0].outcome).toBe("pulled");
    expect(j.fanout.todoist[0].outcome).toBe("created");
    const taskId = derivedTaskId("linear", i.id);
    expect(td.tasks.get(linkOf(taskId, "todoist")!.external_id)!.content).toBe("Hooked in Linear");
    // The row is still Linear's own change: Linear's next catchup has nothing to push.
    linear.calls = [];
    clock.tick(60_000);
    await post(appWith(deps()), "/sync/catchup", { provider: "linear" });
    expect(linear.calls.some(c => c.query.includes("issueUpdate") || c.query.includes("issueCreate"))).toBe(false);
  });

  it("an edit pulled from Todoist reaches Linear; neither side echoes it back", async () => {
    const t = store.addHaroldTask({ title: "Shared" });
    await post(appWith(deps()), "/sync/push", { task_id: t.id });
    const tdId = linkOf(t.id, "todoist")!.external_id, linId = linkOf(t.id, "linear")!.external_id;
    td.edit(tdId, { content: "Renamed in Todoist" });
    clock.tick(60_000);
    await post(appWith(deps()), "/sync/catchup", { provider: "todoist" });
    expect(store.tasks.get(t.id)).toMatchObject({ title: "Renamed in Todoist", changed_by: "todoist" });
    await post(appWith(deps()), "/sync/catchup", { provider: "linear" });
    expect(linear.issues.get(linId)!.title).toBe("Renamed in Todoist");
    td.calls = [];
    clock.tick(60_000);
    const writes = store.writes.length;
    await post(appWith(deps()), "/sync/catchup");
    expect(td.calls.some(c => c.form.commands)).toBe(false);
    expect(store.writes.length).toBe(writes);
  });
});

describe("POST /webhooks/:provider", () => {
  it("/webhooks/todoist: verified before anything else; a valid delivery imports the task with origin todoist", async () => {
    const i = td.put({ content: "Hooked in Todoist", priority: 4 });
    const touched: string[] = [];
    const app = appWith(deps({ store: () => { touched.push("store"); return store; } }));
    const bad = tdHook("item:added", i.id, "wrong-secret");
    expect((await app.request("/webhooks/todoist", { method: "POST", headers: bad.headers, body: bad.body })).status).toBe(401);
    expect(touched).toEqual([]);
    const good = tdHook("item:added", i.id);
    const res = await app.request("/webhooks/todoist", { method: "POST", headers: good.headers, body: good.body });
    expect(res.status).toBe(200);
    expect(store.tasks.get(derivedTaskId("todoist", i.id))).toMatchObject({ title: "Hooked in Todoist", priority: "high", changed_by: "todoist", source: "todoist" });
  });
  it("/webhooks/todoist item:deleted cancels the linked task", async () => {
    const t = store.addHaroldTask({ title: "To delete" });
    await post(appWith(deps({ providers: () => [tdo] })), "/sync/push", { task_id: t.id });
    const id = linkOf(t.id, "todoist")!.external_id;
    td.remove(id);
    const h = tdHook("item:deleted", id);
    const res = await appWith(deps({ providers: () => [tdo] })).request("/webhooks/todoist", { method: "POST", headers: h.headers, body: h.body });
    expect(await res.json()).toMatchObject({ ok: true, results: [{ outcome: "pulled" }] });
    expect(store.tasks.get(t.id)!.status).toBe("cancelled");
  });
  it("an unknown provider is 404; a known but unconfigured one is 503; /webhooks/linear still answers as before", async () => {
    const app = appWith(deps({ providers: () => [lin] }));
    expect((await app.request("/webhooks/nonesuch", { method: "POST", body: "{}" })).status).toBe(404);
    const h = tdHook("item:added", "x");
    expect((await app.request("/webhooks/todoist", { method: "POST", headers: h.headers, body: h.body })).status).toBe(503);
    expect((await app.request("/webhooks/linear", { method: "POST", headers: { "linear-signature": "00" }, body: "{}" })).status).toBe(401);
  });
  it("non-task Todoist events are acknowledged and ignored", async () => {
    const h = tdHook("project:added", "p1");
    const res = await appWith(deps()).request("/webhooks/todoist", { method: "POST", headers: h.headers, body: h.body });
    expect(await res.json()).toEqual({ ok: true, ignored: true });
  });
});
