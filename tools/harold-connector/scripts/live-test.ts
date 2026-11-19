// Live test of a task provider against a REAL throwaway account: the provider class and the SyncEngine run against an
// in-memory Harold store (test/unit/sync-fakes.ts), never Supabase, so the owner's task list is never touched.
//
//   npm run sync:live-test -- todoist|asana|notion     (LIVE_TEST=1 NODE_USE_ENV_PROXY=1 tsx scripts/live-test.ts ...)
//
// NODE_USE_ENV_PROXY=1 makes Node's fetch use HTTPS_PROXY, for a machine that reaches the internet through a proxy.
//
// Use a THROWAWAY account or workspace, never your real one: the test creates, edits and deletes tasks there.
// It refuses to run without LIVE_TEST=1, and refuses when SUPABASE_URL is set. Credentials: TODOIST_API_TOKEN,
// ASANA_ACCESS_TOKEN (+ ASANA_WORKSPACE, default "Harold test") or NOTION_TOKEN. The Notion run expects a data source named "Harold tasks"
// (NOTION_DATA_SOURCE to name another) shared with the integration; Asana a project "Harold test" (ASANA_TEST_PROJECT).
//
// What it proves, per provider (each check prints PASS or FAIL; the exit code is the number of failures):
// Add --scoped to keep Todoist or Asana to the test project (TODOIST_PROJECT / ASANA_PROJECT).
//
//   1  Harold -> tool: a new open task is created, its link re-keyed from the placeholder, and read back the same
//   2  Harold edits title/due/notes, then in_progress, completed, cancelled, reopened: each reaches the tool, no echo
//   3  tool -> Harold: an edit and a completion made through the tool's own API reach Harold on catchup
//   4  a second catchup with no changes reports nothing
//   5  deletion in the tool: what Harold sees
//   6  import: listForImport returns open items and recently completed ones
//   7  (Notion) sync_setup_notion's propose and confirm against the real data source
// Everything it creates is deleted (Todoist, Asana) or moved to the trash (Notion) at the end, also after a failure.

import { mkdirSync, writeFileSync } from "node:fs";
import { SyncEngine, changedAnything, isPlaceholder, type Counts } from "../src/sync/engine.js";
import { ProjectMap } from "../src/sync/projectmap.js";
import type { SyncProvider } from "../src/sync/provider.js";
import { TodoistProvider, TODOIST_API } from "../src/sync/todoist.js";
import { AsanaProvider, ASANA_API } from "../src/sync/asana.js";
import { NotionProvider, NOTION_API, NOTION_VERSION, loadNotionState, statusOption } from "../src/sync/notion.js";
import { setupNotion } from "../src/sync/notion-setup.js";
import type { ExternalItem, FieldKey, HaroldFields, TaskRow } from "../src/sync/types.js";
import { Clock, MemoryStore } from "../test/unit/sync-fakes.js";

const which = (process.argv[2] || "").toLowerCase();
/** --scoped: Todoist and Asana kept to the test project (TODOIST_PROJECT / ASANA_PROJECT = "Harold test"). */
const scoped = process.argv.includes("--scoped");
if (process.env.LIVE_TEST !== "1") { console.error("Refusing to run: set LIVE_TEST=1 (this writes to a real account)."); process.exit(2); }
if (process.env.SUPABASE_URL) { console.error("Refusing to run with SUPABASE_URL set: the live test must never reach the owner's database."); process.exit(2); }
if (!["todoist", "asana", "notion"].includes(which)) { console.error("Usage: LIVE_TEST=1 npx tsx scripts/live-test.ts todoist|asana|notion"); process.exit(2); }

// ───────────── harness ─────────────

/** The real clock, but every tick strictly later than the last (so Harold's updated_at always moves on). */
class RealClock extends Clock {
  constructor() { super(Date.now()); }
  now = () => Date.now();
  tick(): string { this.t = Math.max(this.t + 1, Date.now()); return new Date(this.t).toISOString(); }
  iso() { return new Date(Date.now()).toISOString(); }
}

