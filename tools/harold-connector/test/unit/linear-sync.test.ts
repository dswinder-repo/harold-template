import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setTestEnv } from "./env.js";
import { Hono } from "hono";
import { SyncEngine, derivedTaskId } from "../../src/sync/engine.js";
import {
  LinearProvider, issueToItem, linearSignatureOk, priorityFromLinear, priorityToLinear, statusFromLinear, stateTypeFor, verifyLinearWebhook,
} from "../../src/sync/linear.js";
import { ProjectMap } from "../../src/sync/projectmap.js";
import { registerSyncRoutes, secretEquals, type SyncDeps } from "../../src/sync/routes.js";
import { localIso, renderSnapshot } from "../../src/sync/snapshot.js";
import { PROJECTS_STATE, SNAPSHOT_STATE, loadProjectCache, makeHousekeeper, maybeWriteSnapshot, refreshProjectCache } from "../../src/sync/housekeeping.js";
import type { HaroldRepo } from "../../src/github.js";
import { SupabaseSyncStore, fieldsToRow, rowToTask, supabaseClientFactory } from "../../src/sync/store.js";
import { Clock, FakeLinear, MemoryStore, PROJECTS_MD } from "./sync-fakes.js";

const SECRET = "whsec-test-0123456789";
const SYNC_SECRET = "sync-secret-abcdef";
const map = ProjectMap.fromMarkdown(PROJECTS_MD);

let clock: Clock, store: MemoryStore, linear: FakeLinear, provider: LinearProvider, engine: SyncEngine;
beforeEach(() => {
  clock = new Clock();
  store = new MemoryStore(clock);
  linear = new FakeLinear(clock);
  provider = new LinearProvider({ key: "lin_api_test", team: "ENG", webhookSecret: SECRET }, map, linear.fetch, clock.now);
  engine = new SyncEngine(store, provider, map, { teamKey: "ENG", now: clock.now });
});

const sign = (body: string, secret = SECRET) => createHmac("sha256", secret).update(body).digest("hex");
const linkOf = (taskId: string) => store.links.find(l => l.task_id === taskId)!;

// ───────────── webhook signature ─────────────

describe("Linear webhook verification", () => {
  const body = (ts: number, extra: Record<string, unknown> = {}) => JSON.stringify({ action: "update", type: "Issue", data: { id: "lin-1", updatedAt: "2026-11-18T15:00:00.000Z", team: { key: "ENG" } }, webhookTimestamp: ts, ...extra });

  it("accepts a valid signature with a fresh timestamp", () => {
    const b = body(clock.t - 5_000);
    const v = verifyLinearWebhook(b, sign(b), SECRET, clock.t);
    expect(v).toEqual({ ok: true, events: [{ action: "update", externalId: "lin-1", updatedAt: "2026-11-18T15:00:00.000Z", teamKey: "ENG" }] });
  });
  it("rejects a wrong signature, a tampered body, a missing header and a wrong secret", () => {
    const b = body(clock.t);
    expect(verifyLinearWebhook(b, sign(b, "other-secret"), SECRET, clock.t)).toMatchObject({ ok: false, status: 401 });
    expect(verifyLinearWebhook(b.replace("lin-1", "lin-2"), sign(b), SECRET, clock.t)).toMatchObject({ ok: false, status: 401 });
    expect(verifyLinearWebhook(b, null, SECRET, clock.t)).toMatchObject({ ok: false, status: 401 });
    expect(verifyLinearWebhook(b, "zz-not-hex", SECRET, clock.t)).toMatchObject({ ok: false, status: 401 });
    expect(linearSignatureOk(b, sign(b).slice(0, 10), SECRET)).toBe(false);
  });
  it("rejects a timestamp older than 60 seconds (replay) and one missing", () => {
    const old = body(clock.t - 61_000);
    expect(verifyLinearWebhook(old, sign(old), SECRET, clock.t)).toMatchObject({ ok: false, status: 401, reason: expect.stringMatching(/stale/) });
    const none = JSON.stringify({ action: "update", type: "Issue", data: { id: "x" } });
    expect(verifyLinearWebhook(none, sign(none), SECRET, clock.t)).toMatchObject({ ok: false });
  });
  it("refuses everything when no secret is configured", () => {
    const b = body(clock.t);
    expect(verifyLinearWebhook(b, sign(b, ""), "", clock.t)).toMatchObject({ ok: false, status: 503 });
  });
  it("ignores non-Issue events once verified", () => {
    const b = JSON.stringify({ action: "create", type: "Comment", data: { id: "c1" }, webhookTimestamp: clock.t });
    expect(verifyLinearWebhook(b, sign(b), SECRET, clock.t)).toEqual({ ok: true, events: [] });
  });
});

