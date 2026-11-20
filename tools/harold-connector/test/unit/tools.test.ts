// The MCP tool surface through the real HTTP app, with the MCP SDK v2 client (2026-07-28 protocol):
// annotations, CRM + vault
// filing together, and configuration errors. Fictional data only.

import { beforeEach, describe, expect, it } from "vitest";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createApp } from "../../src/app.js";
import { _resetIdentityCache } from "../../src/identity.js";
import { issueTokens } from "../../src/oauth.js";
import { config } from "../../src/config.js";
import { HaroldRepo } from "../../src/github.js";
import { frontmatter } from "../../src/text.js";
import { defaultDeps, TOOL_NAMES } from "../../src/tools.js";
import type * as crm from "../../src/crm.js";
import { FakeGithub, FakeSupabase } from "./fakes.js";
import { graphJson } from "./graph-fixture.js";
import { OWNER, REPO, setTestEnv } from "./env.js";

const BASE = "https://harold-connector.example.com";
let gh: FakeGithub, db: FakeSupabase, client: Client;

async function connect(env: Record<string, string> = {}, useDefaultRepo = false) {
  setTestEnv({ PUBLIC_BASE_URL: BASE, ...env });
  _resetIdentityCache();
  const app = createApp({
    fetch: gh.fetch,
    tools: {
      repoFor: useDefaultRepo ? defaultDeps.repoFor : () => new HaroldRepo("tok-owner", REPO, "main", gh.fetch),
      supabase: () => db as unknown as crm.Sb,
    },
  });
  const t = issueTokens(config(), { gh: "tok-owner", login: OWNER.login, uid: OWNER.id, client_id: "test" });
  client = new Client({ name: "tools-test", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), {
    fetch: async (u, init) => app.fetch(new Request(u, init)),
    requestInit: { headers: { Authorization: `Bearer ${t.access_token}` } },
  }));
}

beforeEach(async () => {
  gh = new FakeGithub();
  gh.users.set("tok-owner", OWNER);
  gh.files.set("vault/people/Riley Teammate.md", "---\ntype: team\nlast_updated: 2026-01-01\n---\n# Riley Teammate\n");
  gh.files.set("vault/people/Jane Doe.md", "---\ntype: partner\nwarmth: Warm\nlast_updated: 2026-02-26\n---\n# Jane Doe\n");
  db = new FakeSupabase();
  db.tables.contacts.push(
    { id: "c-riley", name: "Riley Teammate", org: "Example Co", category: "partner" }, // typed differently in the CRM on purpose
    { id: "c-jane", name: "Jane Doe", org: "Acme Corp", category: "partner" },
  );
  await connect();
});

const text = (r: unknown) => ((r as { content: { text: string }[] }).content[0].text);

