import { beforeEach, describe, expect, it } from "vitest";
import * as crm from "../../src/crm.js";
import { FakeSupabase } from "./fakes.js";
import { setTestEnv } from "./env.js";

// Fictional contacts only.
let db: FakeSupabase;
const sb = () => db as unknown as crm.Sb;

beforeEach(() => {
  setTestEnv();
  db = new FakeSupabase();
  db.tables.contacts.push(
    { id: "c-ext", name: "Jane Doe", org: "Acme Corp", category: "partner", warmth: "Warm", status: "active" },
    { id: "c-team", name: "Riley Teammate", org: "Example Co", category: "team", status: "active" },
    { id: "c-label", name: "Pat Labelled", org: "Example Co", category: "other", status: "active" },
    { id: "c-dup1", name: "Sam Lee", org: "Acme", category: "investor" },
    { id: "c-dup2", name: "Sam Lee", org: "Beta Capital", category: "investor" },
  );
  db.tables.contact_categories.push({ contact_id: "c-label", category_name: "team" });
});

describe("HAROLD_NO_LOG_TYPES (optional, empty by default)", () => {
  it("empty: an interaction with a contact of type team is logged like any other", async () => {
    const r = await crm.logInteraction(sb(), { contact_name: "Riley", type: "call", subject: "weekly sync" });
    expect(r.isError, r.text).toBeFalsy();
    expect(db.tables.interactions).toHaveLength(1);
    expect(r.person).toEqual({ name: "Riley Teammate", noLog: false });
  });

  it("set to team: refuses to log, names the setting, and writes nothing", async () => {
    setTestEnv({ HAROLD_NO_LOG_TYPES: "team" });
    const r = await crm.logInteraction(sb(), { contact_name: "Riley", type: "call", subject: "weekly sync" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/HAROLD_NO_LOG_TYPES/);
    expect(r.text).toMatch(/type "team"/);
    expect((await crm.logInteraction(sb(), { contact_id: "c-team", type: "email", subject: "x" })).isError).toBe(true);
    expect(db.tables.interactions.length).toBe(0);
  });

  it("matches the type case-insensitively and accepts a list", async () => {
    setTestEnv({ HAROLD_NO_LOG_TYPES: " Investor , TEAM " });
    expect((await crm.logInteraction(sb(), { contact_id: "c-team", type: "note", subject: "x" })).isError).toBe(true);
    expect((await crm.logInteraction(sb(), { contact_id: "c-dup1", type: "note", subject: "x" })).isError).toBe(true);
    expect((await crm.logInteraction(sb(), { contact_id: "c-ext", type: "note", subject: "x" })).isError).toBeFalsy();
    expect(db.tables.interactions).toHaveLength(1);
  });

  it("only the type counts, not labels (as tools/harold-mcp)", async () => {
    setTestEnv({ HAROLD_NO_LOG_TYPES: "team" });
    const r = await crm.logInteraction(sb(), { contact_name: "Pat Labelled", type: "note", subject: "x" });
    expect(r.isError, r.text).toBeFalsy();
  });

  it("records of a no-log type may still be created and updated", async () => {
    setTestEnv({ HAROLD_NO_LOG_TYPES: "team" });
    const r = await crm.upsertContact(sb(), { name: "Riley Teammate", org: "Example Co", status: "active", notes: "now leads design" });
    expect(r.isError, r.text).toBeFalsy();
    expect(r.text).toMatch(/^Updated contact: Riley Teammate/);
    expect(r.person).toEqual({ name: "Riley Teammate", noLog: true });
    const c = await crm.upsertContact(sb(), { name: "New Teammate", org: "Example Co", category: "team" });
    expect(c.text).toMatch(/^Created contact: New Teammate \(Example Co\) \[type: team\]/);
  });

  it("logs an interaction for a contact whose type is not listed", async () => {
    setTestEnv({ HAROLD_NO_LOG_TYPES: "team" });
    const r = await crm.logInteraction(sb(), { contact_name: "jane doe", type: "meeting", subject: "NDA scoping", body: "notes" });
    expect(r.isError).toBeFalsy();
    expect(db.tables.interactions).toHaveLength(1);
    expect(db.tables.interactions[0]).toMatchObject({ contact_id: "c-ext", type: "meeting", subject: "NDA scoping", body: "notes" });
    expect(r.person).toEqual({ name: "Jane Doe", noLog: false });
  });
});

describe("contact matching (resolveContact, as server.js)", () => {
  it("exact (case-insensitive) first, then partial, then org to disambiguate", async () => {
    expect(await crm.resolveContact(sb(), "JANE DOE")).toEqual({ id: "c-ext", name: "Jane Doe" });
    expect(await crm.resolveContact(sb(), "Doe")).toEqual({ id: "c-ext", name: "Jane Doe" });
    const amb = await crm.resolveContact(sb(), "Sam Lee");
    expect("error" in amb && amb.error.text).toMatch(/Multiple contacts match/);
    expect(await crm.resolveContact(sb(), "Sam Lee", "beta")).toEqual({ id: "c-dup2", name: "Sam Lee" });
    const none = await crm.resolveContact(sb(), "Nobody Here");
    expect("error" in none && none.error.isError).toBe(true);
  });
  it("treats % and _ in a name literally", async () => {
    const r = await crm.resolveContact(sb(), "%");
    expect("error" in r).toBe(true);
  });
});

describe("upsert contact", () => {
  it("creates with defaults (pending, medium, other) and never touches the pipeline", async () => {
    const r = await crm.upsertContact(sb(), { name: "New Person", org: "NewCo", categories: ["Board"] });
    expect(r.text).toMatch(/^Created contact: New Person \(NewCo\) \[type: other; labels: board\]/);
    const c = db.tables.contacts.find(x => x.name === "New Person")!;
    expect(c).toMatchObject({ status: "pending", priority: "medium", category: "other" });
    expect(db.tables.contact_pipelines.length).toBe(0);
  });
  it("accepts any type from the owner's own list (free text, like harold-mcp)", async () => {
    const r = await crm.upsertContact(sb(), { name: "Morgan Mentor", org: "Example University", category: "mentor" });
    expect(r.text).toMatch(/\[type: mentor\]/);
  });
  it("writes only columns that exist in the starter schema", async () => {
    await crm.upsertContact(sb(), { name: "Col Check", org: "X", email: "c@example.com", region: "Europe", focus_area: "logistics", investor_type: "Angel" });
    const allowed = new Set(["id", "created_at", "name", "org", "category", "warmth", "status", "priority", "email", "phone", "location", "website", "notes", "region", "focus_area", "investor_type", "updated_at"]);
    for (const row of db.inserts.filter(i => i.table === "contacts").flatMap(i => i.rows)) for (const k of Object.keys(row)) expect(allowed.has(k), k).toBe(true);
  });
  it("updates the single name match, or the org match among several", async () => {
    const r = await crm.upsertContact(sb(), { name: "Jane Doe", warmth: "Hot" });
    expect(r.text).toMatch(/^Updated contact: Jane Doe/);
    expect(db.tables.contacts.find(x => x.id === "c-ext")!.warmth).toBe("Hot");
    await crm.upsertContact(sb(), { name: "Sam Lee", org: "Acme", notes: "n" });
    expect(db.tables.contacts.find(x => x.id === "c-dup1")!.notes).toBe("n");
  });
  it("saves a correction by contact_id (a renamed person is found by id, not name)", async () => {
    await crm.upsertContact(sb(), { contact_id: "c-ext", name: "Jane Doe-Smith", notes: "VP Partnerships" });
    const c = db.tables.contacts.find(x => x.id === "c-ext")!;
    expect(c).toMatchObject({ name: "Jane Doe-Smith", notes: "VP Partnerships" });
  });
});

describe("pipeline", () => {
  it("add requires a purpose and records the first stage change", async () => {
    const no = await crm.pipeline(sb(), { action: "add", contact_name: "Jane Doe" });
    expect(no.isError).toBe(true);
    expect(no.text).toMatch(/Need a purpose/);
    expect(db.tables.contact_pipelines.length).toBe(0);
    const ok = await crm.pipeline(sb(), { action: "add", contact_name: "Jane Doe", purpose: "co-marketing partnership", project: "example" });
    expect(ok.text).toMatch(/at \*\*Identified\*\* — co-marketing partnership \[example\]/);
    expect(db.tables.stage_changes[0]).toMatchObject({ contact_id: "c-ext", from_stage: null, to_stage: "Identified" });
  });
  it("move and close work on the resolved contact", async () => {
    await crm.pipeline(sb(), { action: "add", contact_name: "Jane Doe", purpose: "partner" });
    const mv = await crm.pipeline(sb(), { action: "move", contact_name: "Jane Doe", stage: "In Conversation", notes: "call booked" });
    expect(mv.text).toMatch(/Identified → In Conversation/);
    expect(db.tables.stage_changes.at(-1)).toMatchObject({ from_stage: "Identified", to_stage: "In Conversation", notes: "call booked" });
    const cl = await crm.pipeline(sb(), { action: "close", contact_name: "Jane Doe", outcome: "signed NDA" });
    expect(cl.text).toMatch(/Closed: partner — signed NDA/);
    expect(db.tables.contact_pipelines[0].closed_at).toBeTruthy();
  });
  it("asks which entry when a contact has two open entries and no purpose is given", async () => {
    await crm.pipeline(sb(), { action: "add", contact_name: "Jane Doe", purpose: "partner" });
    await crm.pipeline(sb(), { action: "add", contact_name: "Jane Doe", purpose: "client" });
    const r = await crm.pipeline(sb(), { action: "move", contact_name: "Jane Doe", stage: "Advancing" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/2 open entries/);
    const ok = await crm.pipeline(sb(), { action: "move", contact_name: "Jane Doe", purpose: "client", stage: "Advancing" });
    expect(ok.text).toMatch(/\(client\)/);
  });
});

describe("tasks", () => {
  it("creates a task linked to the resolved contact; complete requires task_id", async () => {
    const r = await crm.crmTask(sb(), { action: "create", contact_name: "Jane Doe", title: "Send deck", due_date: "2026-10-03" });
    expect(r.text).toMatch(/Created CRM task: "Send deck" → Jane Doe/);
    expect(db.tables.tasks[0]).toMatchObject({ contact_id: "c-ext", status: "pending", priority: "medium", due_date: "2026-10-03" });
    expect((await crm.crmTask(sb(), { action: "complete" })).isError).toBe(true);
    const done = await crm.crmTask(sb(), { action: "complete", task_id: String(db.tables.tasks[0].id) });
    expect(done.text).toMatch(/Completed: "Send deck"/);
  });
  it("shows a due date as its calendar day whatever HAROLD_TZ is (timestamptz stored at midnight UTC)", async () => {
    setTestEnv({ HAROLD_TZ: "America/Los_Angeles" });
    db.tables.tasks.push({ id: "t1", title: "Call back", status: "pending", priority: "high", due_date: "2026-10-03T00:00:00+00:00", contact_id: "c-ext" });
    const r = await crm.crmTask(sb(), { action: "list" });
    expect(r.text).toContain("(high, 10/3/2026)");
  });
});
