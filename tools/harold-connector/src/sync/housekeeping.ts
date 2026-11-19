// Work the sync cannot do from its own routes, because those routes have no GitHub access: the connector
// holds no GitHub token of its own. Authenticated MCP requests carry the owner's token, so they do it in
// passing, rate-limited:
//
//   - the project-map cache: harold/projects.md, parsed, in sync_state 'harold-projects'
//     ({projects: [{name, aliases, folder, linear_project, provider_projects?}], read_at}), refreshed at most every 10 minutes.
//     The sync routes read only this cache; without it they fail closed (project mapping need it).
//   - harold/tasks-snapshot.md: rewritten only when the open-task list changed since the last write (hash in
//     sync_state 'harold-snapshot'), at most every 30 minutes. The daily morning-brief job is an authenticated
//     request, so the snapshot is at least a day fresh.

import { createHash } from "node:crypto";
import type { HaroldRepo } from "../github.js";
import { ProjectMap, type CachedProject } from "./projectmap.js";
import { KNOWN_PROVIDERS } from "./registry.js";
import { SNAPSHOT_MIN_INTERVAL_MS, SNAPSHOT_PATH, renderSnapshot } from "./snapshot.js";
import type { SyncStore } from "./store.js";

export const PROJECTS_STATE = "harold-projects";
export const SNAPSHOT_STATE = "harold-snapshot";
export const PROJECTS_REFRESH_MS = 10 * 60_000;
export const PROJECTS_STALE_MS = 7 * 86_400_000;

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function refreshProjectCache(store: SyncStore, repo: HaroldRepo, now: number): Promise<"written" | "fresh" | "missing"> {
  const st = await store.getState(PROJECTS_STATE);
  const readAt = Date.parse(String(st?.detail.read_at || "")) || 0;
  if (now - readAt < PROJECTS_REFRESH_MS) return "fresh";
  const f = await repo.getText("harold/projects.md");
  if (!f) return "missing";
  const map = ProjectMap.fromMarkdown(f.text);
  await store.setState(PROJECTS_STATE, { cursor: null, detail: { projects: map.toCache(), read_at: new Date(now).toISOString() } });
  return "written";
}

export interface CachedMap { map: ProjectMap; readAt: string; stale: boolean }

export async function loadProjectCache(store: SyncStore, now: number): Promise<CachedMap | null> {
  const st = await store.getState(PROJECTS_STATE);
  const list = st?.detail.projects as CachedProject[] | undefined;
  const readAt = String(st?.detail.read_at || "");
  if (!Array.isArray(list) || !list.length || !readAt) return null;
  return { map: ProjectMap.fromCache(list), readAt, stale: now - (Date.parse(readAt) || 0) > PROJECTS_STALE_MS };
}

/** The snapshot's content without its "Written ..." line, hashed: equal hashes mean nothing to write. */
const contentHash = (text: string) => createHash("sha256").update(text.split("\n").filter(l => !l.startsWith("*Written ")).join("\n")).digest("hex");

export async function maybeWriteSnapshot(store: SyncStore, repo: HaroldRepo, now: number): Promise<{ written: boolean; reason?: string }> {
  const st = (await store.getState(SNAPSHOT_STATE)) ?? { cursor: null, detail: {} };
  const last = Date.parse(String(st.detail.written_at || "")) || 0;
  if (now - last < SNAPSHOT_MIN_INTERVAL_MS) return { written: false, reason: "written less than 30 minutes ago" };
  const tasks = await store.openTasks();
  const links = [];
  for (const p of KNOWN_PROVIDERS) links.push(...(await store.linksForTasks(p, tasks.map(t => t.id))));
  const text = renderSnapshot(tasks, links, now);
  const hash = contentHash(text);
  if (hash === st.detail.hash) return { written: false, reason: "open tasks unchanged" };
  const r = await repo.commit(SNAPSHOT_PATH, () => ({ text }), "chore(connector): tasks snapshot");
  if (!r.ok) return { written: false, reason: r.reason };
  await store.setState(SNAPSHOT_STATE, { cursor: null, detail: { hash, written_at: new Date(now).toISOString() } });
  return { written: true };
}

/**
 * The per-request hook: cheap when there is nothing to do (an in-memory check per instance, then one
 * sync_state read per minute). Never throws: housekeeping must not break the owner's request.
 */
export function makeHousekeeper(store: () => SyncStore | null, now: () => number = Date.now, everyMs = 60_000) {
  let lastRun = 0;
  let running: Promise<void> | null = null;
  return (repo: HaroldRepo): Promise<void> => {
    if (running) return running;
    const t = now();
    if (t - lastRun < everyMs) return Promise.resolve();
    const s = store();
    if (!s) return Promise.resolve();
    lastRun = t;
    running = (async () => {
      try { await refreshProjectCache(s, repo, t); } catch (e) { console.error("sync housekeeping (projects):", msg(e)); }
      try { await maybeWriteSnapshot(s, repo, t); }
      catch (e) {
        console.error("sync housekeeping (snapshot):", msg(e));
        await s.log({ kind: "error", provider: "linear", detail: { phase: "snapshot", error: msg(e) } }).catch(() => undefined);
      }
    })().finally(() => { running = null; });
    return running;
  };
}
