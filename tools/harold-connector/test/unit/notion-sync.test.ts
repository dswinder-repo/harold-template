import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { PENDING_RECOVER_MS, SyncEngine, isPlaceholder, placeholderId } from "../../src/sync/engine.js";
import {
  CURSOR_OVERLAP_MS, NOTION_VERSION, NotionProvider, buildSetup, notionEntry, notionEvents, notionSignatureOk, notionSyncFromEnv, pageKey,
  pageToItem, propertiesFor, proposeFields, statusFromNotion, statusOption, verificationToken, verifyNotionWebhook,
  type DataSource, type NotionPage, type NotionSetup, type NotionSyncConfig,
} from "../../src/sync/notion.js";
import { notionIdFrom, setupNotion } from "../../src/sync/notion-setup.js";
import { ProjectMap } from "../../src/sync/projectmap.js";
import type { ProviderEntry } from "../../src/sync/provider.js";
import { providersFromEnv } from "../../src/sync/registry.js";
import { registerSyncRoutes, type SyncDeps } from "../../src/sync/routes.js";
import { TodoistProvider, todoistEntry } from "../../src/sync/todoist.js";
import { Clock, MemoryStore } from "./sync-fakes.js";
import { FakeTodoist, TODOIST_PROJECTS_MD } from "./todoist-fakes.js";
import { DB_ID, DS, DS_ID, FakeNotion, NOTION_PROJECTS_MD, nfixture } from "./notion-fakes.js";

const map = ProjectMap.fromMarkdown(NOTION_PROJECTS_MD);
const TOKEN = "example-verification-token-0001";
const cfg: NotionSyncConfig = { token: "ntn_test", webhookSecret: "" };
const SETUP = buildSetup(DS, DB_ID, {}, () => Date.parse("2026-11-18T12:00:00Z")).setup!;

let clock: Clock, store: MemoryStore, notion: FakeNotion, provider: NotionProvider, engine: SyncEngine;
const make = (setup: NotionSetup = SETUP, c: NotionSyncConfig = cfg) => {
  provider = new NotionProvider(c, setup, map, notion.fetch, clock.now);
  engine = new SyncEngine(store, provider, map, { teamKey: null, now: clock.now });
};
beforeEach(() => {
  clock = new Clock();
  store = new MemoryStore(clock);
  notion = new FakeNotion(clock);
  make();
});
const linkOf = (taskId: string) => store.links.find(l => l.task_id === taskId && l.provider === "notion")!;
const sign = (body: string, secret = TOKEN) => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
const ctx = () => ({ store: () => store });

// ───────────── configuration ─────────────

describe("Notion configuration", () => {
  it("needs NOTION_TOKEN; NOTION_WEBHOOK_SECRET is optional; the registry adds Notion last", () => {
    const keep = { ...process.env };
    try {
      for (const k of ["NOTION_TOKEN", "NOTION_WEBHOOK_SECRET", "LINEAR_API_KEY", "LINEAR_TEAM_KEY", "TODOIST_API_TOKEN", "ASANA_ACCESS_TOKEN", "ASANA_WORKSPACE"]) delete process.env[k];
      expect(notionSyncFromEnv()).toBeNull();
      process.env.NOTION_TOKEN = " ntn ";
      expect(notionSyncFromEnv()).toEqual({ token: "ntn", webhookSecret: "" });
      process.env.NOTION_WEBHOOK_SECRET = "s";
      expect(notionSyncFromEnv()).toEqual({ token: "ntn", webhookSecret: "s" });
      process.env.TODOIST_API_TOKEN = "t";
      expect(providersFromEnv(notion.fetch).map(e => e.name)).toEqual(["todoist", "notion"]);
    } finally { process.env = keep; }
  });

  it("pins the API version on every request", async () => {
    notion.put({ title: "x" });
    await provider.listChangedSince(new Date(clock.t - 3_600_000).toISOString());
    expect(NOTION_VERSION).toBe("2026-03-11");
    expect(notion.calls.every(c => c.version === "2026-03-11")).toBe(true);
    expect(notion.calls[0].path).toBe(`/data_sources/${DS_ID}/query`);
  });
});

// ───────────── setup proposal and validation ─────────────