// ───────────── mapping ─────────────

describe("mapping Linear <-> Harold", () => {
  it("state types and priorities, both ways", () => {
    expect(["backlog", "unstarted", "triage", "started", "completed", "canceled"].map(statusFromLinear)).toEqual(["pending", "pending", "pending", "in_progress", "completed", "cancelled"]);
    expect((["pending", "in_progress", "completed", "cancelled"] as const).map(stateTypeFor)).toEqual(["unstarted", "started", "completed", "canceled"]);
    expect([0, 1, 2, 3, 4].map(priorityFromLinear)).toEqual(["low", "high", "high", "medium", "low"]);
    expect((["high", "medium", "low"] as const).map(priorityToLinear)).toEqual([2, 3, 4]);
  });
  it("projects: linear_project wins, then name and aliases case-insensitively; unmapped -> null", () => {
    expect(map.fromLinear("orchard labs")).toBe("Orchard");
    expect(map.fromLinear("ACMEPILOT")).toBe("Acme Pilot");
    expect(map.fromLinear("Random Linear Project")).toBeNull();
    expect(map.toLinear("Orchard")).toBe("Orchard Labs");
    expect(map.toLinear("ap")).toBe("Acme Pilot");
  });
  it("an issue becomes Harold fields", () => {
    const item = issueToItem({ id: "a", identifier: "ENG-9", url: "u", title: "Call Adam", description: "about the MOU", priority: 1, dueDate: "2026-11-20", updatedAt: "2026-11-18T15:00:00.000Z", state: { type: "started" }, project: { name: "Random Linear Project" }, team: { key: "ENG" } }, map);
    expect(item.fields).toEqual({ title: "Call Adam", notes: "about the MOU", status: "in_progress", priority: "high", due: "2026-11-20", project: null });
    expect(item).toMatchObject({ providerProject: "Random Linear Project", projectUnmapped: true, externalKey: "ENG-9" });
  });
  it("database rows: description '' <-> null, due day <-> UTC midnight, priority never written as null", () => {
    expect(fieldsToRow({ notes: null, due: "2026-11-20", priority: null })).toEqual({ description: "", due_date: "2026-11-20T00:00:00Z" });
    const t = rowToTask({ id: "x", ref: "H-1", title: "T", description: "", status: "pending", priority: "low", due_date: "2026-11-20T00:00:00+00:00", project: null, source: "harold", changed_by: "harold", updated_at: "2026-11-18T15:00:00.123456+00:00" });
    expect(t).toMatchObject({ notes: null, due: "2026-11-20" });
  });
  it("Harold -> Linear create sends mapped fields; update sends only what differs", async () => {
    const t = store.addHaroldTask({ title: "Draft deck", notes: "v1", priority: "high", due: "2026-11-25", project: "Orchard", status: "in_progress" });
    await engine.fromHarold(t);
    const create = linear.calls.find(c => c.query.includes("issueCreate"))!.variables.in as Record<string, unknown>;
    expect(create).toMatchObject({ title: "Draft deck", description: "v1", priority: 2, dueDate: "2026-11-25", stateId: "s-prog", projectId: "p-orchard", teamId: "team-1" });
    expect(create.id).toBe(linkOf(t.id).external_id);
    store.editInHarold(t.id, { due: "2026-11-26" });
    linear.calls = [];
    await engine.fromHarold((await store.getTask(t.id))!);
    const upd = linear.calls.find(c => c.query.includes("issueUpdate"))!.variables.in;
    expect(upd).toEqual({ dueDate: "2026-11-26" });
  });
  it("an urgent Linear issue is not downgraded when Harold pushes an unrelated change", async () => {
    const i = linear.put({ title: "Urgent", priority: 1 });
    await engine.fromProvider((await provider.getOne(i.id))!);
    const task = store.tasks.get(derivedTaskId("linear", i.id))!;
    expect(task.priority).toBe("high");
    store.editInHarold(task.id, { title: "Urgent!" });
    await engine.fromHarold((await store.getTask(task.id))!);
    expect(linear.issues.get(i.id)).toMatchObject({ title: "Urgent!", priority: 1 });
  });
});

