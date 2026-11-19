import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { PENDING_RECOVER_MS, SyncEngine, derivedTaskId, isPlaceholder, placeholderId } from "../../src/sync/engine.js";
import { ProjectMap } from "../../src/sync/projectmap.js";
import {
  CANCELLED_LABEL, IN_PROGRESS_LABEL, TODOIST_WEBHOOK_MAX_AGE_MS, TodoistProvider, commandUuid, labelsFor, priorityFromTodoist, priorityToTodoist,
  statusFromTodoist, taskToItem, todoistSignatureOk, todoistSyncFromEnv, verifyTodoistWebhook, type TodoistTask,
} from "../../src/sync/todoist.js";
import { Clock, MemoryStore } from "./sync-fakes.js";
import { FakeTodoist, INBOX, TODOIST_PROJECTS_MD, fixture } from "./todoist-fakes.js";

const CLIENT_SECRET = "todoist-client-secret-0123";
const map = ProjectMap.fromMarkdown(TODOIST_PROJECTS_MD);
const ORCHARD = "6Orchard0000000", ACME = "6AcmePilot00000", HAROLD = "6Harold00000000";

let clock: Clock, store: MemoryStore, td: FakeTodoist, provider: TodoistProvider, engine: SyncEngine;
const setup = (project: string | null = null) => {
  provider = new TodoistProvider({ token: "td-token", project, clientSecret: CLIENT_SECRET }, map, td.fetch, clock.now);
  engine = new SyncEngine(store, provider, map, { teamKey: project, now: clock.now });
};
beforeEach(() => {
  clock = new Clock();
  store = new MemoryStore(clock);
  td = new FakeTodoist(clock);
  setup();
});

const sign = (body: string, secret = CLIENT_SECRET) => createHmac("sha256", secret).update(body).digest("base64");
const linkOf = (taskId: string) => store.links.find(l => l.task_id === taskId && l.provider === "todoist")!;
const commands = () => td.calls.filter(c => c.form.commands).flatMap(c => JSON.parse(c.form.commands) as { type: string; uuid: string; temp_id?: string; args: Record<string, unknown> }[]);

// ───────────── configuration ─────────────

describe("Todoist configuration", () => {
  it("needs TODOIST_API_TOKEN; TODOIST_PROJECT and TODOIST_CLIENT_SECRET are optional", () => {
    const keep = { ...process.env };
    try {
      delete process.env.TODOIST_API_TOKEN; delete process.env.TODOIST_PROJECT; delete process.env.TODOIST_CLIENT_SECRET;
      expect(todoistSyncFromEnv()).toBeNull();
      process.env.TODOIST_API_TOKEN = " tok ";
      expect(todoistSyncFromEnv()).toEqual({ token: "tok", project: null, clientSecret: "" });
      process.env.TODOIST_PROJECT = "Harold"; process.env.TODOIST_CLIENT_SECRET = "s";
      expect(todoistSyncFromEnv()).toEqual({ token: "tok", project: "Harold", clientSecret: "s" });
    } finally { process.env = keep; }
  });
});

// ───────────── mapping ─────────────