describe("the live test database (fixtures recorded 2026-11-18, ids redacted)", () => {
  const LIVE_DS = nfixture<DataSource>("data-source-live.json");
  const LIVE_PAGE = nfixture<NotionPage>("page-live.json");
  it("a Priority select with no options is set up as High / Medium / Low (Notion adds an option on first write)", () => {
    const b = buildSetup(LIVE_DS, LIVE_DS.parent!.database_id!, {}, clock.now);
    expect(b.problems).toEqual([]);
    const s = b.setup!;
    expect(s.fields).toEqual({ title: "Name", status: "Status", due: "Due", priority: "Priority", notes: null, project: null });
    expect(s.status_map).toEqual({ pending: "Not started", in_progress: "In progress", completed: "Done", cancelled: null });
    expect(s.priority_map).toEqual({ high: "High", medium: "Medium", low: "Low" });
    expect(s.priority_in).toEqual({ High: "high", Medium: "medium", Low: "low" });
    expect(b.notes.some(n => n.includes("Priority has no options yet"))).toBe(true);
    // What Harold writes, and how it reads back.
    expect(propertiesFor({ title: "T", notes: null, status: "pending", priority: "high", due: null, project: null }, s, map).properties.Priority).toEqual({ select: { name: "High" } });
    expect(priorityOf({ ...LIVE_PAGE, properties: { ...LIVE_PAGE.properties, Priority: { type: "select", select: { name: "High" } } } }, s)).toBe("high");
    // Naming a new option for an empty select is accepted rather than refused.
    expect(buildSetup(LIVE_DS, "db", { priority_map: { high: "P1" } }, clock.now).setup!.priority_map.high).toBe("P1");
  });
  it("reads the recorded page: parent carries both data_source_id and database_id, Priority empty", () => {
    const s = buildSetup(LIVE_DS, LIVE_DS.parent!.database_id!, {}, clock.now).setup!;
    const item = pageToItem(LIVE_PAGE, s, map)!;
    expect(item.fields).toEqual({ title: "Live test mwmrk6uf", notes: null, status: "pending", priority: null, due: "2026-11-25", project: null });
    expect(item.unmapped).toEqual(["notes", "project"]);
    // last_edited_time is minute-granular on the live service.
    expect(LIVE_PAGE.last_edited_time).toMatch(/:00\.000Z$/);
  });
});
const priorityOf = (p: NotionPage, s: NotionSetup) => pageToItem(p, s, map)!.fields.priority;

describe("setup: proposal from the data source schema", () => {
  it("proposes every field and the status and priority options from names and Status groups", () => {
    expect(proposeFields(DS)).toEqual({ title: "Title", status: "Status", due: "Due date", priority: "Priority", notes: "Notes", project: "Project" });
    const s = SETUP;
    expect(s).toMatchObject({ database_id: DB_ID, data_source_id: DS_ID, name: "Tasks", status_type: "status" });
    expect(s.status_map).toEqual({ pending: "Not started", in_progress: "In progress", completed: "Done", cancelled: "Cancelled" });
    // Unmapped options read by their Status group.
    expect(s.status_in).toEqual({ "Not started": "pending", Backlog: "pending", "In progress": "in_progress", "In review": "in_progress", Done: "completed", Cancelled: "cancelled" });
    expect(s.priority_map).toEqual({ high: "High", medium: "Medium", low: "Low" });
    expect(s.priority_in).toEqual({ High: "high", Medium: "medium", Low: "low", "Urgent 🔥": "high" });
  });

  it("overrides are checked against the real properties and options", () => {
    const bad = buildSetup(DS, DB_ID, { fields: { due: "Deadline", notes: "Assignee", priority: "Project" }, status_map: { completed: "Shipped" } });
    expect(bad.setup).toBeNull();
    expect(bad.problems.join("\n")).toMatch(/no property called "Deadline"/);
    expect(bad.problems.join("\n")).toMatch(/"Assignee" is a people property; notes needs a rich_text property/);
    expect(bad.problems.join("\n")).toMatch(/"Project" is chosen for two fields/);
    expect(bad.problems.join("\n")).toMatch(/"Shipped" is not an option of Status/);
  });

  it("optional fields can be left out, and say what is not synced; a missing done option is a problem", () => {
    const b = buildSetup(DS, DB_ID, { fields: { notes: "none", project: null }, status_map: { cancelled: "none" } });
    expect(b.setup!.fields).toMatchObject({ notes: null, project: null });
    expect(b.notes.join("\n")).toMatch(/notes are not synced/);
    expect(b.notes.join("\n")).toMatch(/cancelled Harold task is written as "Done"/);
    expect(buildSetup(DS, DB_ID, { status_map: { completed: null } }).problems.join("\n")).toMatch(/No option of Status was chosen for "completed"/);
  });

  it("a Select status property is proposed by name, and its unmapped options read as pending", () => {
    const ds: DataSource = { object: "data_source", id: "ds-2", title: [{ plain_text: "Todo list" }], properties: {
      Name: { id: "title", name: "Name", type: "title" },
      State: { id: "st", name: "State", type: "select", select: { options: [{ name: "Todo" }, { name: "Doing" }, { name: "Done" }, { name: "Waiting" }] } },
    } };
    const b = buildSetup(ds, "db-2");
    expect(b.setup!.fields).toMatchObject({ title: "Name", status: "State", due: null, priority: null });
    expect(b.setup!.status_type).toBe("select");
    expect(b.setup!.status_map).toEqual({ pending: "Todo", in_progress: "Doing", completed: "Done", cancelled: null });
    expect(b.setup!.status_in.Waiting).toBe("pending");
    const none = buildSetup({ ...ds, properties: { Name: ds.properties.Name } }, "db-2");
    expect(none.problems.join("\n")).toMatch(/No Status or Select property/);
  });
});

