// First import from each configured provider (Linear, Todoist, Asana, Notion) into Harold's task list: every open item plus those
// completed in the last 30 days, each with its task_links row and a sync_log 'import' row. Idempotent: an item that
// is already linked is reconciled, never imported twice (task_links is unique on provider + external_id, and an
// imported task's id is derived from the provider and item id).
//
//   npm run sync:import             # every configured provider
//   npm run sync:import -- todoist  # one provider
//   needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and a provider (LINEAR_API_KEY + LINEAR_TEAM_KEY, or TODOIST_API_TOKEN, or ASANA_ACCESS_TOKEN + ASANA_WORKSPACE, or NOTION_TOKEN after sync_setup_notion)
//
// The project map comes from the cache in sync_state 'harold-projects', which any authenticated MCP request
// fills. If it is empty, a GitHub token from GITHUB_TOKEN or a signed-in `gh` CLI (memory only) fills it first.
// The same import runs in the deployment with POST /sync/catchup {"import": true}.

import { execFileSync } from "node:child_process";
import { repoConfig } from "../src/config.js";
import { HaroldRepo } from "../src/github.js";
import { SyncEngine } from "../src/sync/engine.js";
import { loadProjectCache, refreshProjectCache } from "../src/sync/housekeeping.js";
import { defaultSyncDeps } from "../src/sync/routes.js";

const fail = (m: string): never => { console.error(m); process.exit(1); };
const ghToken = () => {
  const t = (process.env.GITHUB_TOKEN || "").trim();
  if (t) return t;
  try { return execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim(); } catch { return ""; }
};

const deps = defaultSyncDeps((i, init) => fetch(i, init));
const only = (process.argv[2] || "").trim().toLowerCase();
const entries = deps.providers().filter(e => !only || e.name === only);
if (!entries.length) fail(only ? `Provider "${only}" is not configured.` : "No provider configured: set LINEAR_API_KEY and LINEAR_TEAM_KEY, or TODOIST_API_TOKEN, or ASANA_ACCESS_TOKEN + ASANA_WORKSPACE, or NOTION_TOKEN.");
const store = deps.store() ?? fail("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
let cached = await loadProjectCache(store, Date.now());
if (!cached) {
  const tok = ghToken() || fail("No cached project map, and no GitHub token (GITHUB_TOKEN or `gh auth login`) to read harold/projects.md. The project map needs it.");
  const c = repoConfig();
  await refreshProjectCache(store, new HaroldRepo(tok, c.repo, c.branch), Date.now());
  cached = (await loadProjectCache(store, Date.now())) ?? fail("harold/projects.md could not be read.");
}
let errors = 0;
for (const entry of entries) {
  const notReady = entry.prepare ? await entry.prepare(store) : null; // Notion: its setup lives in sync_state
  if (notReady) { console.log(JSON.stringify({ provider: entry.name, skipped: notReady })); continue; }
  const engine = new SyncEngine(store, entry.build(cached.map), cached.map, { teamKey: entry.scope });
  const r = await engine.catchup({ import: true });
  errors += r.counts.errors;
  console.log(JSON.stringify({ provider: entry.name, scope: entry.scope, project_map_read_at: cached.readAt, ...r }, null, 2));
}
if (errors) { console.error(`${errors} error(s): see sync_log where kind = 'error'.`); process.exit(2); }