describe("mapping Todoist <-> Harold", () => {
  it("the documented task object becomes Harold fields", () => {
    const item = taskToItem(fixture<TodoistTask>("task.json"), "Inbox", map, false);
    expect(item.fields).toEqual({ title: "Buy Milk", notes: null, status: "pending", priority: "low", due: null, project: null });
    expect(item).toMatchObject({
      externalId: "6X7rM8997g3RQmvh", externalKey: "TD-6X7rM8997g3RQmvh", externalUrl: "https://app.todoist.com/app/task/6X7rM8997g3RQmvh",
      updatedAt: "2025-01-21T21:28:43Z", providerProject: "Inbox", projectUnmapped: true, teamKey: null, removed: false,
    });
    expect(item.extra).toMatchObject({ labels: ["Food", "Shopping"], projectId: "6Jf8VQXxpwv56VQ7", checked: false });
  });
  it("a documented completed task: p1, due date, description, mapped project", () => {
    const t = fixture<{ items: TodoistTask[] }>("completed-by-completion-date.json").items[0];
    const item = taskToItem(t, "Acme Pilot", map, false);
    expect(item.fields).toEqual({ title: "Buy milk", notes: "Pick up organic milk", status: "completed", priority: "high", due: "2025-02-10", project: "Acme Pilot" });
    expect(item.projectUnmapped).toBe(false);
  });
  it("status: checked and the two status labels, both ways; other labels are kept", () => {
    expect(statusFromTodoist(false, [])).toBe("pending");
    expect(statusFromTodoist(false, ["In-Progress"])).toBe("in_progress");
    expect(statusFromTodoist(true, ["errands"])).toBe("completed");
    expect(statusFromTodoist(true, ["cancelled"])).toBe("cancelled");
    expect(labelsFor("in_progress", ["errands"])).toEqual(["errands", IN_PROGRESS_LABEL]);
    expect(labelsFor("cancelled", ["errands", "in-progress"])).toEqual(["errands", CANCELLED_LABEL]);
    expect(labelsFor("completed", ["in-progress", "cancelled"])).toEqual([]);
    expect(labelsFor("pending", ["errands"])).toEqual(["errands"]);
  });
  it("priority: API 4/3 -> high, 2 -> medium, 1 -> low; Harold high -> 3, medium -> 2, low -> 1", () => {
    expect([4, 3, 2, 1, null].map(priorityFromTodoist)).toEqual(["high", "high", "medium", "low", "low"]);
    expect((["high", "medium", "low"] as const).map(priorityToTodoist)).toEqual([3, 2, 1]);
  });
  it("a due date with a time keeps its day; todoist_project wins in the project map", () => {
    const item = taskToItem({ id: "x", content: "T", due: { date: "2026-11-20T10:00:00" } }, "Orchard Labs", map, false);
    expect(item.fields).toMatchObject({ due: "2026-11-20", project: "Orchard" });
    expect(map.toProvider("todoist", "Orchard")).toBe("Orchard Labs");
    expect(map.fromProvider("todoist", "orchard labs")).toBe("Orchard");
  });
  it("the project-map cache keeps todoist_project", () => {
    const cache = map.toCache();
    expect(cache.find(c => c.name === "Orchard")).toEqual({ name: "Orchard", aliases: ["Orchard"], folder: "orchard/", linear_project: "Orchard Labs", provider_projects: { todoist: "Orchard Labs" } });
    expect(cache.find(c => c.name === "Acme Pilot")).not.toHaveProperty("provider_projects");
    expect(ProjectMap.fromCache(cache).toProvider("todoist", "Orchard")).toBe("Orchard Labs");
  });
  it("command uuids: the engine's placeholder uuid is reused, so a retried create repeats the same command", () => {
    const ph = placeholderId(clock.t);
    expect(commandUuid(ph)).toBe(ph.split(":")[2]);
    expect(commandUuid(ph, "temp")).toBe(commandUuid(ph, "temp"));
    expect(commandUuid(ph, "temp")).not.toBe(commandUuid(ph));
    expect(commandUuid(ph, "temp")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

// ───────────── webhook ─────────────

describe("Todoist webhook verification", () => {
  const raw = JSON.stringify(fixture("webhook-item-added.json"));
  const at = Date.parse("2025-02-10T10:39:38.000000Z");

  it("accepts the documented delivery signed with the client secret (base64 HMAC-SHA256)", () => {
    expect(verifyTodoistWebhook(raw, sign(raw), CLIENT_SECRET, at + 10_000)).toEqual({
      ok: true, events: [{ action: "create", externalId: "6XR4GqQQCW6Gv9h4", updatedAt: "2025-02-10T10:39:38.000000Z", teamKey: null }],
    });
  });
  it("rejects a wrong secret, a tampered body, a hex signature and a missing header", () => {
    expect(verifyTodoistWebhook(raw, sign(raw, "other"), CLIENT_SECRET, at)).toMatchObject({ ok: false, status: 401 });
    expect(verifyTodoistWebhook(raw.replace("Buy Milk", "Buy Beer"), sign(raw), CLIENT_SECRET, at)).toMatchObject({ ok: false, status: 401 });
    expect(verifyTodoistWebhook(raw, createHmac("sha256", CLIENT_SECRET).update(raw).digest("hex"), CLIENT_SECRET, at)).toMatchObject({ ok: false, status: 401 });
    expect(verifyTodoistWebhook(raw, null, CLIENT_SECRET, at)).toMatchObject({ ok: false, status: 401 });
    expect(todoistSignatureOk(raw, sign(raw).slice(0, 20), CLIENT_SECRET)).toBe(false);
  });
  it("rejects a stale delivery (triggered_at older than the retry window) and one without triggered_at", () => {
    expect(verifyTodoistWebhook(raw, sign(raw), CLIENT_SECRET, at + 45 * 60_000)).toMatchObject({ ok: true }); // a third retry
    expect(verifyTodoistWebhook(raw, sign(raw), CLIENT_SECRET, at + TODOIST_WEBHOOK_MAX_AGE_MS + 1)).toMatchObject({ ok: false, status: 401, reason: expect.stringMatching(/stale/) });
    const none = JSON.stringify({ event_name: "item:added", event_data: { id: "x" } });
    expect(verifyTodoistWebhook(none, sign(none), CLIENT_SECRET, at)).toMatchObject({ ok: false, status: 401 });
  });
  it("refuses everything without TODOIST_CLIENT_SECRET", () => {
    expect(verifyTodoistWebhook(raw, sign(raw, ""), "", at)).toMatchObject({ ok: false, status: 503 });
  });
  it("maps item events to actions and ignores everything else once verified", () => {
    const ev = (name: string) => { const b = JSON.stringify({ event_name: name, event_data: { id: "t1", updated_at: "2026-11-18T15:00:00Z" }, triggered_at: clock.iso() }); return verifyTodoistWebhook(b, sign(b), CLIENT_SECRET, clock.t); };
    expect(ev("item:deleted")).toMatchObject({ ok: true, events: [{ action: "remove", externalId: "t1", updatedAt: "2026-11-18T15:00:00Z" }] });
    expect(ev("item:completed")).toMatchObject({ events: [{ action: "update" }] });
    expect(ev("item:uncompleted")).toMatchObject({ events: [{ action: "update" }] });
    expect(ev("note:added")).toEqual({ ok: true, events: [] });
  });
});

// ───────────── Harold -> Todoist ─────────────

describe("Harold -> Todoist", () => {
  it("creates the task through item_add with mapped fields; the placeholder link is re-keyed to Todoist's id", async () => {
    const t = store.addHaroldTask({ title: "Draft deck", notes: "v1", priority: "high", due: "2026-11-25", project: "Orchard", status: "in_progress" });
    expect((await engine.fromHarold(t)).outcome).toBe("created");
    const add = commands().find(c => c.type === "item_add")!;
    expect(add.args).toEqual({ content: "Draft deck", description: "v1", priority: 3, due: { date: "2026-11-25" }, labels: ["in-progress"], project_id: ORCHARD });
    const link = linkOf(t.id);
    expect(isPlaceholder(link.external_id)).toBe(false);
    expect(td.tasks.has(link.external_id)).toBe(true);
    expect(link).toMatchObject({ external_key: `TD-${link.external_id}`, external_url: `https://app.todoist.com/app/task/${link.external_id}`, synced_at: t.updated_at });
    expect(link.synced_fields).toMatchObject({ title: "Draft deck", status: "in_progress", project: "Orchard" });
    expect(store.logs.find(l => l.kind === "push")).toMatchObject({ provider: "todoist", external_id: link.external_id });
  });
  it("a project Todoist does not have goes to the Inbox; update sends only what differs", async () => {
    const t = store.addHaroldTask({ title: "Hobby thing", project: "Side Project" });
    await engine.fromHarold(t);
    const id = linkOf(t.id).external_id;
    expect(td.tasks.get(id)!.project_id).toBe(INBOX);
    store.editInHarold(t.id, { due: "2026-11-26" });
    td.calls = [];
    expect((await engine.fromHarold((await store.getTask(t.id))!)).outcome).toBe("pushed");
    expect(commands()).toEqual([{ type: "item_update", uuid: expect.any(String), args: { id, due: { date: "2026-11-26" } } }]);
    store.editInHarold(t.id, { due: null });
    td.calls = [];
    await engine.fromHarold((await store.getTask(t.id))!);
    expect(commands()[0].args).toEqual({ id, due: null });
    expect(td.tasks.get(id)!.due).toBeNull();
  });
  it("statuses travel as checked + labels; the owner's own labels survive", async () => {
    const t = store.addHaroldTask({ title: "Status walk" });
    await engine.fromHarold(t);
    const id = linkOf(t.id).external_id;
    td.edit(id, { labels: ["errands"] });
    await engine.fromProvider((await provider.getOne(id))!);
    const step = async (status: "pending" | "in_progress" | "completed" | "cancelled") => {
      store.editInHarold(t.id, { status });
      td.calls = [];
      await engine.fromHarold((await store.getTask(t.id))!);
      return commands().map(c => c.type);
    };
    expect(await step("in_progress")).toEqual(["item_update"]);
    expect(td.tasks.get(id)).toMatchObject({ checked: false, labels: ["errands", "in-progress"] });
    expect(await step("completed")).toEqual(["item_update", "item_complete"]);
    expect(td.tasks.get(id)).toMatchObject({ checked: true, labels: ["errands"] });
    expect(await step("cancelled")).toEqual(["item_update"]);
    expect(td.tasks.get(id)).toMatchObject({ checked: true, labels: ["errands", "cancelled"] });
    expect(await step("pending")).toEqual(["item_update", "item_uncomplete"]);
    expect(td.tasks.get(id)).toMatchObject({ checked: false, labels: ["errands"] });
    expect(store.tasks.get(t.id)!.status).toBe("pending");
  });
  it("a p1 task is not downgraded when Harold pushes an unrelated change; a project change moves it", async () => {
    const i = td.put({ content: "Urgent", priority: 4, project_id: ACME });
    await engine.fromProvider((await provider.getOne(i.id))!);
    const task = store.tasks.get(derivedTaskId("todoist", i.id))!;
    expect(task).toMatchObject({ priority: "high", project: "Acme Pilot", changed_by: "todoist", source: "todoist" });
    store.editInHarold(task.id, { title: "Urgent!", project: "Orchard" });
    await engine.fromHarold((await store.getTask(task.id))!);
    expect(td.tasks.get(i.id)).toMatchObject({ content: "Urgent!", priority: 4, project_id: ORCHARD });
    expect(commands().map(c => c.type)).toEqual(["item_update", "item_move"]);
  });
  it("a refused create (4xx) drops the placeholder link; a failed one (5xx) keeps it as the retry key", async () => {
    const a = store.addHaroldTask({ title: "Refused" });
    td.failNext = { status: 400, error: "Invalid argument value" };
    expect((await engine.fromHarold(a)).outcome).toBe("error");
    expect(store.links.filter(l => l.task_id === a.id)).toHaveLength(0);
    const b = store.addHaroldTask({ title: "Flaky" });
    td.failNext = { status: 503, error: "Service unavailable" };
    expect((await engine.fromHarold(b)).outcome).toBe("error");
    expect(isPlaceholder(linkOf(b.id).external_id)).toBe(true);
    expect(store.logs.filter(l => l.kind === "error")).toHaveLength(2);
  });
  it("a command error in sync_status is raised with its error tag", async () => {
    const errorBody = fixture<Record<string, unknown>>("sync-error-response.json");
    const p = new TodoistProvider({ token: "td-token", project: null, clientSecret: "" }, map, async (input, init) => {
      if (String(init?.body || "").includes("commands=")) {
        const uuid = JSON.parse(new URLSearchParams(String(init!.body)).get("commands")!)[0].uuid;
        const st = (errorBody.sync_status as Record<string, unknown>)["32eaa699-e9d7-47ed-91ea-e58d475791f1"];
        return new Response(JSON.stringify({ ...errorBody, sync_status: { [uuid]: st } }), { status: 200 });
      }
      return td.fetch(input, init);
    }, clock.now);
    await expect(p.create({ title: "T", notes: null, status: "pending", priority: null, due: null, project: null }, placeholderId(clock.t))).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/INVALID_TEMPID/) });
  });
  it("the documented item_add answer: temp_id_mapping gives the new id", async () => {
    const ok = fixture<{ sync_status: Record<string, string>; temp_id_mapping: Record<string, string> }>("sync-item-add-response.json");
    expect(Object.values(ok.sync_status)).toEqual(["ok"]);
    const p = new TodoistProvider({ token: "td-token", project: null, clientSecret: "" }, map, async (input, init) => {
      const cmds = new URLSearchParams(String(init?.body || "")).get("commands");
      if (cmds) {
        const c = JSON.parse(cmds)[0];
        td.put({ content: c.args.content }, "6HWcc9PJCvPjCxC9");
        return new Response(JSON.stringify({ ...ok, sync_status: { [c.uuid]: "ok" }, temp_id_mapping: { [c.temp_id]: ok.temp_id_mapping["381e601f-0ef3-4ed6-bf95-58f896d1a314"] } }), { status: 200 });
      }
      return td.fetch(input, init);
    }, clock.now);
    const item = await p.create({ title: "From docs", notes: null, status: "pending", priority: null, due: null, project: null }, placeholderId(clock.t));
    expect(item.externalId).toBe("6HWcc9PJCvPjCxC9");
  });
});

// ───────────── the placeholder-id create path ─────────────

describe("creates without a caller-chosen id", () => {
  it("a webhook for the new task that arrives before the re-key waits instead of importing a twin", async () => {
    const t = store.addHaroldTask({ title: "Racing" });
    const seen: string[] = [];
    // Todoist's webhook for the new task is handled while item_add's answer is still on its way back.
    const racing = async (input: string | URL | Request, init?: RequestInit) => {
      const res = await td.fetch(input, init);
      const cmds = new URLSearchParams(String(init?.body || "")).get("commands");
      if (cmds && JSON.parse(cmds)[0].type === "item_add") {
        const body = await res.clone().json() as { temp_id_mapping: Record<string, string> };
        const newId = Object.values(body.temp_id_mapping)[0];
        const r = await engine.webhook([{ action: "create", externalId: newId, updatedAt: null, teamKey: null }]);
        seen.push(r[0].outcome);
      }
      return res;
    };
    provider = new TodoistProvider({ token: "td-token", project: null, clientSecret: CLIENT_SECRET }, map, racing, clock.now);
    engine = new SyncEngine(store, provider, map, { teamKey: null, now: clock.now });
    expect((await engine.fromHarold(t)).outcome).toBe("created");
    expect(seen).toEqual(["pending"]);
    expect(store.tasks.size).toBe(1);
    expect(td.tasks.size).toBe(1);
    // The next delivery for it finds the re-keyed link and has nothing to do.
    const id = linkOf(t.id).external_id;
    expect((await engine.webhook([{ action: "update", externalId: id, updatedAt: null, teamKey: null }]))[0].outcome).toBe("unchanged");
  });
  it("catchup waits on a young placeholder, then re-issues the create under the same key: no second task in Todoist", async () => {
    const t = store.addHaroldTask({ title: "Crashed after create" });
    const ph = placeholderId(clock.t);
    await store.insertLink({ task_id: t.id, provider: "todoist", external_id: ph, external_key: null, external_url: null, external_updated_at: null, synced_at: null, synced_fields: null });
    await provider.create({ title: "Crashed after create", notes: null, status: "pending", priority: "medium", due: null, project: null }, ph); // made, but never recorded
    expect(td.tasks.size).toBe(1);
    store.state.set("todoist", { cursor: null, detail: { cursor_token: "tok-999" } });
    expect((await engine.fromHarold(t, { recoverStalePending: true })).outcome).toBe("pending");
    clock.tick(PENDING_RECOVER_MS + 1000);
    store.editInHarold(t.id, { title: "Crashed after create (edited)" });
    await engine.catchup();
    expect(td.tasks.size).toBe(1);
    const link = linkOf(t.id);
    expect(isPlaceholder(link.external_id)).toBe(false);
    expect(td.tasks.get(link.external_id)!.content).toBe("Crashed after create (edited)");
    expect(link.synced_at).not.toBeNull();
  });
  it("a pull of the task behind an abandoned placeholder adopts the link instead of importing a twin", async () => {
    const t = store.addHaroldTask({ title: "Abandoned" });
    const ph = placeholderId(clock.t);
    await store.insertLink({ task_id: t.id, provider: "todoist", external_id: ph, external_key: null, external_url: null, external_updated_at: null, synced_at: null, synced_fields: null });
    const made = td.put({ content: "Abandoned" });
    clock.tick(PENDING_RECOVER_MS + 1000);
    const r = await engine.fromProvider((await provider.getOne(made.id))!);
    expect(r.taskId).toBe(t.id);
    expect(store.tasks.size).toBe(1);
    expect(linkOf(t.id).external_id).toBe(made.id);
  });
  it("an unrelated new Todoist task is still imported while a create is pending", async () => {
    const t = store.addHaroldTask({ title: "Mine" });
    await store.insertLink({ task_id: t.id, provider: "todoist", external_id: placeholderId(clock.t), external_key: null, external_url: null, external_updated_at: null, synced_at: null, synced_fields: null });
    const other = td.put({ content: "Someone else's" });
    expect((await engine.fromProvider((await provider.getOne(other.id))!)).outcome).toBe("pulled");
    expect(store.tasks.size).toBe(2);
  });
});

// ───────────── Todoist -> Harold ─────────────

describe("Todoist -> Harold", () => {
  it("an edit in Todoist is pulled with origin todoist; a deletion cancels the open task and never deletes it", async () => {
    const t = store.addHaroldTask({ title: "Original" });
    await engine.fromHarold(t);
    const id = linkOf(t.id).external_id;
    td.edit(id, { content: "Edited in Todoist", labels: ["in-progress"] });
    expect((await engine.fromProvider((await provider.getOne(id))!)).outcome).toBe("pulled");
    expect(store.tasks.get(t.id)).toMatchObject({ title: "Edited in Todoist", status: "in_progress", changed_by: "todoist" });
    expect((await engine.webhook([{ action: "remove", externalId: id, updatedAt: clock.iso(), teamKey: null }]))[0].outcome).toBe("pulled");
    expect(store.tasks.get(t.id)).toMatchObject({ status: "cancelled" });
    expect(store.tasks.size).toBe(1);
  });
  it("a Todoist task deleted later is skipped on push (getOne answers 404)", async () => {
    const t = store.addHaroldTask({ title: "Gone" });
    await engine.fromHarold(t);
    td.remove(linkOf(t.id).external_id);
    store.editInHarold(t.id, { title: "Gone?" });
    expect((await engine.fromHarold((await store.getTask(t.id))!)).outcome).toBe("skipped");
    expect(store.logs.find(l => l.kind === "skip")!.detail.reason).toBe("the linked task no longer exists in Todoist");
  });
});

// ───────────── catchup: the sync_token cursor ─────────────

describe("catchup with Todoist's sync_token", () => {
  it("first run: full sync, only changes within the look-back; then incremental by token, including completions and deletions", async () => {
    clock.tick(-3 * 86_400_000);
    td.put({ content: "Old, untouched" });
    clock.tick(3 * 86_400_000);
    const a = td.put({ content: "A" }); td.put({ content: "B" });
    const r1 = await engine.catchup();
    expect(r1.counts.pulled).toBe(2);
    const st1 = store.state.get("todoist")!;
    expect(st1.detail.cursor_token).toMatch(/^tok-\d+$/);
    expect(Date.parse(st1.cursor!)).toBeLessThanOrEqual(clock.t - 5_000); // a timestamp column: when the catchup ran
    expect(td.calls.find(c => c.form.sync_token)!.form).toEqual({ sync_token: "*", resource_types: JSON.stringify(["items", "projects"]) });

    clock.tick(60_000);
    const writes = store.writes.length;
    const r2 = await engine.catchup();
    expect(r2.counts.pulled).toBe(0);
    expect(store.writes.length).toBe(writes);
    expect(td.calls.filter(c => c.form.sync_token).at(-1)!.form.sync_token).toBe(st1.detail.cursor_token);

    td.complete(a.id);
    const b = [...td.tasks.values()].find(x => x.content === "B")!;
    td.remove(b.id);
    clock.tick(60_000);
    const r3 = await engine.catchup();
    expect(r3.counts.pulled).toBe(2);
    expect(store.tasks.get(derivedTaskId("todoist", a.id))!.status).toBe("completed");
    expect(store.tasks.get(derivedTaskId("todoist", b.id))!.status).toBe("cancelled");
    expect(store.state.get("todoist")!.detail.cursor_token).not.toBe(st1.detail.cursor_token);
  });
  it("kept to one project: a deletion still cancels (the live tombstone has a placeholder project_id)", async () => {
    setup("Harold");
    const t = store.addHaroldTask({ title: "Kept to Harold" });
    expect((await engine.fromHarold(t)).outcome).toBe("created");
    const id = linkOf(t.id).external_id;
    expect(td.tasks.get(id)!.project_id).toBe(HAROLD);
    await engine.catchup();
    const tomb = td.remove(id);
    expect(tomb).toMatchObject({ project_id: "2222222222222222", updated_at: null, content: "" });
    clock.tick(60_000);
    const r = await engine.catchup();
    expect(r.counts.pulled).toBe(1);
    expect(store.tasks.get(t.id)).toMatchObject({ status: "cancelled", title: "Kept to Harold" });
    // The tombstone's epoch added_at is not taken as its time.
    expect(Date.parse(linkOf(t.id).external_updated_at!)).toBeGreaterThan(Date.parse("2000-01-01"));
  });
  it("a sync_token Todoist rejects falls back to a full sync within the look-back", async () => {
    store.state.set("todoist", { cursor: null, detail: { cursor_token: "expired-token" } });
    td.put({ content: "Recent" });
    const r = await engine.catchup();
    expect(r.counts.pulled).toBe(1);
    expect(td.calls.filter(c => c.form.sync_token).map(c => c.form.sync_token)).toEqual(["expired-token", "*"]);
    expect(store.state.get("todoist")!.detail.cursor_token).toMatch(/^tok-/);
  });
  it("pushes Harold tasks the trigger missed", async () => {
    store.state.set("todoist", { cursor: null, detail: { cursor_token: "tok-0" } });
    const h = store.addHaroldTask({ title: "Made in Harold" });
    clock.tick(60_000);
    const r = await engine.catchup();
    expect(r.counts.created).toBe(1);
    expect(td.tasks.get(linkOf(h.id).external_id)!.content).toBe("Made in Harold");
  });
});

describe("first import from Todoist", () => {
  beforeEach(() => {
    td.put({ content: "Open one", project_id: ACME });
    td.put({ content: "Open unmapped", project_id: "6Random00000000" });
    for (const d of [1, 2, 5]) { const x = td.put({ content: `Done ${d}d ago` }); td.edit(x.id, { checked: true, completed_at: new Date(clock.t - d * 86_400_000).toISOString() }); }
    const old = td.put({ content: "Done long ago" }); td.edit(old.id, { checked: true, completed_at: new Date(clock.t - 60 * 86_400_000).toISOString() });
  });
  it("brings open tasks plus those completed in the window (all pages), and seeds the sync_token", async () => {
    const r = await engine.catchup({ import: true });
    expect(r.counts.imported).toBe(5);
    expect([...store.tasks.values()].map(t => t.title).sort()).toEqual(["Done 1d ago", "Done 2d ago", "Done 5d ago", "Open one", "Open unmapped"]);
    expect(td.calls.filter(c => c.path === "/tasks/completed/by_completion_date")).toHaveLength(2); // page size 2
    expect(store.logs.find(l => l.kind === "import" && l.detail.title === "Open unmapped")!.detail).toMatchObject({ provider_project: "Random Todoist Project", todoist_project: "Random Todoist Project", unmapped_project: true });
    expect(store.state.get("todoist")!.detail).toMatchObject({ cursor_token: expect.stringMatching(/^tok-/), imported_at: expect.any(String) });
  });
  it("is idempotent", async () => {
    await engine.catchup({ import: true });
    const writes = store.writes.length;
    const r = await engine.catchup({ import: true });
    expect(r.counts.imported).toBe(0);
    expect(store.writes.length).toBe(writes);
  });
});

describe("TODOIST_PROJECT keeps the sync to one project", () => {
  beforeEach(() => setup("Harold"));
  it("imports only that project's tasks, creates new ones in it and never moves them", async () => {
    td.put({ content: "In Harold", project_id: HAROLD });
    td.put({ content: "Elsewhere", project_id: ACME });
    await engine.catchup({ import: true });
    expect([...store.tasks.values()].map(t => t.title)).toEqual(["In Harold"]);
    const completed = td.calls.find(c => c.path === "/tasks/completed/by_completion_date")!;
    expect(completed.query.project_id).toBe(HAROLD);
    const t = store.addHaroldTask({ title: "New", project: "Orchard" });
    await engine.fromHarold(t);
    const id = linkOf(t.id).external_id;
    expect(td.tasks.get(id)!.project_id).toBe(HAROLD);
    store.editInHarold(t.id, { project: "Acme Pilot", title: "New!" });
    td.calls = [];
    await engine.fromHarold((await store.getTask(t.id))!);
    expect(commands().map(c => c.type)).toEqual(["item_update"]);
    expect(td.tasks.get(id)!.project_id).toBe(HAROLD);
  });
  it("a webhook for a task in another project is ignored", async () => {
    const other = td.put({ content: "Elsewhere", project_id: ACME });
    expect((await engine.webhook([{ action: "create", externalId: other.id, updatedAt: null, teamKey: null }]))[0].outcome).toBe("skipped");
    expect(store.tasks.size).toBe(0);
  });
  it("a missing TODOIST_PROJECT is reported, not guessed", async () => {
    setup("No Such Project");
    await expect(engine.catchup()).rejects.toThrow(/TODOIST_PROJECT/);
  });
});
