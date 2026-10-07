// task_create and task_list through the real HTTP app, against an in-memory Linear GraphQL API:
// team lookup by key, project by name, due date, priority, description, the open-issue list with its
// text filter, the duplicate check, the secret refusal, and the plain "not configured" answer.
// Fictional data only.

import { beforeEach, describe, expect, it } from "vitest";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createApp } from "../../src/app.js";
import { _resetIdentityCache } from "../../src/identity.js";
import { issueTokens } from "../../src/oauth.js";
import { config } from "../../src/config.js";
import { HaroldRepo } from "../../src/github.js";
import { LINEAR_URL } from "../../src/tasks.js";
import type * as crm from "../../src/crm.js";
import { FakeGithub, FakeSupabase } from "./fakes.js";
import { OWNER, setTestEnv } from "./env.js";

const BASE = "https://harold-connector.example.com";
const KEY = "test-linear-key-value";

interface FakeIssue { id: string; identifier: string; title: string; description?: string; url: string; dueDate?: string | null; priority: number; state: { name: string; type: string }; project: { name: string } | null }

class FakeLinear {
  team = { id: "team-1", key: "EX", name: "Example", projects: [{ id: "p-1", name: "Acme Pilot", state: "started" }, { id: "p-2", name: "Fundraise", state: "planned" }] };
  issues: FakeIssue[] = [];
  creates: Record<string, unknown>[] = [];
  auth: string[] = [];
  queries: string[] = [];

  fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url !== LINEAR_URL) return new Response("not linear", { status: 404 });
    this.auth.push(new Headers(init?.headers).get("authorization") || "");
    const { query, variables } = JSON.parse(String(init?.body)) as { query: string; variables: Record<string, any> };
    this.queries.push(query);
    const json = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200, headers: { "Content-Type": "application/json" } });
    if (query.includes("teams(")) {
      const nodes = variables.team === this.team.key ? [{ id: this.team.id, name: this.team.name, projects: { nodes: this.team.projects } }] : [];
      return json({ teams: { nodes } });
    }
    if (query.includes("issueCreate")) {
      const input = variables.in as Record<string, any>;
      this.creates.push(input);
      const n = this.issues.length + 101;
      const project = this.team.projects.find(p => p.id === input.projectId);
      this.issues.push({ id: `i-${n}`, identifier: `EX-${n}`, title: input.title, description: input.description, url: `https://linear.app/example/issue/EX-${n}`, dueDate: input.dueDate ?? null, priority: input.priority, state: { name: "Todo", type: "unstarted" }, project: project ? { name: project.name } : null });
      return json({ issueCreate: { success: true, issue: { identifier: `EX-${n}`, url: `https://linear.app/example/issue/EX-${n}` } } });
    }
    if (query.includes("issues(")) {
      const f = variables.filter as Record<string, any>;
      let rows = f.team.key.eq === this.team.key ? this.issues.filter(i => !f.state.type.nin.includes(i.state.type)) : [];
      if (f.title?.eqIgnoreCase) rows = rows.filter(i => i.title.toLowerCase() === String(f.title.eqIgnoreCase).toLowerCase());
      if (f.or) {
        const t = String(f.or[0].title.containsIgnoreCase).toLowerCase();
        rows = rows.filter(i => i.title.toLowerCase().includes(t) || (i.description || "").toLowerCase().includes(t));
      }
      return json({ issues: { nodes: rows.slice(0, variables.first ?? 50) } });
    }
    return new Response(JSON.stringify({ errors: [{ message: "fake: unknown query" }] }), { status: 400 });
  };
}

let gh: FakeGithub, lin: FakeLinear, client: Client;

async function connect(env: Record<string, string>) {
  setTestEnv({ PUBLIC_BASE_URL: BASE, LINEAR_API_KEY: "", LINEAR_TEAM_KEY: "", ...env });
  _resetIdentityCache();
  const app = createApp({
    fetch: gh.fetch,
    tools: {
      repoFor: () => new HaroldRepo("tok-owner", "example/harold", "main", gh.fetch),
      supabase: () => new FakeSupabase() as unknown as crm.Sb,
      linearFetch: lin.fetch,
    },
  });
  const t = issueTokens(config(), { gh: "tok-owner", login: OWNER.login, uid: OWNER.id, client_id: "test" });
  client = new Client({ name: "tasks-test", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), {
    fetch: async (u, init) => app.fetch(new Request(u, init)),
    requestInit: { headers: { Authorization: `Bearer ${t.access_token}` } },
  }));
}

const text = (r: unknown) => ((r as { content: { text: string }[] }).content[0].text);

beforeEach(async () => {
  gh = new FakeGithub();
  gh.users.set("tok-owner", OWNER);
  lin = new FakeLinear();
  await connect({ LINEAR_API_KEY: KEY, LINEAR_TEAM_KEY: "EX" });
});

