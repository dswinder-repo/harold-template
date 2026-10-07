import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cadenceSkipTypes, staleContacts, staleText, typeList } from "../../src/stale.js";
import { FakeSupabase } from "./fakes.js";

const NOW = new Date("2026-10-07T16:00:00Z");
const ago = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
let db: FakeSupabase;
const sb = () => db as unknown as SupabaseClient;
const names = (r: { contacts: { name: string }[] }) => r.contacts.map(c => c.name).sort();

function contact(id: string, name: string, category: string, warmth: string, last: number | null, status = "active") {
  db.tables.contacts.push({ id, name, org: `${name} Co`, category, warmth, status });
  if (last !== null) db.tables.interactions.push({ contact_id: id, occurred_at: ago(last), type: "call", subject: `call with ${name}` });
}

beforeEach(() => {
  delete process.env.HAROLD_NO_CADENCE_TYPES;
  delete process.env.HAROLD_NO_LOG_TYPES;
  db = new FakeSupabase();
  db.tables.pipeline_stages.push(
    { stage_name: "Identified", default_cadence: "monthly" }, { stage_name: "Reached Out", default_cadence: "weekly" },
    { stage_name: "Committed", default_cadence: "biweekly" }, { stage_name: "Dormant", default_cadence: "quarterly" },
    { stage_name: "Odd", default_cadence: "" },
  );
  contact("hot", "Hot Ten", "investor", "Hot", 10);              // 10 >= 7: stale
  contact("hot-ok", "Hot Three", "investor", "Hot", 3);          // fine
  contact("warm", "Warm Ten", "partner", "Warm", 10);            // 10 < 14: fine
  contact("luke", "Luke Thirty", "partner", "Lukewarm", 30);     // 30 >= 28: stale
  contact("luke-ok", "Luke Twenty", "partner", "Lukewarm", 20);  // fine
  contact("cold", "Cold Hundred", "investor", "Cold", 100);      // cold: never nudged
  contact("unset", "Unset Hundred", "investor", "", 100);        // unset warmth: never nudged
  contact("never", "Warm Never", "founder", "Warm", null);       // warm, nothing logged: a data gap
  contact("luke-never", "Luke Never", "founder", "Lukewarm", null); // lukewarm, nothing logged: not flagged
  contact("other", "Other Hundred", "other", "Hot", 100);        // default HAROLD_NO_CADENCE_TYPES=other
  contact("arch", "Archived Hundred", "investor", "Hot", 100, "archived");
  contact("pend", "Pending Hundred", "investor", "Warm", 100, "pending");
  contact("teamtype", "Team Member", "team", "Hot", 100);
  contact("teamlabel", "Labelled Investor", "investor", "Hot", 100); // a team LABEL does not skip: type only
  db.tables.contact_categories.push({ contact_id: "teamlabel", category_name: "team" });
  contact("pipe", "Pipe Nine", "partner", "Warm", 9);            // Reached Out (weekly 7) beats Warm 14: stale
  db.tables.contact_pipelines.push({ id: "e1", contact_id: "pipe", stage: "Reached Out", purpose: "pilot", project: "p", closed_at: null });
  contact("closed", "Closed Nine", "partner", "Warm", 9);        // only a CLOSED Reached Out entry: Warm 14 applies
  db.tables.contact_pipelines.push({ id: "e2", contact_id: "closed", stage: "Reached Out", purpose: "old deal", closed_at: ago(30) });
  contact("loose", "Loose Twenty", "investor", "Hot", 20);       // Dormant (quarterly 90) loosens Hot 7: fine
  db.tables.contact_pipelines.push({ id: "e3", contact_id: "loose", stage: "Dormant", purpose: "parked", closed_at: null });
  contact("tight", "Tight Twenty", "investor", "Lukewarm", 20);  // Identified 30 and Reached Out 7: the tightest wins
  db.tables.contact_pipelines.push({ id: "e4", contact_id: "tight", stage: "Identified", purpose: "a", closed_at: null }, { id: "e5", contact_id: "tight", stage: "Reached Out", purpose: "b", closed_at: null });
});
afterEach(() => { delete process.env.HAROLD_NO_CADENCE_TYPES; delete process.env.HAROLD_NO_LOG_TYPES; });