// ───────────── the never-sync rule ─────────────

describe("conflict rule", () => {
  async function linked() {
    const t = store.addHaroldTask({ title: "Original", priority: "medium" });
    await engine.fromHarold(t);
    return { taskId: t.id, extId: linkOf(t.id).external_id };
  }

  it("only Harold changed: pushed to Linear, link advanced", async () => {
    const { taskId, extId } = await linked();
    const edited = store.editInHarold(taskId, { title: "Harold title" });
    const r = await engine.fromHarold(edited);
    expect(r.outcome).toBe("pushed");
    expect(linear.issues.get(extId)!.title).toBe("Harold title");
    expect(linkOf(taskId)).toMatchObject({ synced_at: edited.updated_at, external_updated_at: linear.issues.get(extId)!.updatedAt });
  });
  it("only Linear changed: pulled into Harold with origin linear, synced_at >= the row's new updated_at", async () => {
    const { taskId, extId } = await linked();
    linear.edit(extId, { title: "Linear title", state: { type: "started" } });
    const r = await engine.fromProvider((await provider.getOne(extId))!);
    expect(r.outcome).toBe("pulled");
    const t = store.tasks.get(taskId)!;
    expect(t).toMatchObject({ title: "Linear title", status: "in_progress", changed_by: "linear" });
    expect(Date.parse(linkOf(taskId).synced_at!)).toBeGreaterThanOrEqual(Date.parse(t.updated_at));
    expect(store.writes.at(-1)).toMatchObject({ op: "update", origin: "linear" });
  });
  it("every successful sync records the agreed field values (synced_fields)", async () => {
    const { taskId, extId } = await linked();
    expect(linkOf(taskId).synced_fields).toMatchObject({ title: "Original", priority: "medium", status: "pending" });
    linear.edit(extId, { title: "Renamed in Linear" });
    await engine.fromProvider((await provider.getOne(extId))!);
    expect(linkOf(taskId).synced_fields!.title).toBe("Renamed in Linear");
  });
  it("different fields changed on each side: both kept, no conflict", async () => {
    const { taskId, extId } = await linked();
    store.editInHarold(taskId, { due: "2026-11-30" });
    linear.edit(extId, { title: "Linear title" });
    const r = await engine.fromProvider((await provider.getOne(extId))!);
    expect(r.outcome).toBe("merged");
    expect(store.tasks.get(taskId)).toMatchObject({ title: "Linear title", due: "2026-11-30" });
    expect(linear.issues.get(extId)).toMatchObject({ title: "Linear title", dueDate: "2026-11-30" });
    expect(store.logs.some(l => l.kind === "conflict")).toBe(false);
    expect(linkOf(taskId).synced_fields).toMatchObject({ title: "Linear title", due: "2026-11-30" });
  });
  it("same field changed on both sides, Linear later: Linear's value wins; other changes still merge", async () => {
    const { taskId, extId } = await linked();
    store.editInHarold(taskId, { title: "Harold edit", priority: "high" });
    linear.edit(extId, { title: "Linear edit" }); // later on the clock
    const r = await engine.fromProvider((await provider.getOne(extId))!);
    expect(r).toMatchObject({ outcome: "conflict", winner: "provider", fields: ["title"] });
    expect(store.tasks.get(taskId)).toMatchObject({ title: "Linear edit", priority: "high" });
    expect(linear.issues.get(extId)).toMatchObject({ title: "Linear edit", priority: 2 });
    const c = store.logs.find(l => l.kind === "conflict")!;
    expect(c.detail).toMatchObject({ rule: "field", fields: [{ field: "title", harold: "Harold edit", linear: "Linear edit", base: "Original", winner: "linear" }] });
  });
  it("same field changed on both sides, Harold later: Harold's value wins and is pushed", async () => {
    const { taskId, extId } = await linked();
    linear.edit(extId, { title: "Linear edit" });
    const h = store.editInHarold(taskId, { title: "Harold edit" }); // later on the clock
    const r = await engine.fromHarold(h);
    expect(r).toMatchObject({ outcome: "conflict", winner: "harold", fields: ["title"] });
    expect(linear.issues.get(extId)!.title).toBe("Harold edit");
    expect(store.tasks.get(taskId)!.title).toBe("Harold edit");
    expect(store.logs.find(l => l.kind === "conflict")!.detail).toMatchObject({ fields: [{ field: "title", winner: "harold" }] });
  });
  it("both sides made the same change: no conflict", async () => {
    const { taskId, extId } = await linked();
    store.editInHarold(taskId, { title: "Same", due: "2026-12-01" });
    linear.edit(extId, { title: "Same" });
    const r = await engine.fromProvider((await provider.getOne(extId))!);
    expect(r.outcome).toBe("pushed");
    expect(linear.issues.get(extId)!.dueDate).toBe("2026-12-01");
    expect(store.logs.some(l => l.kind === "conflict")).toBe(false);
  });
  describe("links without synced_fields (first sync) use the whole-version rule", () => {
    const strip = (taskId: string) => { linkOf(taskId).synced_fields = null; };
    it("Linear later: Linear's whole version wins", async () => {
      const { taskId, extId } = await linked();
      strip(taskId);
      store.editInHarold(taskId, { title: "Harold edit", due: "2026-11-30" });
      linear.edit(extId, { title: "Linear edit" });
      const r = await engine.fromProvider((await provider.getOne(extId))!);
      expect(r).toMatchObject({ outcome: "conflict", winner: "provider" });
      expect(store.tasks.get(taskId)).toMatchObject({ title: "Linear edit", due: null });
      expect(store.logs.find(l => l.kind === "conflict")!.detail).toMatchObject({ rule: "whole-version", winner: "linear", harold: { title: "Harold edit" }, linear: { title: "Linear edit" } });
      expect(linkOf(taskId).synced_fields).toMatchObject({ title: "Linear edit" });
    });
    it("Harold later: Harold's whole version wins", async () => {
      const { taskId, extId } = await linked();
      strip(taskId);
      linear.edit(extId, { title: "Linear edit" });
      const h = store.editInHarold(taskId, { title: "Harold edit" });
      const r = await engine.fromHarold(h);
      expect(r).toMatchObject({ outcome: "conflict", winner: "harold" });
      expect(linear.issues.get(extId)!.title).toBe("Harold edit");
      expect(store.logs.find(l => l.kind === "conflict")!.detail).toMatchObject({ rule: "whole-version", winner: "harold" });
    });
  });
  it("Linear remove cancels an open task and never deletes it", async () => {
    const { taskId, extId } = await linked();
    const r = await engine.remove(extId, clock.iso());
    expect(r.outcome).toBe("pulled");
    expect(store.tasks.get(taskId)).toMatchObject({ status: "cancelled", changed_by: "linear" });
    expect(store.tasks.size).toBe(1);
  });
});