// ───────────── mapping ─────────────

describe("mapping Notion <-> Harold", () => {
  it("the documented page object becomes Harold fields", () => {
    const item = pageToItem(nfixture<NotionPage>("page.json"), SETUP, map)!;
    expect(item.fields).toEqual({ title: "Bug bash", notes: null, status: "pending", priority: null, due: "2023-02-23", project: null });
    expect(item).toMatchObject({
      externalId: "be633bf1-dfa0-436d-b259-571129a590e5", externalKey: "NO-29a590e5", updatedAt: "2023-03-08T18:25:00.000Z",
      externalUrl: "https://app.notion.com/p/Bug-bash-be633bf1dfa0436db259571129a590e5", removed: false, teamKey: null, projectUnmapped: false,
    });
    expect(item.unmapped).toBeUndefined();
    expect(pageKey("be633bf1-dfa0-436d-b259-571129a590e5")).toBe("NO-29a590e5");
    // Pages of one workspace share the start of their ids (seen live): the key must still tell them apart.
    expect(pageKey("41df7011-d660-81e1-940d-f4ae83558a54")).not.toBe(pageKey("41df7011-d660-8182-930c-e39fad901f05"));
  });

  it("every supported property type, both ways", () => {
    const p = notion.put({ title: "Ship it", status: "In review", due: "2026-12-01", priority: "Urgent 🔥", notes: "line one\nline two", project: "Orchard Labs" });
    const item = pageToItem(p, SETUP, map)!;
    expect(item.fields).toEqual({ title: "Ship it", notes: "line one\nline two", status: "in_progress", priority: "high", due: "2026-12-01", project: "Orchard" });
    const { properties } = propertiesFor({ title: "New", notes: "n", status: "cancelled", priority: "low", due: "2026-12-24", project: "Orchard" }, SETUP, map);
    expect(properties).toEqual({
      Title: { title: [{ type: "text", text: { content: "New" } }] }, Notes: { rich_text: [{ type: "text", text: { content: "n" } }] },
      Status: { status: { name: "Cancelled" } }, "Due date": { date: { start: "2026-12-24" } }, Priority: { select: { name: "Low" } }, Project: { select: { name: "Orchard Labs" } },
    });
    // A Select status property writes {select}; a datetime start is read as its day; long notes are split at 2000.
    const sel = { ...SETUP, status_type: "select" as const };
    expect(propertiesFor({ title: "t", notes: null, status: "pending", priority: null, due: null, project: null }, sel, map).properties.Status).toEqual({ select: { name: "Not started" } });
    notion.edit(p.id, x => { x.properties["Due date"] = { type: "date", date: { start: "2026-12-01T09:30:00.000-05:00" } }; });
    expect(pageToItem(notion.pages.get(p.id)!, SETUP, map)!.fields.due).toBe("2026-12-01");
    const long = propertiesFor({ title: "t", notes: "x".repeat(4500), status: "pending", priority: null, due: null, project: null }, SETUP, map).properties.Notes as { rich_text: unknown[] };
    expect(long.rich_text).toHaveLength(3);
  });

  it("an update sends only the fields whose mapped value differs", () => {
    const item = pageToItem(notion.put({ title: "A", status: "Done", priority: "High", project: "Acme Pilot" }), SETUP, map)!;
    const r = propertiesFor({ ...item.fields, title: "B", due: "2026-12-02" }, SETUP, map, item);
    expect(r.changed).toEqual(["title", "due"]);
    expect(Object.keys(r.properties)).toEqual(["Title", "Due date"]);
    // Clearing the due date and the project.
    const item2 = pageToItem(notion.put({ title: "A", due: "2026-12-02", project: "Acme Pilot" }), SETUP, map)!;
    expect(propertiesFor({ ...item2.fields, due: null, project: null }, SETUP, map, item2).properties).toEqual({ "Due date": { date: null }, Project: { select: null } });
  });

  it("unmapped status options: by Status group, else pending; options added later read as pending", () => {
    const noCancel = buildSetup(DS, DB_ID, { status_map: { cancelled: null, in_progress: null } }).setup!;
    expect(noCancel.status_in.Cancelled).toBe("completed"); // Complete group
    expect(noCancel.status_in["In progress"]).toBe("in_progress"); // In progress group
    expect(statusFromNotion("Someday", SETUP)).toBe("pending");
    expect(statusFromNotion(null, SETUP)).toBe("pending");
    expect(statusFromNotion("done", SETUP)).toBe("completed"); // case-insensitive
    // A Harold status without an option of its own is written as the nearest one.
    expect(statusOption("cancelled", noCancel)).toBe("Done");
    expect(statusOption("in_progress", noCancel)).toBe("Not started");
  });

  it("cancelled written as Done is not re-sent while Notion already shows Done", () => {
    const noCancel = buildSetup(DS, DB_ID, { status_map: { cancelled: null } }).setup!;
    const item = pageToItem(notion.put({ title: "A", status: "Done" }), noCancel, map)!;
    expect(propertiesFor({ ...item.fields, status: "cancelled" }, noCancel, map, item).changed).toEqual([]);
  });

  it("priority: an empty Notion priority is not filled with Harold's default; a real change is sent", () => {
    const item = pageToItem(notion.put({ title: "A" }), SETUP, map)!;
    expect(item.fields.priority).toBeNull();
    expect(propertiesFor({ ...item.fields, priority: "medium" }, SETUP, map, item).changed).toEqual([]);
    expect(propertiesFor({ ...item.fields, priority: "high" }, SETUP, map, item).properties).toEqual({ Priority: { select: { name: "High" } } });
  });

  it("project via notion_project:, and a Notion project unknown to Harold is never cleared", () => {
    const item = pageToItem(notion.put({ title: "A", project: "Side gig" }), SETUP, map)!;
    expect(item).toMatchObject({ providerProject: "Side gig", projectUnmapped: true });
    expect(item.fields.project).toBeNull();
    expect(propertiesFor({ ...item.fields, project: null }, SETUP, map, item).changed).toEqual([]);
    expect(propertiesFor({ ...item.fields, project: "Harold" }, SETUP, map, item).properties).toEqual({ Project: { select: { name: "Harold" } } });
  });

  it("fields the owner did not map are unmapped: the engine keeps Harold's own values", async () => {
    const lean = buildSetup(DS, DB_ID, { fields: { notes: "none", due: "none", priority: "none", project: "none" } }).setup!;
    make(lean);
    const p = notion.put({ title: "Lean", notes: "ignored" });
    expect(pageToItem(p, lean, map)!.unmapped).toEqual(["due", "priority", "notes", "project"]);
    await engine.catchup({ import: true });
    const t = [...store.tasks.values()][0];
    store.editInHarold(t.id, { notes: "Harold's notes", due: "2026-12-12", project: "Acme Pilot" });
    clock.tick(120_000);
    notion.setStatus(p.id, "In progress");
    clock.tick(1000);
    await engine.catchup();
    const after = store.tasks.get(t.id)!;
    expect(after).toMatchObject({ status: "in_progress", notes: "Harold's notes", due: "2026-12-12", project: "Acme Pilot" });
    expect(Object.keys(notion.calls.filter(c => c.method === "PATCH").at(-1)?.body?.properties as object ?? {})).not.toContain("Notes");
  });
});