describe("crm_stale: the harold_cadence_check rule", () => {
  it("flags exactly the contacts past their cadence", async () => {
    const r = await staleContacts(sb(), { skipTypes: cadenceSkipTypes(["team"]), now: NOW });
    expect(names(r)).toEqual(["Hot Ten", "Labelled Investor", "Luke Thirty", "Pending Hundred", "Pipe Nine", "Tight Twenty", "Warm Never"]);
    expect(r.checked).toBe(db.tables.contacts.filter(c => c.status !== "archived").length);
    const by = Object.fromEntries(r.contacts.map(c => [c.name, c]));
    expect(by["Pipe Nine"]).toMatchObject({ threshold: 7, basis: "stage Reached Out, weekly", daysSince: 9, pipelines: [{ stage: "Reached Out", purpose: "pilot", project: "p" }] });
    expect(by["Tight Twenty"]).toMatchObject({ threshold: 7, basis: "stage Reached Out, weekly" });
    expect(by["Luke Thirty"]).toMatchObject({ threshold: 28, basis: "Lukewarm" });
    expect(by["Warm Never"]).toMatchObject({ daysSince: null, threshold: 14 });
    expect(by["Hot Ten"].last).toMatchObject({ type: "call", subject: "call with Hot Ten" });
    expect(r.contacts[0].name).toBe("Warm Never");                 // nothing on record sorts first
  });

  it("thresholds are adjustable", async () => {
    const r = await staleContacts(sb(), { skipTypes: ["other", "team"], staleDays: 7, hotDays: 3, now: NOW });
    expect(names(r)).toContain("Warm Ten");     // 10 >= 7
    expect(names(r)).toContain("Luke Twenty");  // 20 >= 14
  });

  it("HAROLD_NO_CADENCE_TYPES and HAROLD_NO_LOG_TYPES apply to the contact's type only", async () => {
    expect(cadenceSkipTypes([])).toEqual(["other"]);
    process.env.HAROLD_NO_CADENCE_TYPES = "";
    expect(cadenceSkipTypes([])).toEqual([]);
    expect(names(await staleContacts(sb(), { skipTypes: cadenceSkipTypes([]), now: NOW }))).toEqual(expect.arrayContaining(["Other Hundred", "Team Member"]));
    process.env.HAROLD_NO_CADENCE_TYPES = "Founder, partner";
    process.env.HAROLD_NO_LOG_TYPES = "Investor";
    const skip = cadenceSkipTypes(typeList(process.env.HAROLD_NO_LOG_TYPES));
    expect(skip).toEqual(["founder", "partner", "investor"]);
    const r = await staleContacts(sb(), { skipTypes: skip, now: NOW });
    expect(names(r)).toEqual(["Other Hundred", "Team Member"]);
  });

  it("filters to one type", async () => {
    const r = await staleContacts(sb(), { skipTypes: ["other"], type: "Partner", now: NOW });
    expect(names(r)).toEqual(["Luke Thirty", "Pipe Nine"]);
  });

  it("reads every page of contacts", async () => {
    for (let i = 0; i < 1005; i++) contact(`bulk-${i}`, `Bulk ${String(i).padStart(4, "0")}`, "investor", "Warm", null);
    const r = await staleContacts(sb(), { skipTypes: ["other", "team"], now: NOW });
    expect(r.contacts.filter(c => c.name.startsWith("Bulk"))).toHaveLength(1005);
  });

  it("formats a read-only report grouped by type, and says when nobody is quiet", async () => {
    const t = await staleText(sb(), { skipTypes: ["other", "team"], now: NOW });
    expect(t.text).toMatch(/^# Gone quiet: 7 contacts past their cadence/);
    expect(t.text).toContain("## partner (2)");
    expect(t.text).toContain("- **Pipe Nine** (Pipe Nine Co) [Warm]: last 9d ago (");
    expect(t.text).toContain("; cadence 7d (stage Reached Out, weekly), 2d over · pipeline: Reached Out (pilot)");
    expect(t.text).toContain("- **Warm Never** (Warm Never Co) [Warm]: no interaction logged; cadence 14d (Warm)");
    expect(t.text).toContain("Types never checked: other, team.");
    expect(t.text).toMatch(/Read-only: nothing was changed/);
    expect(db.inserts.length + db.updates.length).toBe(0);
    db.tables.contacts = db.tables.contacts.filter(c => c.warmth === "Cold");
    expect((await staleText(sb(), { skipTypes: [], now: NOW })).text).toMatch(/^Nobody has gone quiet: 1 active or pending contact checked, all within their cadence/);
  });
});