describe("task manager tools", () => {
  it("are listed: task_list read-only, task_create a non-destructive write, both open-world", async () => {
    const { tools } = await client.listTools();
    const list = tools.find(t => t.name === "task_list")!, create = tools.find(t => t.name === "task_create")!;
    expect(list.annotations?.readOnlyHint).toBe(true);
    expect(create.annotations?.readOnlyHint).toBe(false);
    expect(create.annotations?.destructiveHint).toBe(false);
    expect(list.annotations?.openWorldHint).toBe(true);
    expect(create.annotations?.openWorldHint).toBe(true);
  });

  it("task_create: team by key, project by name, due date, priority and description, with the API key as is", async () => {
    const r = await client.callTool({ name: "task_create", arguments: {
      title: "Send the revised deck to Jane Doe", description: "From the Acme call on 2026-10-06", due_date: "2026-10-10", project: "acme", priority: "high",
    } });
    expect(r.isError, text(r)).toBeFalsy();
    expect(text(r)).toMatch(/^Created EX-101 in Acme Pilot, due 2026-10-10: Send the revised deck to Jane Doe\nhttps:\/\/linear.app\/example\/issue\/EX-101/);
    expect(lin.creates).toEqual([{ teamId: "team-1", title: "Send the revised deck to Jane Doe", priority: 2, projectId: "p-1", dueDate: "2026-10-10", description: "From the Acme call on 2026-10-06" }]);
    expect(new Set(lin.auth)).toEqual(new Set([KEY]));
  });

  it("task_create: no project and no due date is allowed, priority defaults to medium, and the missing date is pointed out", async () => {
    const r = await client.callTool({ name: "task_create", arguments: { title: "Follow up: Jane Doe owes the signed NDA" } });
    expect(r.isError, text(r)).toBeFalsy();
    expect(lin.creates[0]).toEqual({ teamId: "team-1", title: "Follow up: Jane Doe owes the signed NDA", priority: 3 });
    expect(text(r)).toMatch(/due none/);
    expect(text(r)).toMatch(/No due date: add one/);
  });

  it("task_create: an open task with the same title is returned, not duplicated", async () => {
    await client.callTool({ name: "task_create", arguments: { title: "Book the venue", due_date: "2026-11-01" } });
    const again = await client.callTool({ name: "task_create", arguments: { title: "book the venue" } });
    expect(again.isError, text(again)).toBeFalsy();
    expect(text(again)).toMatch(/^Already open, not created again: EX-101 Book the venue \(due 2026-11-01\)/);
    expect(lin.creates).toHaveLength(1);
  });

  it("task_create: unknown project lists the team's projects; a bad date and a secret are refused before any write", async () => {
    const p = await client.callTool({ name: "task_create", arguments: { title: "Draft the memo", project: "Nope" } });
    expect(p.isError).toBe(true);
    expect(text(p)).toMatch(/Project "Nope" not found in team EX\. Projects: Acme Pilot, Fundraise/);
    const d = await client.callTool({ name: "task_create", arguments: { title: "Draft the memo", due_date: "next Friday" } });
    expect(d.isError).toBe(true);
    expect(text(d)).toMatch(/due_date must be YYYY-MM-DD/);
    const s = await client.callTool({ name: "task_create", arguments: { title: "Rotate key", description: "the old one was lin_api_abcdefghijklmnopqrstuvwxyz0123" } });
    expect(s.isError).toBe(true);
    expect(text(s)).toMatch(/Refused: the task looks like it contains a secret/);
    expect(lin.creates).toHaveLength(0);
  });

  it("task_list: open tasks only, with ID, project, state, due date and URL; the text filter narrows", async () => {
    await client.callTool({ name: "task_create", arguments: { title: "Send the deck", project: "Fundraise", due_date: "2026-10-09" } });
    await client.callTool({ name: "task_create", arguments: { title: "Call the landlord" } });
    lin.issues.push({ id: "x", identifier: "EX-99", title: "Old and done", url: "https://linear.app/example/issue/EX-99", priority: 0, state: { name: "Done", type: "completed" }, project: null });
    const all = await client.callTool({ name: "task_list", arguments: {} });
    expect(all.isError, text(all)).toBeFalsy();
    expect(text(all)).toMatch(/Open tasks in team EX \(2,/);
    expect(text(all)).toMatch(/- EX-101 · Send the deck · Fundraise · Todo · due 2026-10-09 · medium\n  https:\/\/linear.app\/example\/issue\/EX-101/);
    expect(text(all)).not.toMatch(/Old and done/);
    const some = await client.callTool({ name: "task_list", arguments: { query: "landlord" } });
    expect(text(some)).toMatch(/matching "landlord" \(1,/);
    expect(text(some)).not.toMatch(/Send the deck/);
    const none = await client.callTool({ name: "task_list", arguments: { query: "zebra" } });
    expect(text(none)).toMatch(/No open tasks in team EX matching "zebra"/);
  });

  it("a wrong team key is a clear error", async () => {
    await connect({ LINEAR_API_KEY: KEY, LINEAR_TEAM_KEY: "ZZ" });
    const r = await client.callTool({ name: "task_create", arguments: { title: "Anything" } });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/team with key "ZZ" not found/);
  });

  it("not configured: both tools say so plainly, suggest crm_task, and call nothing", async () => {
    await connect({});
    for (const [name, args] of [["task_create", { title: "Send the deck" }], ["task_list", {}]] as const) {
      const r = await client.callTool({ name, arguments: args });
      expect(r.isError).toBe(true);
      expect(text(r)).toMatch(/No task manager is configured on this connector \(LINEAR_API_KEY and LINEAR_TEAM_KEY are not set\)/);
      expect(text(r)).toMatch(/use crm_task/);
    }
    expect(lin.queries).toHaveLength(0);
  });

  it("instructions tell the model to turn commitments into tasks without being asked", async () => {
    const i = client.getInstructions() || "";
    expect(i).toMatch(/Turn commitments into tasks without being asked/);
    expect(i).toMatch(/call task_list to see what is already open/);
    expect(i).toMatch(/call task_create once per new commitment/);
    expect(i).toMatch(/"Follow up: <who> owes <what>"/);
    expect(i).toMatch(/also call crm_task/);
    expect(i).toMatch(/"## Action items" section in which every item carries its task ID/);
    expect(i).toMatch(/say in one line per task what was created/);
  });
});