// ───────────── reading ─────────────

describe("reading from Notion", () => {
  it("listChangedSince: last_edited_time filter one minute before the cursor, ascending, every page", async () => {
    for (let i = 0; i < 5; i++) { notion.put({ title: `T${i}` }); clock.tick(61_000); }
    const cursor = new Date(clock.t - 3 * 61_000).toISOString();
    const items = await provider.listChangedSince(cursor);
    const queries = notion.calls.filter(c => c.path.endsWith("/query"));
    expect(queries.length).toBeGreaterThan(1); // page size 2 in the fake
    expect(queries[0].body).toMatchObject({
      filter: { timestamp: "last_edited_time", last_edited_time: { on_or_after: new Date(Date.parse(cursor) - CURSOR_OVERLAP_MS).toISOString() } },
      sorts: [{ timestamp: "last_edited_time", direction: "ascending" }], page_size: 100,
    });
    expect(queries[1].body).toMatchObject({ start_cursor: "cur-2" });
    const from = Date.parse(cursor) - CURSOR_OVERLAP_MS;
    const want = [...notion.pages.values()].filter(p => Date.parse(p.last_edited_time) >= from).map(p => notion.title(p.id));
    expect(want.length).toBeGreaterThan(2);
    expect(items.map(i => i.fields.title)).toEqual(want);
    // The minute before the cursor is included: a page stamped in that minute is re-read rather than missed.
    expect(items.some(i => Date.parse(i.updatedAt) < Date.parse(cursor))).toBe(true);
  });

  it("listForImport: open pages plus finished ones edited within the window", async () => {
    notion.put({ title: "Old done", status: "Done" });
    clock.tick(40 * 86_400_000);
    notion.put({ title: "Open" });
    notion.put({ title: "Recent done", status: "Done" });
    const items = await provider.listForImport(30);
    expect(items.map(i => i.fields.title).sort()).toEqual(["Open", "Recent done"]);
  });

  it("getOne: a trashed or archived page is removed; outside the data source or unknown is not found", async () => {
    const p = notion.put({ title: "Gone" });
    notion.trash(p.id);
    expect((await provider.getOne(p.id))!.removed).toBe(true);
    const a = notion.put({ title: "Archived" });
    notion.edit(a.id, x => { x.is_archived = true; });
    expect((await provider.getOne(a.id))!.removed).toBe(true);
    const other = notion.put({ title: "Elsewhere", dataSource: "99999999-0000-0000-0000-000000000000" });
    expect(await provider.getOne(other.id)).toBeNull();
    expect(await provider.getOne("00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  it("a page trashed in Notion cancels its open Harold task", async () => {
    const p = notion.put({ title: "To trash" });
    await engine.catchup({ import: true });
    const t = [...store.tasks.values()][0];
    clock.tick(120_000);
    notion.trash(p.id);
    expect(await engine.webhook([{ action: "update", externalId: p.id, updatedAt: null, teamKey: null }])).toMatchObject([{ outcome: "pulled" }]);
    expect(store.tasks.get(t.id)!.status).toBe("cancelled");
  });

  it("an edit in the same minute as the last sync is still seen (coarse last_edited_time)", async () => {
    clock.t = Date.parse("2026-11-18T15:00:05Z");
    const p = notion.put({ title: "Same minute" });
    await engine.catchup({ import: true });
    const t = [...store.tasks.values()][0];
    clock.tick(20_000); // still 15:00
    notion.setStatus(p.id, "In progress");
    expect(notion.pages.get(p.id)!.last_edited_time).toBe(linkOf(t.id).external_updated_at);
    await engine.webhook([{ action: "update", externalId: p.id, updatedAt: null, teamKey: null }]);
    expect(store.tasks.get(t.id)!.status).toBe("in_progress");
  });
});

// ───────────── writing ─────────────

describe("writing to Notion", () => {
  it("a Harold task is created under the data source and its link re-keyed to the page id", async () => {
    const t = store.addHaroldTask({ title: "From Harold", status: "in_progress", priority: "high", due: "2026-12-05", project: "Orchard", notes: "n" });
    expect(await engine.fromHarold(t)).toMatchObject({ outcome: "created" });
    const post = notion.calls.find(c => c.method === "POST" && c.path === "/pages")!;
    expect(post.body!.parent).toEqual({ type: "data_source_id", data_source_id: DS_ID });
    const link = linkOf(t.id);
    expect(isPlaceholder(link.external_id)).toBe(false);
    expect(link.external_key).toBe(pageKey(link.external_id));
    const page = notion.pages.get(link.external_id)!;
    expect(pageToItem(page, SETUP, map)!.fields).toEqual({ title: "From Harold", notes: "n", status: "in_progress", priority: "high", due: "2026-12-05", project: "Orchard" });
    // The echo of our own create changes nothing.
    expect(await engine.webhook([{ action: "create", externalId: page.id, updatedAt: null, teamKey: null }])).toMatchObject([{ outcome: "unchanged" }]);
  });

  it("a create retried under the same placeholder returns the page already made (no twin)", async () => {
    const key = placeholderId(clock.now());
    const fields = { title: "Once", notes: null, status: "pending" as const, priority: null, due: null, project: null };
    const a = await provider.create(fields, key);
    clock.tick(PENDING_RECOVER_MS + 1000);
    const b = await provider.create(fields, key);
    expect(b.externalId).toBe(a.externalId);
    expect([...notion.pages.values()].filter(p => notion.title(p.id) === "Once")).toHaveLength(1);
    // A different placeholder made later is a new create.
    clock.tick(120_000);
    const c = await provider.create(fields, placeholderId(clock.now()));
    expect(c.externalId).not.toBe(a.externalId);
  });

  it("a Harold edit patches only the changed properties", async () => {
    const t = store.addHaroldTask({ title: "Edit me" });
    await engine.fromHarold(t);
    clock.tick(5000);
    const t2 = store.editInHarold(t.id, { status: "completed", due: "2026-12-31" });
    expect(await engine.fromHarold(t2)).toMatchObject({ outcome: "pushed" });
    const patch = notion.calls.filter(c => c.method === "PATCH").at(-1)!;
    expect(patch.body).toEqual({ properties: { Status: { status: { name: "Done" } }, "Due date": { date: { start: "2026-12-31" } } } });
  });

  it("Notion's error answers carry the HTTP status (a 4xx create drops the placeholder link)", async () => {
    const t = store.addHaroldTask({ title: "Refused" });
    notion.failNext = { status: 400, code: "validation_error", message: "nope" };
    expect(await engine.fromHarold(t)).toMatchObject({ outcome: "error" });
    expect(store.logs.at(-1)!.detail.error).toMatch(/HTTP 400 validation_error: nope/);
    expect(linkOf(t.id)).toBeUndefined();
  });
});

// ───────────── webhook ─────────────

describe("Notion webhook", () => {
  const body = nfixture<object>("webhook-page-properties-updated.json");
  const raw = JSON.stringify(body);

  it("signature: sha256=<hex HMAC-SHA256 of the raw body>, constant-time, anything else refused", () => {
    expect(notionSignatureOk(raw, sign(raw), TOKEN)).toBe(true);
    expect(notionSignatureOk(raw, sign(raw).toUpperCase().replace("SHA256", "sha256"), TOKEN)).toBe(true);
    expect(notionSignatureOk(raw, sign(raw, "other"), TOKEN)).toBe(false);
    expect(notionSignatureOk(raw + " ", sign(raw), TOKEN)).toBe(false);
    expect(notionSignatureOk(raw, sign(raw).slice(7), TOKEN)).toBe(false);
    expect(notionSignatureOk(raw, null, TOKEN)).toBe(false);
    expect(notionSignatureOk(raw, sign(raw), "")).toBe(false);
  });

  it("a signed verification request is still recognised by its body", async () => {
    const v = JSON.stringify(nfixture("webhook-verification.json"));
    await setupNotion({ webhook: "expect" }, { store: () => store, fetch: notion.fetch, now: clock.now, config: () => cfg });
    expect(await verifyNotionWebhook(v, "sha256=00", cfg, ctx(), clock.now())).toEqual({ ok: true, events: [] });
    expect(store.state.get("notion")!.detail.webhook).toMatchObject({ token: TOKEN });
  });

  it("the verification token is refused unless the owner expects one, then stored (never logged)", async () => {
    const v = JSON.stringify(nfixture("webhook-verification.json"));
    expect(verificationToken(v)).toBe(TOKEN);
    expect(verificationToken(JSON.stringify({ verification_token: TOKEN, x: 1 }))).toBe(TOKEN);
    expect(verificationToken(JSON.stringify({ verification_token: TOKEN, type: "page.created" }))).toBeNull();
    expect(await verifyNotionWebhook(v, null, cfg, ctx(), clock.now())).toMatchObject({ ok: false, status: 403 });
    await setupNotion({ webhook: "expect" }, { store: () => store, fetch: notion.fetch, now: clock.now, config: () => cfg });
    expect(await verifyNotionWebhook(v, null, cfg, ctx(), clock.now())).toEqual({ ok: true, events: [] });
    expect(store.state.get("notion")!.detail.webhook).toMatchObject({ token: TOKEN });
    expect(JSON.stringify(store.logs)).not.toContain(TOKEN);
    // The window closes with the token's arrival: a second one is refused.
    expect(await verifyNotionWebhook(JSON.stringify({ verification_token: "secret_attacker_000" }), null, cfg, ctx(), clock.now())).toMatchObject({ ok: false, status: 403 });
    // Window expired.
    await setupNotion({ webhook: "expect" }, { store: () => store, fetch: notion.fetch, now: clock.now, config: () => cfg });
    clock.tick(31 * 60_000);
    expect(await verifyNotionWebhook(v, null, cfg, ctx(), clock.now())).toMatchObject({ ok: false, status: 403 });
    // No signature and not a verification request.
    expect(await verifyNotionWebhook(raw, null, cfg, ctx(), clock.now())).toMatchObject({ ok: false, status: 401 });
  });

  it("events are checked with the stored token, or NOTION_WEBHOOK_SECRET when set", async () => {
    expect(await verifyNotionWebhook(raw, sign(raw), cfg, ctx(), clock.now())).toMatchObject({ ok: false, status: 503 });
    store.state.set("notion", { cursor: null, detail: { setup: SETUP, webhook: { token: TOKEN } } });
    expect(await verifyNotionWebhook(raw, sign(raw), cfg, ctx(), clock.now())).toEqual({
      ok: true, events: [{ action: "update", externalId: "153104cd-477e-809d-8dc4-ff2d96ae3090", updatedAt: "2024-12-05T23:57:05.379Z", teamKey: null }],
    });
    expect(await verifyNotionWebhook(raw, sign(raw, "forged"), cfg, ctx(), clock.now())).toMatchObject({ ok: false, status: 401 });
    const env = { ...cfg, webhookSecret: "env-secret" };
    expect(await verifyNotionWebhook(raw, sign(raw, "env-secret"), env, { store: () => null }, clock.now())).toMatchObject({ ok: true });
    expect(await verifyNotionWebhook(raw, sign(raw), env, ctx(), clock.now())).toMatchObject({ ok: false, status: 401 });
  });

  it("event types: created/updated/deleted; other data sources and other events are dropped", () => {
    expect(notionEvents(JSON.stringify(nfixture("webhook-page-created.json")), SETUP)).toMatchObject({ ok: true, events: [{ action: "create" }] });
    expect(notionEvents(JSON.stringify(nfixture("webhook-page-deleted.json")), SETUP)).toMatchObject({ ok: true, events: [{ action: "remove", externalId: "153104cd-477e-8001-935c-c4b11828dfbd" }] });
    const other = { ...body, data: { parent: { id: "x", type: "database", data_source_id: "99999999-0000-0000-0000-000000000000" } } };
    expect(notionEvents(JSON.stringify(other), SETUP)).toEqual({ ok: true, events: [] });
    expect(notionEvents(JSON.stringify({ ...body, type: "comment.created" }), SETUP)).toEqual({ ok: true, events: [] });
    expect(notionEvents(JSON.stringify({ ...body, type: "page.locked" }), SETUP)).toEqual({ ok: true, events: [] });
    expect(notionEvents("not json", SETUP)).toMatchObject({ ok: false, status: 400 });
  });
});

// ───────────── routes ─────────────

describe("routes with Notion", () => {
  const SYNC_SECRET = "sync-secret-abcdef";
  let td: FakeTodoist, tdo: ProviderEntry, nEntry: ProviderEntry;
  const tmap = ProjectMap.fromMarkdown(TODOIST_PROJECTS_MD);
  beforeEach(() => {
    td = new FakeTodoist(clock);
    const tp = new TodoistProvider({ token: "td-token", project: null, clientSecret: "c" }, tmap, td.fetch, clock.now);
    tdo = { ...todoistEntry({ token: "td-token", project: null, clientSecret: "c" }, td.fetch, clock.now), build: () => tp };
    nEntry = notionEntry(cfg, notion.fetch, clock.now);
  });
  const deps = (providers: ProviderEntry[]): SyncDeps => ({
    store: () => store, providers: () => providers, projects: async () => ({ map, readAt: clock.iso(), stale: false }),
    housekeeping: async () => undefined, syncSecret: () => SYNC_SECRET, now: clock.now,
  });
  const appWith = (d: SyncDeps) => { const a = new Hono(); registerSyncRoutes(a, d); return a; };
  const post = (app: Hono, path: string, b: unknown = {}, headers: Record<string, string> = { "x-harold-sync-secret": SYNC_SECRET }) =>
    app.request(path, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: typeof b === "string" ? b : JSON.stringify(b) });

  it("not set up: push and catchup skip Notion with a clear reason; the other providers run", async () => {
    const app = appWith(deps([tdo, nEntry]));
    const t = store.addHaroldTask({ title: "Only Todoist" });
    const j = await (await post(app, "/sync/push", { task_id: t.id })).json() as { ok: boolean; results: Record<string, { outcome: string; reason?: string }> };
    expect(j.ok).toBe(true);
    expect(j.results.todoist.outcome).toBe("created");
    expect(j.results.notion).toMatchObject({ outcome: "skipped", reason: expect.stringMatching(/not set up yet/) });
    const c = await (await post(app, "/sync/catchup")).json() as { ok: boolean; results: Record<string, unknown> };
    expect(c.ok).toBe(true);
    expect(c.results.notion).toEqual({ skipped: expect.stringMatching(/sync_setup_notion/) });
    // Notion alone and not set up: still a 200 that says why.
    const only = await post(appWith(deps([nEntry])), "/sync/catchup");
    expect(only.status).toBe(200);
    expect(await only.json()).toMatchObject({ ok: true, skipped: expect.stringMatching(/not set up/) });
  });

  it("set up: catchup imports pages; the webhook handshake and a signed event go through /webhooks/notion", async () => {
    store.state.set("notion", { cursor: null, detail: { setup: SETUP } });
    const p = notion.put({ title: "In Notion" });
    const app = appWith(deps([nEntry]));
    const c = await (await post(app, "/sync/catchup", { import: true })).json() as { counts: { imported: number } };
    expect(c.counts.imported).toBe(1);
    expect(store.state.get("notion")!.detail.setup).toBeTruthy(); // catchup keeps the setup

    const v = JSON.stringify({ verification_token: TOKEN });
    expect((await post(app, "/webhooks/notion", v, {})).status).toBe(403);
    await setupNotion({ webhook: "expect" }, { store: () => store, fetch: notion.fetch, now: clock.now, config: () => cfg });
    const ok = await post(app, "/webhooks/notion", v, {});
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, ignored: true });

    clock.tick(120_000);
    notion.setStatus(p.id, "Done");
    const ev = JSON.stringify({ type: "page.properties_updated", timestamp: clock.iso(), entity: { id: p.id, type: "page" }, data: { parent: { id: DB_ID, type: "database", data_source_id: DS_ID } } });
    expect((await post(app, "/webhooks/notion", ev, { "x-notion-signature": sign(ev, "wrong") })).status).toBe(401);
    const r = await post(app, "/webhooks/notion", ev, { "x-notion-signature": sign(ev) });
    expect(await r.json()).toMatchObject({ ok: true, results: [{ outcome: "pulled" }] });
    expect([...store.tasks.values()][0].status).toBe("completed");
  });
});