// ───────────── echo safety ─────────────

describe("echo safety", () => {
  it("/sync/push skips rows the sync itself wrote (changed_by != harold)", async () => {
    const i = linear.put({ title: "From Linear" });
    await engine.fromProvider((await provider.getOne(i.id))!);
    const t = (await store.getTask(derivedTaskId("linear", i.id)))!;
    expect(t.changed_by).toBe("linear");
    linear.calls = [];
    expect((await engine.fromHarold(t)).outcome).toBe("skipped");
    expect(linear.calls).toHaveLength(0);
  });
  it("Linear's webhook for our own push is a no-op (no write to Harold, no conflict)", async () => {
    const t = store.addHaroldTask({ title: "Mine" });
    await engine.fromHarold(t);
    const ext = linkOf(t.id).external_id;
    const writes = store.writes.length;
    // The webhook for the issue we just created arrives.
    expect((await engine.webhook([{ action: "create", externalId: ext, updatedAt: null, teamKey: "ENG" }]))[0].outcome).toBe("unchanged");
    expect(store.writes.length).toBe(writes);
    expect(store.logs.some(l => l.kind === "conflict")).toBe(false);
  });
  it("a webhook that arrives while our create is still in flight waits instead of importing a twin", async () => {
    const t = store.addHaroldTask({ title: "Racing" });
    await store.insertLink({ task_id: t.id, provider: "linear", external_id: "lin-race", external_key: null, external_url: null, external_updated_at: null, synced_at: null });
    linear.put({ title: "Racing" }, "lin-race");
    const r = await engine.webhook([{ action: "create", externalId: "lin-race", updatedAt: null, teamKey: "ENG" }]);
    expect(r[0].outcome).toBe("pending");
    expect(store.tasks.size).toBe(1);
  });
  it("issues from another team are ignored", async () => {
    linear.put({ title: "Other team", team: { key: "OPS" } }, "lin-ops");
    expect((await engine.webhook([{ action: "update", externalId: "lin-ops", updatedAt: null, teamKey: "OPS" }]))[0].outcome).toBe("skipped");
    expect(store.tasks.size).toBe(0);
  });
});

