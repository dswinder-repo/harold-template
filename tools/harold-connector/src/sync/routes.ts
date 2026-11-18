// The sync's HTTP surface, all POST and all JSON:
//   POST /webhooks/linear   Linear's webhook (Linear-Signature HMAC + webhookTimestamp within 60 s)
//   POST /sync/push         {task_id}: one Harold change out to Linear (called by the pg_net trigger)
//   POST /sync/catchup      {} or {"import": true}: both directions since the cursor (pg_cron, every 10 min)
// /sync/* need header x-harold-sync-secret equal to SYNC_SECRET (constant-time compare).
//
// Fails closed: project mapping need the project map, which these routes read only from the cache that
// authenticated MCP requests keep in sync_state (housekeeping.ts). No cache: 503 and nothing syncs.

import type { Context, Hono } from "hono";
import { createHash, timingSafeEqual } from "node:crypto";
import type { HaroldRepo } from "../github.js";
import type { FetchLike } from "../identity.js";
import { SyncEngine } from "./engine.js";
import { PROJECTS_STALE_MS, loadProjectCache, makeHousekeeper } from "./housekeeping.js";
import { LinearProvider, linearSyncFromEnv, verifyLinearWebhook, type LinearSyncConfig } from "./linear.js";
import { ProjectMap } from "./projectmap.js";
import type { SyncProvider } from "./provider.js";
import { syncStoreFromEnv, type SyncStore } from "./store.js";

export interface SyncDeps {
  store: () => SyncStore | null;
  linear: () => LinearSyncConfig | null;
  /** The cached project map (sync_state 'harold-projects'), or null when there is none (then nothing syncs). */
  projects: (store: SyncStore) => Promise<{ map: ProjectMap; readAt: string; stale: boolean } | null>;
  /** Called on authenticated MCP requests with the owner's repository handle: refreshes the project-map
   *  cache and the tasks snapshot when due. Resolves quickly when there is nothing to do; never rejects. */
  housekeeping: (repo: HaroldRepo) => Promise<void>;
  syncSecret: () => string;
  now: () => number;
  provider: (cfg: LinearSyncConfig, map: ProjectMap) => SyncProvider;
}

export function defaultSyncDeps(fetchImpl: FetchLike): SyncDeps {
  return {
    store: syncStoreFromEnv,
    linear: linearSyncFromEnv,
    projects: store => loadProjectCache(store, Date.now()),
    housekeeping: makeHousekeeper(syncStoreFromEnv),
    syncSecret: () => (process.env.SYNC_SECRET || "").trim(),
    now: Date.now,
    provider: (cfg, map) => new LinearProvider(cfg, map, fetchImpl),
  };
}

/** Constant-time string equality (both sides hashed first, so lengths never leak or throw). */
export function secretEquals(given: string | null | undefined, want: string): boolean {
  if (!want || !given) return false;
  const a = createHash("sha256").update(given).digest(), b = createHash("sha256").update(want).digest();
  return timingSafeEqual(a, b);
}

const json = (c: Context, body: unknown, status = 200) => c.json(body as object, status as 200);
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function registerSyncRoutes(app: Hono, deps: SyncDeps) {
  let staleLoggedAt = 0;
  /** Everything a sync call needs, or the JSON error to answer with. */
  const setup = async (c: Context) => {
    const cfg = deps.linear();
    if (!cfg) return { error: json(c, { ok: false, error: "Linear is not configured (LINEAR_API_KEY, LINEAR_TEAM_KEY)" }, 503) };
    const store = deps.store();
    if (!store) return { error: json(c, { ok: false, error: "Supabase is not configured (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)" }, 503) };
    const cached = await deps.projects(store);
    if (!cached) return { error: json(c, { ok: false, error: "no cached project map yet (it is filled by any authenticated MCP request), so project mapping cannot be checked: nothing synced" }, 503) };
    const map = cached.map;
    if (cached.stale && deps.now() - staleLoggedAt > 3_600_000) {
      staleLoggedAt = deps.now();
      await store.log({ kind: "skip", provider: "linear", detail: { reason: `project map cache is older than ${PROJECTS_STALE_MS / 86_400_000} days; still used`, read_at: cached.readAt } });
    }
    const provider = deps.provider(cfg, map);
    return { cfg, store, map, provider, engine: new SyncEngine(store, provider, map, { teamKey: cfg.team, now: deps.now }) };
  };

  app.post("/webhooks/linear", async c => {
    const raw = await c.req.raw.text();
    const cfg = deps.linear();
    // Verify before anything else touches the request (no GitHub or database call for a forged one).
    const v = verifyLinearWebhook(raw, c.req.header("linear-signature") ?? null, cfg?.webhookSecret || "", deps.now());
    if (!v.ok) return json(c, { ok: false, error: v.reason }, v.status);
    if (!v.events.length) return json(c, { ok: true, ignored: true });
    const s = await setup(c);
    if ("error" in s) return s.error;
    try {
      const results = await s.engine.webhook(v.events);
      return json(c, { ok: true, results });
    } catch (e) {
      await s.store.log({ kind: "error", provider: s.provider.name, external_id: v.events[0]?.externalId, detail: { phase: "webhook", error: msg(e) } });
      return json(c, { ok: false, error: msg(e) }, 500);
    }
  });

  const authed = (c: Context) => secretEquals(c.req.header("x-harold-sync-secret"), deps.syncSecret());

  app.post("/sync/push", async c => {
    if (!deps.syncSecret()) return json(c, { ok: false, error: "SYNC_SECRET is not set" }, 503);
    if (!authed(c)) return json(c, { ok: false, error: "unauthorized" }, 401);
    let body: { task_id?: unknown } = {};
    try { body = await c.req.json(); } catch { /* handled below */ }
    if (typeof body.task_id !== "string" || !body.task_id.trim()) return json(c, { ok: false, error: "body must be {\"task_id\": \"<uuid>\"}" }, 400);
    const s = await setup(c);
    if ("error" in s) return s.error;
    try {
      const task = await s.store.getTask(body.task_id.trim());
      if (!task) return json(c, { ok: false, error: "no such task" }, 404);
      const r = await s.engine.fromHarold(task);
      return json(c, { ok: r.outcome !== "error", ...r });
    } catch (e) {
      await s.store.log({ kind: "error", provider: s.provider.name, task_id: body.task_id, detail: { phase: "push", error: msg(e) } });
      return json(c, { ok: false, error: msg(e) }, 500);
    }
  });

  app.post("/sync/catchup", async c => {
    if (!deps.syncSecret()) return json(c, { ok: false, error: "SYNC_SECRET is not set" }, 503);
    if (!authed(c)) return json(c, { ok: false, error: "unauthorized" }, 401);
    let body: { import?: unknown } = {};
    try { body = await c.req.json(); } catch { /* an empty body is a plain catchup */ }
    const s = await setup(c);
    if ("error" in s) return s.error;
    try {
      const r = await s.engine.catchup({ import: body.import === true });
      return json(c, { ok: true, import: body.import === true, ...r });
    } catch (e) {
      await s.store.log({ kind: "error", provider: s.provider.name, detail: { phase: "catchup", error: msg(e) } });
      return json(c, { ok: false, error: msg(e) }, 500);
    }
  });
}