// ───────────── the setup tool ─────────────

describe("sync_setup_notion", () => {
  const run = (args: Parameters<typeof setupNotion>[0], c: NotionSyncConfig | null = cfg) =>
    setupNotion(args, { store: () => store, fetch: notion.fetch, now: clock.now, config: () => c, baseUrl: () => "https://hc.example.com" });

  it("without NOTION_TOKEN it says how to connect", async () => {
    expect(await run({}, null)).toMatchObject({ isError: true, text: expect.stringMatching(/set NOTION_TOKEN/) });
  });

  it("no arguments: lists the shared databases and proposes a mapping for the only one; nothing is saved", async () => {
    const r = await run({});
    expect(r.text).toMatch(/not set up yet/);
    expect(r.text).toMatch(`1. Tasks (data source ${DS_ID}, database ${DB_ID})`);
    expect(r.text).toMatch(/Proposed mapping for Tasks \(not saved yet\)/);
    expect(r.text).toMatch(/Harold "done \(completed\)" is written as: "Done"/);
    expect(r.text).toMatch(/Webhook: not set up/);
    expect(store.state.get("notion")).toBeUndefined();
  });

  it("database by name, id or URL: proposal first, saved only with confirm", async () => {
    expect(notionIdFrom(`https://www.notion.so/me/Tasks-${DB_ID.replace(/-/g, "")}?v=0123456789abcdef0123456789abcdef`)).toBe(DB_ID);
    const p = await run({ database: "tasks" });
    expect(p.text).toMatch(/not saved yet/);
    expect(store.state.get("notion")).toBeUndefined();
    const byUrl = await run({ database: `https://www.notion.so/me/Tasks-${DB_ID.replace(/-/g, "")}?v=0123456789abcdef0123456789abcdef`, fields: { project: "none" }, confirm: true });
    expect(byUrl.text).toMatch(/^Saved\./);
    expect(byUrl.text).toMatch(/Project: not synced/);
    expect(byUrl.text).toMatch(/"provider": "notion"/);
    const saved = store.state.get("notion")!.detail.setup as NotionSetup;
    expect(saved).toMatchObject({ data_source_id: DS_ID, database_id: DB_ID, fields: { project: null } });
    const again = await run({});
    expect(again.text).toMatch(/Current setup:/);
  });

  it("a bad mapping is refused with the reasons and the real properties", async () => {
    const r = await run({ database: DS_ID, fields: { due: "Assignee" }, confirm: true });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/"Assignee" is a people property; due needs a date property/);
    expect(r.text).toMatch(/Its properties: Title \(title\), Status \(status\)/);
    expect(store.state.get("notion")).toBeUndefined();
    expect(await run({ database: "Nope" })).toMatchObject({ isError: true, text: expect.stringMatching(/No database called "Nope".*Shared: "Tasks"/s) });
    expect(await run({ database: "00000000-0000-0000-0000-000000000000" })).toMatchObject({ isError: true, text: expect.stringMatching(/Connections/) });
  });

  it("webhook: expect, then reveal the token once it arrived; erased once NOTION_WEBHOOK_SECRET holds it", async () => {
    expect(await run({ webhook: "reveal_token" })).toMatchObject({ isError: true, text: expect.stringMatching(/No verification token has arrived/) });
    const e = await run({ webhook: "expect" });
    expect(e.text).toMatch("https://hc.example.com/webhooks/notion");
    await verifyNotionWebhook(JSON.stringify({ verification_token: TOKEN }), null, cfg, ctx(), clock.now());
    expect((await run({})).text).toMatch(/a verification token arrived/);
    const r = await run({ webhook: "reveal_token" });
    expect(r.text).toContain(TOKEN);
    expect(r.text).toMatch(/Verify form/);
    await run({}, { ...cfg, webhookSecret: TOKEN });
    expect((store.state.get("notion")!.detail.webhook as { token?: string }).token).toBeUndefined();
    expect((await run({ webhook: "reveal_token" }, { ...cfg, webhookSecret: TOKEN })).text).toMatch(/already in NOTION_WEBHOOK_SECRET/);
  });
});