// ───────────── import and catchup ─────────────

describe("first import", () => {
  beforeEach(() => {
    linear.put({ title: "Open one", project: { name: "Acme Pilot" } });
    linear.put({ title: "Open unmapped", project: { name: "Random Linear Project" } });
    linear.put({ title: "Done recently", state: { type: "completed" }, completedAt: new Date(clock.t - 5 * 86_400_000).toISOString() });
    linear.put({ title: "Done long ago", state: { type: "completed" }, completedAt: new Date(clock.t - 60 * 86_400_000).toISOString() });
  });
  it("brings open + recently completed issues with links and 'import' logs; unmapped project is logged", async () => {
    const r = await engine.catchup({ import: true });
    expect(r.counts.imported).toBe(3);
    expect([...store.tasks.values()].map(t => t.title).sort()).toEqual(["Done recently", "Open one", "Open unmapped"]);
    expect(store.links).toHaveLength(3);
    expect(store.logs.filter(l => l.kind === "import")).toHaveLength(3);
    const unmapped = store.logs.find(l => l.kind === "import" && l.detail.title === "Open unmapped")!;
    expect(unmapped.detail).toMatchObject({ linear_project: "Random Linear Project", unmapped_project: true, project: null });
    expect([...store.tasks.values()].find(t => t.title === "Open one")!.project).toBe("Acme Pilot");
    expect(store.state.get("linear")!.detail.imported_at).toBeTruthy();
  });
  it("is idempotent: a second import creates nothing and writes nothing", async () => {
    await engine.catchup({ import: true });
    const writes = store.writes.length;
    const r = await engine.catchup({ import: true });
    expect(r.counts.imported).toBe(0);
    expect(r.counts.unchanged).toBe(3);
    expect(store.tasks.size).toBe(3);
    expect(store.links).toHaveLength(3);
    expect(store.writes.length).toBe(writes);
  });
  it("a run that died between the task and its link is repaired, not duplicated", async () => {
    const i = [...linear.issues.values()][0];
    await store.insertTask((await provider.getOne(i.id))!.fields, "linear", derivedTaskId("linear", i.id));
    await engine.catchup({ import: true });
    expect(store.tasks.size).toBe(3);
    expect(store.links.filter(l => l.external_id === i.id)).toHaveLength(1);
  });
});

describe("catchup", () => {
  it("pulls Linear changes since the cursor (all pages), pushes missed Harold changes, and advances the cursor", async () => {
    store.state.set("linear", { cursor: new Date(clock.t - 1000).toISOString(), detail: {} });
    linear.put({ title: "A" }); linear.put({ title: "B" }); linear.put({ title: "C" }); // 3 issues, page size 2
    const h = store.addHaroldTask({ title: "Made in Harold, trigger missed" });
    clock.tick(60_000);
    const r1 = await engine.catchup();
    expect(r1.counts).toMatchObject({ pulled: 3, created: 1, errors: 0 });
    expect(linkOf(h.id).external_key).toMatch(/^ENG-/);
    const c1 = store.state.get("linear")!.cursor!;
    expect(Date.parse(c1)).toBeGreaterThan(Date.parse(r1.previousCursor!));
    expect(Date.parse(c1)).toBeLessThanOrEqual(clock.t - 5_000);

    // Nothing new: no writes, cursor holds.
    clock.tick(60_000);
    const writes = store.writes.length;
    const r2 = await engine.catchup();
    expect(r2.counts.pulled + r2.counts.created + r2.counts.pushed).toBe(0);
    expect(store.writes.length).toBe(writes);

    // One edit in Linear: only that one is pulled, and the cursor moves past it.
    const e = linear.edit([...linear.issues.keys()][0], { title: "A edited" });
    clock.tick(60_000);
    const r3 = await engine.catchup();
    expect(r3.counts.pulled).toBe(1);
    expect(Date.parse(store.state.get("linear")!.cursor!)).toBeGreaterThanOrEqual(Date.parse(e.updatedAt));
  });
  it("does not push completed Harold tasks that were never linked", async () => {
    store.addHaroldTask({ title: "Old done", status: "completed" });
    clock.tick(60_000);
    await engine.catchup();
    expect(linear.calls.some(c => c.query.includes("issueCreate"))).toBe(false);
  });
  it("recovers a create that never reached Linear", async () => {
    const t = store.addHaroldTask({ title: "Lost create" });
    await store.insertLink({ task_id: t.id, provider: "linear", external_id: "never-made", external_key: null, external_url: null, external_updated_at: null, synced_at: null });
    clock.tick(60_000);
    const r = await engine.catchup();
    expect(r.counts.created).toBe(1);
    expect(store.links.filter(l => l.task_id === t.id)).toHaveLength(1);
    expect(linkOf(t.id).external_id).not.toBe("never-made");
  });
});