const RUN = `${Date.now().toString(36)}`;
const outDir = new URL(`../.live-test/${which}${scoped ? "-scoped" : ""}/`, import.meta.url);
mkdirSync(outDir, { recursive: true });
const results: { id: string; ok: boolean; detail: string }[] = [];
const check = (id: string, ok: boolean, detail = "") => {
  results.push({ id, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${id}${detail ? `  (${detail})` : ""}`);
};
const note = (s: string) => console.log(`      ${s}`);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** fetch that records every response (method, path, status, body) to .live-test/<provider>/calls.jsonl, gitignored. */
const calls: string[] = [];
const recFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const r = await fetch(input, init);
  const text = await r.text();
  const u = new URL(String(input));
  calls.push(JSON.stringify({ method: init?.method || "GET", path: u.pathname + u.search, status: r.status, request: init?.body ? String(init.body).slice(0, 2000) : undefined, body: text.slice(0, 20000) }));
  return new Response(text, { status: r.status, headers: r.headers });
};

const clock = new RealClock();
const store = new MemoryStore(clock);
const PROJECT = "Harold test";
const map = ProjectMap.fromMarkdown(`# Projects\n\n## ${PROJECT}\n- folder: harold-test/\n- status: active\n- aliases: live test\n`);

const show = (f: Partial<HaroldFields>) => JSON.stringify(f);
const summary = (c: Counts) => Object.entries(c).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join(" ") || "nothing";

/** Fields the item holds, compared with Harold's (skipping fields the provider does not hold). */
function differences(h: HaroldFields, item: ExternalItem, skip: FieldKey[] = []): string[] {
  const out: string[] = [];
  for (const k of ["title", "notes", "status", "priority", "due", "project"] as FieldKey[]) {
    if (skip.includes(k) || item.unmapped?.includes(k)) continue;
    const a = k === "notes" ? (h[k] || "").trim() || null : h[k];
    const b = k === "notes" ? (item.fields[k] || "").trim() || null : item.fields[k];
    if ((a ?? null) !== (b ?? null)) out.push(`${k}: harold ${JSON.stringify(a)} vs tool ${JSON.stringify(b)}`);
  }
  return out;
}

// ───────────── per-provider adapters ─────────────

interface Adapter {
  provider: SyncProvider;
  teamKey: string | null;
  /** Fields the tool cannot hold in this account (left out of read-back comparisons). */
  skip: FieldKey[];
  /** The status marker the tool shows (labels, tags, status option), for the log. */
  marker(item: ExternalItem): string;
  /** The status marker each Harold status should produce. */
  expectMarker(status: HaroldFields["status"], item: ExternalItem): string | null;
  userEdit(id: string, title: string, due: string): Promise<void>;
  userComplete(id: string): Promise<void>;
  userReopen(id: string): Promise<void>;
  userDelete(id: string): Promise<void>;
  /** An item made directly in the tool (for the import check); completed when asked. */
  userCreate(title: string, completed: boolean): Promise<string>;
  cleanup(): Promise<void>;
  /** What a deletion in the tool is expected to do to an open Harold task. */
  deletion: "cancelled" | "gap";
  /** The Harold status the tool reads back for one Harold writes (Notion with no "cancelled" option: completed). */
  readsBackAs?(status: HaroldFields["status"]): HaroldFields["status"];
}

const made = new Set<string>();

async function todoistAdapter(): Promise<Adapter> {
  const token = process.env.TODOIST_API_TOKEN || "proxy-injected";
  const h = { Authorization: `Bearer ${token}` };
  const cmd = async (type: string, args: Record<string, unknown>, tempId?: string) => {
    const uuid = crypto.randomUUID();
    const r = await recFetch(`${TODOIST_API}/sync`, { method: "POST", headers: { ...h, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ commands: JSON.stringify([{ type, uuid, ...(tempId ? { temp_id: tempId } : {}), args }]) }).toString() });
    const d = await r.json() as { sync_status?: Record<string, unknown>; temp_id_mapping?: Record<string, string> };
    if (d.sync_status?.[uuid] !== "ok") throw new Error(`Todoist ${type}: ${JSON.stringify(d.sync_status?.[uuid])}`);
    return d;
  };
  // A Todoist project named like the Harold project, so the project mapping is exercised.
  const pd = await cmd("project_add", { name: PROJECT }, "proj");
  const projectId = pd.temp_id_mapping!.proj;
  const provider = new TodoistProvider({ token, project: scoped ? PROJECT : null, clientSecret: "" }, map, recFetch);
  return {
    provider, teamKey: scoped ? PROJECT : null, skip: [], deletion: "cancelled",
    marker: i => `labels=${JSON.stringify((i.extra as { labels?: string[] }).labels)} checked=${(i.extra as { checked?: boolean }).checked}`,
    expectMarker: s => s === "in_progress" ? "in-progress" : s === "cancelled" ? "cancelled" : null,
    userEdit: async (id, title, due) => { await cmd("item_update", { id, content: title, due: { date: due } }); },
    userComplete: async id => { await cmd("item_complete", { id }); },
    userReopen: async id => { await cmd("item_uncomplete", { id }); },
    userDelete: async id => { await cmd("item_delete", { id }); },
    userCreate: async (title, completed) => {
      const d = await cmd("item_add", { content: title, project_id: projectId }, "t");
      const id = d.temp_id_mapping!.t; made.add(id);
      if (completed) await cmd("item_complete", { id });
      return id;
    },
    cleanup: async () => {
      for (const id of made) { try { await cmd("item_delete", { id }); } catch { /* already gone */ } }
      try { await cmd("project_delete", { id: projectId }); } catch (e) { note(`could not delete the Todoist project: ${e}`); }
    },
  };
}

async function asanaAdapter(): Promise<Adapter> {
  const token = process.env.ASANA_ACCESS_TOKEN || "proxy-injected";
  const workspace = process.env.ASANA_WORKSPACE || "Harold test";
  const api = async (method: string, path: string, data?: Record<string, unknown>) => {
    const r = await recFetch(`${ASANA_API}${path}`, { method, headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(data ? { "Content-Type": "application/json" } : {}) }, body: data ? JSON.stringify({ data }) : undefined });
    const j = await r.json() as { data?: Record<string, unknown>; errors?: unknown };
    if (!r.ok) throw new Error(`Asana ${method} ${path}: HTTP ${r.status} ${JSON.stringify(j.errors)}`);
    return j.data as Record<string, unknown>;
  };
  const ws = ((await api("GET", "/workspaces")) as unknown as { gid: string; name: string }[]).find(w => w.name === workspace);
  if (!ws) throw new Error(`no Asana workspace "${workspace}"`);
  const projects = (await api("GET", `/projects?workspace=${ws.gid}&archived=false&opt_fields=name`)) as unknown as { gid: string; name: string }[];
  const proj = projects.find(p => p.name === (process.env.ASANA_TEST_PROJECT || PROJECT));
  if (!proj) throw new Error(`no Asana project "${PROJECT}"`);
  const tagsBefore = new Set(((await api("GET", `/workspaces/${ws.gid}/tags?opt_fields=name`)) as unknown as { gid: string }[]).map(t => t.gid));
  const provider = new AsanaProvider({ token, workspace, project: scoped ? proj.name : null, hookToken: "" }, map, recFetch);
  return {
    provider, teamKey: scoped ? proj.name : null, skip: ["priority"], deletion: "gap",
    marker: i => `tags=${JSON.stringify(((i.extra as { tags?: { name: string }[] }).tags || []).map(t => t.name))} completed=${(i.extra as { completed?: boolean }).completed}`,
    expectMarker: s => s === "in_progress" ? "in-progress" : s === "cancelled" ? "cancelled" : null,
    userEdit: async (id, title, due) => { await api("PUT", `/tasks/${id}`, { name: title, due_on: due }); },
    userComplete: async id => { await api("PUT", `/tasks/${id}`, { completed: true }); },
    userReopen: async id => { await api("PUT", `/tasks/${id}`, { completed: false }); },
    userDelete: async id => { await api("DELETE", `/tasks/${id}`); },
    userCreate: async (title, completed) => {
      const t = await api("POST", "/tasks", { name: title, projects: [proj.gid], ...(completed ? { completed: true } : {}) });
      made.add(String(t.gid));
      return String(t.gid);
    },
    cleanup: async () => {
      for (const id of made) { try { await api("DELETE", `/tasks/${id}`); } catch { /* already gone */ } }
      // Tags the provider created during this run (in-progress, cancelled): removed so the next run creates them again.
      const tags = (await api("GET", `/workspaces/${ws.gid}/tags?opt_fields=name`)) as unknown as { gid: string; name: string }[];
      for (const t of tags) if (!tagsBefore.has(t.gid)) { try { await api("DELETE", `/tags/${t.gid}`); note(`deleted tag "${t.name}" made by this run`); } catch (e) { note(`could not delete tag ${t.name}: ${e}`); } }
    },
  };
}

async function notionAdapter(): Promise<Adapter> {
  const token = process.env.NOTION_TOKEN || "proxy-injected";
  const api = async (method: string, path: string, body?: unknown) => {
    const r = await recFetch(`${NOTION_API}${path}`, { method, headers: { Authorization: `Bearer ${token}`, "Notion-Version": NOTION_VERSION, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json() as Record<string, unknown>;
    if (!r.ok) throw new Error(`Notion ${method} ${path}: HTTP ${r.status} ${j.message}`);
    return j;
  };
  // 7. sync_setup_notion: propose, then confirm, against the real data source.
  const name = process.env.NOTION_DATA_SOURCE || "Harold tasks";
  const deps = { store: () => store, fetch: recFetch, now: Date.now, config: () => ({ token, webhookSecret: "" }), baseUrl: () => "https://connector.example" };
  const listed = await setupNotion({}, deps);
  writeFileSync(new URL("setup-list.txt", outDir), listed.text);
  const proposed = await setupNotion({ database: name }, deps);
  writeFileSync(new URL("setup-proposal.txt", outDir), proposed.text);
  check("7a setup proposes a mapping", !proposed.isError && proposed.text.includes("Proposed mapping"), proposed.isError ? proposed.text.split("\n")[0] : "");
  console.log(proposed.text.split("\n").map(l => `      | ${l}`).join("\n"));
  const confirmed = await setupNotion({ database: name, confirm: true }, deps);
  const setup = (await loadNotionState(store)).setup;
  check("7b setup confirm saves it", !confirmed.isError && !!setup, confirmed.isError ? confirmed.text.split("\n")[0] : "");
  if (!setup) throw new Error("Notion setup was not saved");
  const ds = setup.data_source_id;
  const statusProp = setup.fields.status;
  const statusValue = (opt: string) => setup.status_type === "status" ? { status: { name: opt } } : { select: { name: opt } };
  const provider = new NotionProvider({ token, webhookSecret: "" }, setup, map, recFetch);
  const priorityOptionsBefore = ((await api("GET", `/data_sources/${ds}`)).properties as Record<string, { select?: { options: unknown[] } }>)[setup.fields.priority || ""]?.select?.options.length ?? 0;
  return {
    // A data source query never returns a trashed page, so only the webhook (page.deleted) reports a trash.
    provider, teamKey: null, deletion: "gap",
    readsBackAs: st => setup.status_in[statusOption(st, setup) ?? ""] ?? st,
    // The test database has no project property: projects are not synced.
    skip: setup.fields.project ? [] : ["project"],
    marker: i => `status option=${JSON.stringify((i.extra as { statusOption?: string }).statusOption)}`,
    expectMarker: s => statusOption(s, setup),
    userEdit: async (id, title, due) => {
      await api("PATCH", `/pages/${id}`, { properties: { [setup.fields.title]: { title: [{ text: { content: title } }] }, ...(setup.fields.due ? { [setup.fields.due]: { date: { start: due } } } : {}) } });
    },
    userComplete: async id => { await api("PATCH", `/pages/${id}`, { properties: { [statusProp]: statusValue(setup.status_map.completed!) } }); },
    userReopen: async id => { await api("PATCH", `/pages/${id}`, { properties: { [statusProp]: statusValue(setup.status_map.pending!) } }); },
    userDelete: async id => { await api("PATCH", `/pages/${id}`, { in_trash: true }); },
    userCreate: async (title, completed) => {
      const p = await api("POST", "/pages", { parent: { type: "data_source_id", data_source_id: ds }, properties: { [setup.fields.title]: { title: [{ text: { content: title } }] }, [statusProp]: statusValue(completed ? setup.status_map.completed! : setup.status_map.pending!) } });
      made.add(String(p.id));
      return String(p.id);
    },
    cleanup: async () => {
      for (const id of made) { try { await api("PATCH", `/pages/${id}`, { in_trash: true }); } catch { /* already gone */ } }
      // Priority options the run added by writing them (Notion creates a select option on write): removed again.
      if (setup.fields.priority && priorityOptionsBefore === 0) {
        try { await api("PATCH", `/data_sources/${ds}`, { properties: { [setup.fields.priority]: { select: { options: [] } } } }); } catch (e) { note(`could not reset the priority options: ${e}`); }
      }
    },
  };
}

// ───────────── the run ─────────────

const adapter = which === "todoist" ? await todoistAdapter() : which === "asana" ? await asanaAdapter() : await notionAdapter();
const { provider } = adapter;
const engine = new SyncEngine(store, provider, map, { teamKey: adapter.teamKey });
const linkOf = (taskId: string) => store.links.find(l => l.task_id === taskId && l.provider === provider.name);
const catchup = async (label: string) => { const r = await engine.catchup(); note(`catchup ${label}: ${summary(r.counts)}`); return r; };
const errorsSince = (n: number) => store.logs.slice(n).filter(l => l.kind === "error").map(l => JSON.stringify(l.detail));

try {
  // A baseline catchup, so whatever the account already holds is in the store before the checks start.
  await catchup("baseline");
  const logMark = store.logs.length;

  // 1. Harold -> tool
  const due0 = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  const t0 = store.addHaroldTask({ title: `Live test ${RUN}`, notes: "Made by scripts/live-test.ts", due: due0, priority: "high", project: PROJECT });
  const r1 = await engine.fromHarold(t0);
  const link1 = linkOf(t0.id);
  const extId = link1?.external_id || "";
  if (extId && !isPlaceholder(extId)) made.add(extId);
  check("1a create: outcome created", r1.outcome === "created", `${r1.outcome}${errorsSince(logMark).length ? `; ${errorsSince(logMark).join("; ")}` : ""}`);
  check("1b link re-keyed from the placeholder to the real id", !!link1 && !isPlaceholder(extId) && link1.synced_at !== null, extId);
  const got1 = extId ? await provider.getOne(extId) : null;
  const diff1 = got1 ? differences(t0, got1, adapter.skip) : ["not found"];
  check("1c getOne reads it back with the same fields", diff1.length === 0, diff1.join("; ") || show(got1!.fields));
  if (!got1) throw new Error("create failed; stopping");
  note(`created ${got1.externalKey} ${got1.externalUrl}`);

  // 2. Harold edits, one step at a time; each must reach the tool and nothing may echo back.
  const steps: [string, Partial<HaroldFields>][] = [
    ["title, due and notes", { title: `Live test ${RUN} (edited)`, due: new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10), notes: "Edited in Harold" }],
    ["in_progress", { status: "in_progress" }],
    ["completed", { status: "completed" }],
    ["cancelled", { status: "cancelled" }],
    ["reopened", { status: "pending" }],
  ];
  for (const [label, patch] of steps) {
    const mark = store.logs.length;
    const t = store.editInHarold(t0.id, patch);
    const r = await engine.fromHarold(t);
    const item = await provider.getOne(extId);
    const d = item ? differences({ ...t, status: adapter.readsBackAs?.(t.status) ?? t.status }, item, adapter.skip) : ["not found"];
    const want = patch.status ? adapter.expectMarker(patch.status, item!) : null;
    const m = item ? adapter.marker(item) : "";
    // Todoist/Asana: in_progress and cancelled carry their label/tag, pending and completed carry neither.
    const markerOk = !patch.status || (want !== null ? m.includes(JSON.stringify(want).slice(1, -1)) : !/in-progress|cancelled/.test(m));
    // Several Harold statuses can share one option (Notion: cancelled written as Done); then there is nothing to send.
    const same = !!patch.status && adapter.readsBackAs?.(patch.status) !== undefined && adapter.readsBackAs(patch.status) !== patch.status;
    check(`2 ${label}: reaches the tool`, (r.outcome === "pushed" || same && r.outcome === "unchanged") && d.length === 0 && markerOk, `${r.outcome}; ${m}${d.length ? `; ${d.join("; ")}` : ""}${errorsSince(mark).length ? `; ${errorsSince(mark).join("; ")}` : ""}`);
    const c = await catchup(`after ${label}`);
    check(`2 ${label}: no echo on catchup`, !changedAnything(c.counts), summary(c.counts));
  }

  // 3. tool -> Harold: an edit, then a completion, made through the tool's own API.
  const title3 = `Live test ${RUN} (edited in ${provider.displayName})`, due3 = new Date(Date.now() + 21 * 86_400_000).toISOString().slice(0, 10);
  const agreedStamp = linkOf(t0.id)?.external_updated_at;
  await adapter.userEdit(extId, title3, due3);
  await sleep(1500);
  const c3 = await catchup("after the tool edit");
  const t3 = (await store.getTask(t0.id))!;
  if (provider.coarseTimestamps) {
    const stamp = (await provider.getOne(extId))?.updatedAt;
    note(`last_edited_time before the tool edit ${agreedStamp}, after ${stamp}: ${stamp === agreedStamp ? "same minute (caught by the coarse-timestamp rule)" : "a later minute"}`);
  }
  check("3a tool edit reaches Harold on catchup", t3.title === title3 && t3.due === due3, `${summary(c3.counts)}; harold title=${JSON.stringify(t3.title)} due=${t3.due}`);
  await adapter.userComplete(extId);
  await sleep(1500);
  const c3b = await catchup("after completing in the tool");
  const t3b = (await store.getTask(t0.id))!;
  check("3b completing in the tool reaches Harold", t3b.status === "completed", `${summary(c3b.counts)}; harold status=${t3b.status}`);

  // 4. Nothing changed: nothing reported.
  const c4 = await catchup("with no changes");
  check("4a a second catchup reports nothing", !changedAnything(c4.counts), summary(c4.counts));
  const c4b = await catchup("again");
  check("4b and a third", !changedAnything(c4b.counts), summary(c4b.counts));
  if (which === "todoist") {
    const st = await store.getState("todoist");
    check("4c sync_token stored and reused", typeof st?.detail.cursor_token === "string" && (st.detail.cursor_token as string).length > 10);
  }

  // 6. Import: open and recently completed items.
  const openId = await adapter.userCreate(`Live test ${RUN} import open`, false);
  const doneId = await adapter.userCreate(`Live test ${RUN} import done`, true);
  await sleep(1500);
  const imported = await provider.listForImport(30);
  const items = Array.isArray(imported) ? imported : imported.items;
  const o = items.find(i => i.externalId === openId), dn = items.find(i => i.externalId === doneId);
  check("6 listForImport: open and recently completed items", !!o && o.fields.status === "pending" && !!dn && dn.fields.status === "completed",
    `${items.length} items; open ${o ? o.fields.status : "missing"}, done ${dn ? dn.fields.status : "missing"}`);

  // 5. Deletion in the tool: reopen in the tool first, so Harold's task is open, then delete.
  await adapter.userReopen(extId);
  await sleep(1500);
  await catchup("after reopening in the tool");
  const before5 = (await store.getTask(t0.id))!.status;
  await adapter.userDelete(extId);
  made.delete(extId);
  await sleep(1500);
  const c5 = await catchup("after deleting in the tool");
  const after5 = (await store.getTask(t0.id))!.status;
  if (adapter.deletion === "cancelled") check("5 deleted in the tool -> cancelled in Harold", before5 !== "cancelled" && after5 === "cancelled", `${before5} -> ${after5}; ${summary(c5.counts)}`);
  else check("5 deleted in the tool: documented gap (Harold unchanged without the webhook)", after5 === before5, `${before5} -> ${after5}; ${summary(c5.counts)}`);
  const gone = await provider.getOne(extId);
  note(`getOne after the delete: ${gone ? `found, removed=${gone.removed}` : "null"}`);
  if (adapter.deletion === "gap" || after5 !== "cancelled") {
    // What a later Harold edit does: the engine finds the item gone and logs a skip.
    const mark = store.logs.length;
    const r = await engine.fromHarold(store.editInHarold(t0.id, { notes: "edited after the delete" }));
    note(`a Harold edit after the delete: ${r.outcome}; ${store.logs.slice(mark).map(l => `${l.kind} ${JSON.stringify(l.detail)}`).join("; ")}`);
  }
} catch (e) {
  check("run completed without an exception", false, e instanceof Error ? e.stack || e.message : String(e));
} finally {
  await adapter.cleanup().catch(e => note(`cleanup failed: ${e}`));
  writeFileSync(new URL("calls.jsonl", outDir), calls.join("\n") + "\n");
  writeFileSync(new URL("store.json", outDir), JSON.stringify({ tasks: [...store.tasks.values()], links: store.links, logs: store.logs, state: [...store.state.entries()] }, null, 2));
  const failed = results.filter(r => !r.ok);
  console.log(`\n${provider.displayName}: ${results.length - failed.length}/${results.length} checks passed.${failed.length ? ` Failed: ${failed.map(f => f.id).join(", ")}` : ""}`);
  process.exitCode = failed.length;
}
