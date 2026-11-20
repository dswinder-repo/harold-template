// harold_heartbeat: a short, dated line a session files at each finished piece of work (and at least once a day
// while active), stored in the project's own folder (<folder>/heartbeats.jsonl). harold_pulse reads these first, so
// a project's activity comes from what its own sessions said they finished, not from unrelated notes that merely
// mention the project. One JSON object per line; append-only.

import type { HaroldRepo } from "./github.js";
import { parseProjects, rankProjects } from "./projects.js";
import { slugify } from "./text.js";

export const HEARTBEAT_FILE = "heartbeats.jsonl";
/** Where a project's heartbeats live: in the project's own folder from harold/projects.md. A project without a usable folder falls back to harold/heartbeats/<name>.jsonl. */
export function heartbeatPath(p: { name: string; folder?: unknown }): string {
  const f = String(p.folder || "").trim().replace(/^`+|`+$/g, "").trim().replace(/^\.\/+/, "").replace(/\/+$/, "");
  const ok = f && f !== "." && !f.startsWith("/") && !f.split("/").includes("..");
  return ok ? `${f}/${HEARTBEAT_FILE}` : `harold/heartbeats/${slugify(p.name)}.jsonl`;
}

export interface Waiting { what: string; due?: string }
export interface Heartbeat {
  date: string; time: string; project: string; done: string; running?: string; waiting?: Waiting[]; file?: string; source: string;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function heartbeatLine(h: Heartbeat): string {
  const o: Record<string, unknown> = { date: h.date, time: h.time, project: h.project, done: h.done.trim() };
  if (h.running?.trim()) o.running = h.running.trim();
  if (h.waiting?.length) o.waiting = h.waiting.map(w => ({ what: w.what.trim(), ...(w.due ? { due: w.due } : {}) }));
  if (h.file?.trim()) o.file = h.file.trim();
  o.source = h.source;
  return JSON.stringify(o);
}

export function parseHeartbeats(text: string): Heartbeat[] {
  const rows: Heartbeat[] = [];
  for (const line of (text || "").split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const o = JSON.parse(t) as Heartbeat;
      if (o && ISO.test(String(o.date)) && typeof o.done === "string") rows.push(o);
    } catch { /* skip a damaged line */ }
  }
  return rows;
}

/** The newest heartbeat dated on or before `today` (later ones are ignored, as for notes). Ties: the later line wins. */
export function latestHeartbeat(text: string, today: string): Heartbeat | null {
  let best: Heartbeat | null = null;
  for (const h of parseHeartbeats(text)) {
    if (h.date > today) continue;
    if (!best || h.date >= best.date) best = h;
  }
  return best;
}

export function appendHeartbeatText(current: string, h: Heartbeat): string {
  const base = current.length && !current.endsWith("\n") ? current + "\n" : current;
  return base + heartbeatLine(h) + "\n";
}

/**
 * The newest `n` heartbeats, newest first: by date, then time, then position in the file (a later line wins a tie).
 * Unlike latestHeartbeat there is no "on or before today" filter: this answers "what did the sessions last say", whatever date they wrote.
 */
export function newestHeartbeats(text: string, n: number): Heartbeat[] {
  return parseHeartbeats(text)
    .map((h, i) => ({ h, i }))
    .sort((a, b) => String(b.h.date).localeCompare(String(a.h.date)) || String(b.h.time || "").localeCompare(String(a.h.time || "")) || b.i - a.i)
    .slice(0, Math.max(1, n))
    .map(x => x.h);
}

export interface LatestResult { text: string; isError?: boolean; structured?: Record<string, unknown> }

/** harold_heartbeat_latest: read the project's live heartbeat file in full (never a truncated note read) and return the newest n. */
export async function latestHeartbeats(repo: HaroldRepo, a: { project: string; n?: number }): Promise<LatestResult> {
  const pf = await repo.getText("harold/projects.md");
  const ranked = pf ? rankProjects(parseProjects(pf.text), a.project) : [];
  if (!ranked.length) return { text: `No project matches "${a.project}" in harold/projects.md. Use harold_where to find the right name.`, isError: true };
  const proj = ranked[0].p;
  const path = heartbeatPath(proj);
  const f = await repo.getText(path);
  const rows = f ? newestHeartbeats(f.text, a.n ?? 1) : [];
  if (!rows.length) return { text: `No heartbeats filed for ${proj.name} (${path}).`, structured: { project: proj.name, path, heartbeats: [] } };
  const heartbeats = rows.map(h => ({
    date: h.date, time: h.time || "", done: h.done, running: h.running || "",
    waiting: (h.waiting || []).map(w => ({ what: w.what, ...(w.due ? { due: w.due } : {}) })), file: h.file || "",
  }));
  const text = `Latest ${rows.length === 1 ? "heartbeat" : `${rows.length} heartbeats`} for ${proj.name} (${path}), newest first:\n` + heartbeats.map(h =>
    [`- ${h.date} ${h.time}`.trimEnd() + ` · done: ${h.done.trim()}`,
      h.running ? `  running: ${h.running.trim()}` : "",
      h.waiting.length ? `  waiting: ${h.waiting.map(w => w.what + (w.due ? ` (due ${w.due})` : "")).join("; ")}` : "",
      h.file ? `  file: ${h.file}` : ""].filter(Boolean).join("\n")).join("\n");
  return { text, structured: { project: proj.name, path, heartbeats } };
}