// ───────────── snapshot ─────────────

describe("tasks snapshot", () => {
  // The snapshot is written in the owner's time zone (HAROLD_TZ); these tests use a fixed one.
  beforeEach(() => { setTestEnv({ HAROLD_TZ: "America/New_York" }); });
  afterEach(() => { setTestEnv(); });
  it("groups open tasks by day in the owner's time zone with the header", () => {
    const now = Date.parse("2026-11-18T15:00:00Z"); // 10:00 in the test time zone
    const base = { notes: null, priority: "medium" as const, project: "Acme Pilot", source: "harold", changed_by: "harold", updated_at: "x" };
    const text = renderSnapshot([
      { ...base, id: "1", ref: "H-1", title: "Late", status: "pending", due: "2026-11-17" },
      { ...base, id: "2", ref: "H-2", title: "Today", status: "pending", due: "2026-11-18" },
      { ...base, id: "3", ref: "H-3", title: "Friday", status: "pending", due: "2026-11-20" },
      { ...base, id: "4", ref: "H-4", title: "Doing", status: "in_progress", due: null },
      { ...base, id: "5", ref: "H-5", title: "Someday", status: "pending", due: null },
      { ...base, id: "6", ref: "H-6", title: "Finished", status: "completed", due: "2026-11-17" },
    ], [{ task_id: "3", provider: "linear", external_id: "e", external_key: "ENG-3", external_url: "https://linear.app/x/issue/ENG-3", external_updated_at: null, synced_at: null }], now);
    expect(text).toContain("*Written 2026-11-18T10:00:00-05:00 by the connector sync.*");
    const sec = (h: string) => text.split(`## ${h}`)[1].split("##")[0];
    expect(sec("Overdue")).toContain("Late");
    expect(sec("Due today")).toContain("Today");
    expect(sec("Due this week")).toContain("[ENG-3](https://linear.app/x/issue/ENG-3)");
    expect(sec("In progress")).toContain("Doing");
    expect(sec("Later")).toContain("Someday");
    expect(text).not.toContain("Finished");
    expect(localIso(Date.parse("2026-07-01T12:00:00Z"))).toBe("2026-07-01T08:00:00-04:00");
  });
});

// ───────────── Supabase store: one client per origin ─────────────

describe("Supabase writes carry x-harold-origin", () => {
  it("task writes from Linear send x-harold-origin: linear", async () => {
    const seen: { url: string; method: string; origin: string | null; body: unknown }[] = [];
    const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const h = new Headers(init?.headers);
      seen.push({ url: String(input), method: init?.method || "GET", origin: h.get("x-harold-origin"), body: init?.body ? JSON.parse(String(init.body)) : null });
      const row = { id: "t1", ref: "H-1", title: "T", description: "", status: "pending", priority: "medium", due_date: null, project: null, source: "linear", changed_by: "linear", updated_at: "2026-11-18T15:00:00+00:00" };
      return new Response(JSON.stringify(row), { status: 201, headers: { "Content-Type": "application/json" } });
    };
    const s = new SupabaseSyncStore(supabaseClientFactory("https://db.example.supabase.co", "service-key", fakeFetch as typeof fetch));
    await s.updateTask("t1", { title: "T" }, "linear");
    await s.insertTask({ title: "T", notes: null, status: "pending", priority: "medium", due: null, project: null }, "linear", "t1");
    expect(seen.map(x => x.origin)).toEqual(["linear", "linear"]);
    expect(seen[1].body).toMatchObject({ id: "t1", source: "linear", description: "" });
  });
});