describe("tool surface (SDK v2 client)", () => {
  it("lists all tools with the right annotations and no delete tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map(t => t.name).sort()).toEqual([...TOOL_NAMES].sort());
    for (const t of tools) {
      const write = /capture|heartbeat(?!_latest)|note|update|learning|person_create|log_interaction|upsert|pipeline|crm_task|task_create|event_create|event_cancel|sync_setup/.test(t.name);
      expect(t.annotations?.readOnlyHint, t.name).toBe(!write);
      expect(t.annotations?.destructiveHint, t.name).toBe(false);
      expect(t.name).not.toMatch(/delete|remove/);
    }
  });

  it("server instructions are delivered and generic", async () => {
    const ins = client.getInstructions() || "";
    expect(ins).toMatch(/call harold_today first/);
    expect(ins).toMatch(/the owner's Harold/);
    expect(ins).toMatch(/harold_heartbeat at each finished piece of work/);
    expect(client.getServerVersion()?.name).toBe("harold");
  });

  it("instructions: file without being asked, harold_related first, always state staleness and gaps", async () => {
    const i = client.getInstructions() || "";
    expect(i).toMatch(/File what the owner shares without being asked/);
    expect(i).toMatch(/Before answering about a person, a company, a project or a past decision[^\n]*call harold_related/);
    expect(i).toMatch(/Always state staleness and gaps/);
    expect(i).toMatch(/crm_stale/);
  });

  it("harold_heartbeat appends one line to the project's heartbeat file and refuses an unknown project", async () => {
    gh.files.set("harold/projects.md", "## Pilot Program\n- status: active\n- folder: projects/pilot\n- aliases: the pilot\n");
    const r = await client.callTool({ name: "harold_heartbeat", arguments: { project: "the pilot", done: "Shipped the intake form", running: "QA session", waiting: [{ what: "Pick a launch date", due: "2026-11-10" }], file: "vault/daily/x.md" } });
    expect(r.isError, text(r)).toBeFalsy();
    const f = gh.files.get("projects/pilot/heartbeats.jsonl") || "";
    const row = JSON.parse(f.trim());
    expect(row).toMatchObject({ project: "Pilot Program", done: "Shipped the intake form", running: "QA session", file: "vault/daily/x.md", source: "connector", waiting: [{ what: "Pick a launch date", due: "2026-11-10" }] });
    await client.callTool({ name: "harold_heartbeat", arguments: { project: "Pilot Program", done: "Second" } });
    expect((gh.files.get("projects/pilot/heartbeats.jsonl") || "").trim().split("\n")).toHaveLength(2);
    const bad = await client.callTool({ name: "harold_heartbeat", arguments: { project: "zzz nothing", done: "x" } });
    expect(bad.isError).toBe(true);
    expect(text(bad)).toMatch(/No project matches/);
    const secret = await client.callTool({ name: "harold_heartbeat", arguments: { project: "Pilot Program", done: "key sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789" } });
    expect(gh.files.get("projects/pilot/heartbeats.jsonl")).not.toMatch(/sk-ant/);
    void secret;
  });

  describe("harold_heartbeat_latest", () => {
    const PROJ = "## Pilot Program\n- status: active\n- folder: projects/pilot\n- aliases: the pilot\n";
    const FILE = "projects/pilot/heartbeats.jsonl";
    const row = (date: string, time: string, done: string, extra: object = {}) => JSON.stringify({ date, time, project: "Pilot Program", done, source: "connector", ...extra });
    const call = (args: Record<string, unknown>) => client.callTool({ name: "harold_heartbeat_latest", arguments: { project: "the pilot", ...args } });
    type Sc = { project: string; path: string; heartbeats: { date: string; time: string; done: string; running: string; waiting: { what: string; due?: string }[]; file: string }[] };

    it("returns the newest by date, then time, then position, newest first, with structured data", async () => {
      gh.files.set("harold/projects.md", PROJ);
      gh.files.set(FILE, [
        row("2026-11-18", "09:00", "older day"),
        row("2026-11-19", "15:30", "afternoon", { running: "QA", waiting: [{ what: "Pick a date", due: "2026-11-25" }], file: "vault/daily/x.md" }),
        row("2026-11-19", "08:00", "morning, later in file"),
        row("2026-11-19", "15:30", "tie, later line wins"),
      ].join("\n") + "\n");
      const one = await call({});
      expect(one.isError, text(one)).toBeFalsy();
      expect((one.structuredContent as Sc).heartbeats.map(h => h.done)).toEqual(["tie, later line wins"]);
      expect((one.structuredContent as Sc)).toMatchObject({ project: "Pilot Program", path: FILE });
      const three = await call({ n: 3 });
      const sc = three.structuredContent as Sc;
      expect(sc.heartbeats.map(h => h.done)).toEqual(["tie, later line wins", "afternoon", "morning, later in file"]);
      expect(sc.heartbeats[1]).toEqual({ date: "2026-11-19", time: "15:30", done: "afternoon", running: "QA", waiting: [{ what: "Pick a date", due: "2026-11-25" }], file: "vault/daily/x.md" });
      expect(text(three)).toMatch(/^Latest 3 heartbeats for Pilot Program \(projects\/pilot\/heartbeats.jsonl\), newest first:\n- 2026-11-19 15:30 · done: tie, later line wins/);
      expect(text(three)).toMatch(/running: QA\n {2}waiting: Pick a date \(due 2026-11-25\)\n {2}file: vault\/daily\/x.md/);
      expect(((await call({ n: 10 })).structuredContent as Sc).heartbeats).toHaveLength(4);
    });

    it("says so plainly (not an error) when the file is missing or has no entries", async () => {
      gh.files.set("harold/projects.md", PROJ);
      const none = await call({});
      expect(none.isError).toBeFalsy();
      expect(text(none)).toMatch(/No heartbeats filed for Pilot Program/);
      expect(none.structuredContent).toEqual({ project: "Pilot Program", path: FILE, heartbeats: [] });
      gh.files.set(FILE, "not json\n\n");
      expect(((await call({})).structuredContent as Sc).heartbeats).toEqual([]);
    });

    it("refuses an unknown project with an error", async () => {
      gh.files.set("harold/projects.md", PROJ);
      const bad = await call({ project: "zzz nothing" });
      expect(bad.isError).toBe(true);
      expect(text(bad)).toMatch(/No project matches/);
    });

    it("ignores the archive files under heartbeats/", async () => {
      gh.files.set("harold/projects.md", PROJ);
      gh.files.set(FILE, row("2026-11-01", "10:00", "live") + "\n");
      gh.files.set("projects/pilot/heartbeats/2026-10.jsonl", row("2026-11-30", "23:00", "archived, newer date") + "\n");
      expect(((await call({ n: 5 })).structuredContent as Sc).heartbeats.map(h => h.done)).toEqual(["live"]);
    });

    it("finds the newest line at the end of a live file over 100,000 characters", async () => {
      gh.files.set("harold/projects.md", PROJ);
      const filler = Array.from({ length: 400 }, (_, i) => row("2026-10-01", "10:00", `old ${i} ` + "x".repeat(300))).join("\n");
      const file = filler + "\n" + row("2026-11-19", "20:00", "the newest, at the end") + "\n";
      expect(file.length).toBeGreaterThan(100_000);
      gh.files.set(FILE, file);
      expect(((await call({})).structuredContent as Sc).heartbeats[0]).toMatchObject({ done: "the newest, at the end", time: "20:00" });
    });
  });


  it("harold_related follows the links from graph.json and ends with the gaps line", async () => {
    gh.files.set("harold/graph.json", graphJson());
    const r = await client.callTool({ name: "harold_related", arguments: { query: "Jane Doe" } });
    expect(r.isError, text(r)).toBeFalsy();
    expect(text(r)).toMatch(/^Jane Doe · vault\/people\/Jane Doe.md · person · updated 2026-08-01/);
    expect(text(r)).toMatch(/↔ Acme · vault\/companies\/Acme.md · company · 2026-10-01/);
    expect(text(r)).toMatch(/\ngaps: Jane Doe: last updated \d+ days ago \(2026-08-01\)/);
    gh.files.delete("harold/graph.json");
    const none = await client.callTool({ name: "harold_related", arguments: { query: "Jane Doe" } });
    expect(none.isError).toBe(true);
    expect(text(none)).toMatch(/harold\/graph.json is not in/);
  });

  it("crm_stale lists who has gone quiet, skips HAROLD_NO_CADENCE_TYPES by type, and writes nothing", async () => {
    db.tables.pipeline_stages.push({ stage_name: "Reached Out", default_cadence: "weekly" });
    db.tables.contacts.push(
      { id: "c-quiet", name: "Quiet Investor", org: "Fund", category: "investor", warmth: "Hot", status: "active" },
      { id: "c-team2", name: "Team Mate", org: "Us", category: "team", warmth: "Hot", status: "active" },
    );
    db.tables.interactions.push({ contact_id: "c-quiet", occurred_at: "2026-01-01T12:00:00Z", type: "call", subject: "intro" });
    const r = await client.callTool({ name: "crm_stale", arguments: {} });
    expect(r.isError, text(r)).toBeFalsy();
    expect(text(r)).toMatch(/\*\*Quiet Investor\*\* \(Fund\) \[Hot\]: last \d+d ago \(2026-01-01, call: intro\); cadence 7d \(Hot\)/);
    expect(text(r)).toMatch(/\*\*Team Mate\*\*/);                 // every type but "other" is checked by default
    expect(text(r)).toMatch(/Types never checked: other\./);
    await connect({ HAROLD_NO_CADENCE_TYPES: "other, team" });
    const r2 = await client.callTool({ name: "crm_stale", arguments: {} });
    expect(text(r2)).not.toMatch(/Team Mate/);
    expect(text(r2)).toMatch(/Types never checked: other, team\./);
    expect(db.inserts.length + db.updates.length).toBe(0);
  });

  it("an interaction with a team-typed person is logged like any other", async () => {
    const r = await client.callTool({ name: "crm_log_interaction", arguments: { contact_name: "Riley", type: "call", subject: "sync" } });
    expect(r.isError, text(r)).toBeFalsy();
    expect(db.tables.interactions).toHaveLength(1);
  });

  it("an interaction is logged in the CRM and the vault card's last_updated is freshened", async () => {
    const r = await client.callTool({ name: "crm_log_interaction", arguments: { contact_name: "Jane Doe", type: "meeting", subject: "NDA scoping" } });
    expect(r.isError, text(r)).toBeFalsy();
    expect(db.tables.interactions).toHaveLength(1);
    const fm = frontmatter(gh.files.get("vault/people/Jane Doe.md")!);
    expect(fm.last_updated).not.toBe("2026-02-26");
    expect(fm.warmth).toBe("Warm");
    expect(gh.puts[0].message).toMatch(/^chore\(connector\): touch Jane Doe card after CRM update/);
    expect(gh.puts[0].author).toEqual({ name: "Harold (connector)", email: "harold-connector@users.noreply.github.com" });
    expect(text(r)).toMatch(/Vault card vault\/people\/Jane Doe.md: last_updated →/);
  });

  it("crm_upsert_contact accepts the owner's own types", async () => {
    const r = await client.callTool({ name: "crm_upsert_contact", arguments: { name: "Morgan Mentor", org: "Example University", category: "mentor" } });
    expect(r.isError, text(r)).toBeFalsy();
    expect(text(r)).toMatch(/\[type: mentor\]/);
  });

  it("a tool error comes back as isError, not a protocol failure", async () => {
    const r = await client.callTool({ name: "harold_read", arguments: { path: "vault/does-not-exist.md" } });
    expect(r.isError).toBe(true);
    const bad = await client.callTool({ name: "harold_update", arguments: { path: "AGENTS.md", append_text: "x" } });
    expect(bad.isError).toBe(true);
  });
});

describe("configuration errors", () => {
  it("HAROLD_REPO missing: knowledge-base tools answer with a clear error naming the variable", async () => {
    await connect({}, true);
    delete process.env.HAROLD_REPO;
    const r = await client.callTool({ name: "harold_read", arguments: { path: "harold/alerts.md" } });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/Missing environment variable HAROLD_REPO/);
  });
});

