// The MCP tool surface through the real HTTP app, with the MCP SDK v2 client (2026-07-28 protocol):
// annotations, the optional HAROLD_NO_LOG_TYPES gate on both the CRM and the vault side, CRM + vault
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
      const write = /capture|note|update|learning|log_interaction|upsert|pipeline|crm_task/.test(t.name);
      expect(t.annotations?.readOnlyHint, t.name).toBe(!write);
      expect(t.annotations?.destructiveHint, t.name).toBe(false);
      expect(t.name).not.toMatch(/delete|remove/);
    }
  });

  it("server instructions are delivered and generic", async () => {
    const ins = client.getInstructions() || "";
    expect(ins).toMatch(/call harold_today first/);
    expect(ins).toMatch(/the owner's Harold/);
    expect(ins).not.toMatch(/HAROLD_NO_LOG_TYPES/); // empty by default: no refusal line
    expect(client.getServerVersion()?.name).toBe("harold");
  });

  it("instructions: file without being asked, harold_related first, always state staleness and gaps", async () => {
    const i = client.getInstructions() || "";
    expect(i).toMatch(/File what the owner shares without being asked/);
    expect(i).toMatch(/Before answering about a person, a company, a project or a past decision[^\n]*call harold_related/);
    expect(i).toMatch(/Always state staleness and gaps/);
    expect(i).toMatch(/crm_stale/);
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

  it("crm_stale lists who has gone quiet, skips HAROLD_NO_LOG_TYPES by type, and writes nothing", async () => {
    db.tables.pipeline_stages.push({ stage_name: "Reached Out", default_cadence: "weekly" });
    db.tables.contacts.push(
      { id: "c-quiet", name: "Quiet Investor", org: "Fund", category: "investor", warmth: "Hot", status: "active" },
      { id: "c-team2", name: "Team Mate", org: "Us", category: "team", warmth: "Hot", status: "active" },
    );
    db.tables.interactions.push({ contact_id: "c-quiet", occurred_at: "2026-01-01T12:00:00Z", type: "call", subject: "intro" });
    const r = await client.callTool({ name: "crm_stale", arguments: {} });
    expect(r.isError, text(r)).toBeFalsy();
    expect(text(r)).toMatch(/\*\*Quiet Investor\*\* \(Fund\) \[Hot\]: last \d+d ago \(2026-01-01, call: intro\); cadence 7d \(Hot\)/);
    expect(text(r)).toMatch(/\*\*Team Mate\*\*/);                 // no-log is off by default
    expect(text(r)).toMatch(/Types never checked: other\./);
    await connect({ HAROLD_NO_LOG_TYPES: "team" });
    const r2 = await client.callTool({ name: "crm_stale", arguments: {} });
    expect(text(r2)).not.toMatch(/Team Mate/);
    expect(text(r2)).toMatch(/Types never checked: other, team\./);
    expect(db.inserts.length + db.updates.length).toBe(0);
  });

  it("instructions mention the no-log types only when the setting is used", async () => {
    await connect({ HAROLD_NO_LOG_TYPES: "team" });
    expect(client.getInstructions()).toMatch(/type "team" \(HAROLD_NO_LOG_TYPES\)/);
  });

  it("HAROLD_NO_LOG_TYPES empty: an interaction with a team-typed person is logged", async () => {
    const r = await client.callTool({ name: "crm_log_interaction", arguments: { contact_name: "Riley", type: "call", subject: "sync" } });
    expect(r.isError, text(r)).toBeFalsy();
    expect(db.tables.interactions).toHaveLength(1);
  });

  it("HAROLD_NO_LOG_TYPES=team: the vault card's type blocks the log even when the CRM record is typed otherwise", async () => {
    await connect({ HAROLD_NO_LOG_TYPES: "team" });
    const r = await client.callTool({ name: "crm_log_interaction", arguments: { contact_name: "Riley", type: "call", subject: "sync" } });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/HAROLD_NO_LOG_TYPES/);
    expect(db.tables.interactions.length).toBe(0);
    expect(gh.puts.length).toBe(0);
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