// ───────────── routes ─────────────

describe("routes", () => {
  const deps = (over: Partial<SyncDeps> = {}): SyncDeps => ({
    store: () => store, linear: () => ({ key: "k", team: "ENG", webhookSecret: SECRET }), projects: async () => ({ map, readAt: clock.iso(), stale: false }),
    housekeeping: async () => undefined, syncSecret: () => SYNC_SECRET, now: clock.now, provider: () => provider, ...over,
  });
  const appWith = (d: SyncDeps) => { const a = new Hono(); registerSyncRoutes(a, d); return a; };

  it("secretEquals is exact", () => {
    expect(secretEquals(SYNC_SECRET, SYNC_SECRET)).toBe(true);
    expect(secretEquals(SYNC_SECRET + "x", SYNC_SECRET)).toBe(false);
    expect(secretEquals("", "")).toBe(false);
  });
  it("/sync/push and /sync/catchup need the sync secret", async () => {
    const app = appWith(deps());
    expect((await app.request("/sync/push", { method: "POST", body: "{}" })).status).toBe(401);
    expect((await app.request("/sync/catchup", { method: "POST", headers: { "x-harold-sync-secret": "wrong" } })).status).toBe(401);
    expect((await app.request("/sync/push", { method: "GET" })).status).toBe(404);
  });
  it("/sync/push creates the Linear issue and its link", async () => {
    const t = store.addHaroldTask({ title: "Via route" });
    const res = await appWith(deps()).request("/sync/push", { method: "POST", headers: { "x-harold-sync-secret": SYNC_SECRET, "Content-Type": "application/json" }, body: JSON.stringify({ task_id: t.id }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, outcome: "created" });
    expect(linkOf(t.id).external_key).toMatch(/^ENG-/);
  });
  it("fails closed when there is no cached project map: nothing is pushed", async () => {
    const t = store.addHaroldTask({ title: "Anything?", project: "Side Project" });
    const res = await appWith(deps({ projects: async () => null })).request("/sync/push", { method: "POST", headers: { "x-harold-sync-secret": SYNC_SECRET }, body: JSON.stringify({ task_id: t.id }) });
    expect(res.status).toBe(503);
    expect(linear.calls).toHaveLength(0);
  });
  it("/webhooks/linear: bad signature 401; valid create upserts into Harold with origin linear", async () => {
    const app = appWith(deps());
    const i = linear.put({ title: "Hooked", priority: 2 });
    const body = JSON.stringify({ action: "create", type: "Issue", data: { id: i.id, team: { key: "ENG" } }, webhookTimestamp: clock.t });
    expect((await app.request("/webhooks/linear", { method: "POST", headers: { "linear-signature": sign(body, "nope") }, body })).status).toBe(401);
    const res = await app.request("/webhooks/linear", { method: "POST", headers: { "linear-signature": sign(body) }, body });
    expect(res.status).toBe(200);
    expect(store.tasks.get(derivedTaskId("linear", i.id))).toMatchObject({ title: "Hooked", priority: "high", changed_by: "linear", source: "linear" });
  });
  it("/sync/catchup returns counts and advances the cursor", async () => {
    linear.put({ title: "New in Linear" });
    clock.tick(60_000);
    const res = await appWith(deps()).request("/sync/catchup", { method: "POST", headers: { "x-harold-sync-secret": SYNC_SECRET } });
    const j = await res.json() as { ok: boolean; counts: { pulled: number }; cursor: string };
    expect(j).toMatchObject({ ok: true, counts: { pulled: 1 } });
    expect(store.state.get("linear")!.cursor).toBe(j.cursor);
  });
});

// ───────────── housekeeping: project-map cache and snapshot ─────────────

class FakeRepo {
  files = new Map<string, string>([["harold/projects.md", PROJECTS_MD]]);
  reads = 0; commits: string[] = [];
  async getText(path: string) { this.reads++; const t = this.files.get(path); return t === undefined ? null : { text: t, sha: "x" }; }
  async commit(path: string, mutate: (c: unknown) => { text: string }, message: string) {
    const { text } = mutate(null); this.files.set(path, text); this.commits.push(message); return { ok: true as const, commit: "c", attempts: 1, text };
  }
}
const asRepo = (r: FakeRepo) => r as unknown as HaroldRepo;

describe("project-map cache (filled by authenticated requests)", () => {
  it("is written from harold/projects.md, at most every 10 minutes, and resolves the same projects", async () => {
    const repo = new FakeRepo();
    expect(await refreshProjectCache(store, asRepo(repo), clock.t)).toBe("written");
    expect(await refreshProjectCache(store, asRepo(repo), clock.t + 5 * 60_000)).toBe("fresh");
    expect(repo.reads).toBe(1);
    const st = store.state.get(PROJECTS_STATE)!;
    expect(st.detail.projects).toContainEqual({ name: "Orchard", aliases: ["Orchard Labs"], folder: "orchard/", linear_project: "Orchard Labs" });
    const cached = (await loadProjectCache(store, clock.t))!;
    expect(cached.stale).toBe(false);
    expect(cached.map.fromLinear("Orchard Labs")).toBe("Orchard");
    expect(cached.map.toLinear("ap")).toBe("Acme Pilot");
  });
  it("no cache: null (the routes fail closed); older than 7 days: still used but flagged stale", async () => {
    expect(await loadProjectCache(store, clock.t)).toBeNull();
    await refreshProjectCache(store, asRepo(new FakeRepo()), clock.t);
    expect((await loadProjectCache(store, clock.t + 8 * 86_400_000))!.stale).toBe(true);
  });
  it("a stale cache is used by the routes and logged as skip", async () => {
    await refreshProjectCache(store, asRepo(new FakeRepo()), clock.t - 8 * 86_400_000);
    const app = new Hono();
    registerSyncRoutes(app, {
      store: () => store, linear: () => ({ key: "k", team: "ENG", webhookSecret: SECRET }), projects: s => loadProjectCache(s, clock.t),
      housekeeping: async () => undefined, syncSecret: () => SYNC_SECRET, now: clock.now, provider: () => provider,
    });
    const res = await app.request("/sync/catchup", { method: "POST", headers: { "x-harold-sync-secret": SYNC_SECRET } });
    expect(res.status).toBe(200);
    expect(store.logs.find(l => l.kind === "skip")?.detail.reason).toMatch(/older than 7 days/);
  });
});

describe("tasks snapshot (written on authenticated requests)", () => {
  it("writes when the open tasks changed, never twice within 30 minutes, and not when nothing changed", async () => {
    const repo = new FakeRepo();
    store.addHaroldTask({ title: "First" });
    expect(await maybeWriteSnapshot(store, asRepo(repo), clock.t)).toEqual({ written: true });
    expect(repo.files.get("harold/tasks-snapshot.md")).toContain("First");
    store.addHaroldTask({ title: "Second" });
    expect((await maybeWriteSnapshot(store, asRepo(repo), clock.t + 10 * 60_000)).reason).toMatch(/30 minutes/);
    expect((await maybeWriteSnapshot(store, asRepo(repo), clock.t + 31 * 60_000)).written).toBe(true);
    expect((await maybeWriteSnapshot(store, asRepo(repo), clock.t + 70 * 60_000)).reason).toMatch(/unchanged/);
    expect(repo.commits).toHaveLength(2);
    expect(store.state.get(SNAPSHOT_STATE)!.detail.hash).toMatch(/^[0-9a-f]{64}$/);
  });
  it("the per-request housekeeper is rate-limited and never throws", async () => {
    const repo = new FakeRepo();
    const hk = makeHousekeeper(() => store, clock.now);
    await hk(asRepo(repo));
    await hk(asRepo(repo));
    expect(repo.reads).toBe(1);
    const broken = { getText: async () => { throw new Error("GitHub down"); }, commit: async () => { throw new Error("GitHub down"); } } as unknown as HaroldRepo;
    clock.tick(120_000);
    await expect(makeHousekeeper(() => store, clock.now)(broken)).resolves.toBeUndefined();
  });
});
