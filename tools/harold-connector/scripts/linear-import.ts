// First import from Linear into Harold's task list: every open issue of LINEAR_TEAM_KEY plus those completed in
// the last 30 days, each with its task_links row and a sync_log 'import' row. Idempotent: an issue that is
// already linked is reconciled, never imported twice (task_links is unique on provider + external_id, and an
// imported task's id is derived from the issue id).
//
//   npm run sync:import    # needs LINEAR_API_KEY, LINEAR_TEAM_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
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
const cfg = deps.linear() ?? fail("Set LINEAR_API_KEY and LINEAR_TEAM_KEY.");
const store = deps.store() ?? fail("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
let cached = await loadProjectCache(store, Date.now());
if (!cached) {
  const tok = ghToken() || fail("No cached project map, and no GitHub token (GITHUB_TOKEN or `gh auth login`) to read harold/projects.md. The project map needs it.");
  const c = repoConfig();
  await refreshProjectCache(store, new HaroldRepo(tok, c.repo, c.branch), Date.now());
  cached = (await loadProjectCache(store, Date.now())) ?? fail("harold/projects.md could not be read.");
}
const provider = deps.provider(cfg, cached.map);
const engine = new SyncEngine(store, provider, cached.map, { teamKey: cfg.team });

const r = await engine.catchup({ import: true });
console.log(JSON.stringify({ team: cfg.team, project_map_read_at: cached.readAt, ...r }, null, 2));
if (r.counts.errors) { console.error(`${r.counts.errors} error(s): see sync_log where kind = 'error'.`); process.exit(2); }
