// harold/tasks-snapshot.md: the open tasks as a file in the repo, so a session without database access
// (or a human on GitHub) can still see them. Rewritten after a catchup that changed anything, at most
// once per 30 minutes. Times are in the owner's time zone (HAROLD_TZ).

import { tz } from "../config.js";
import type { LinkRow, TaskRow } from "./types.js";

export const SNAPSHOT_PATH = "harold/tasks-snapshot.md";
export const SNAPSHOT_MIN_INTERVAL_MS = 30 * 60_000;

/** YYYY-MM-DD of an instant in the owner's time zone. */
export function localDate(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz(), year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}

/** ISO 8601 with the owner's UTC offset, e.g. 2026-11-18T09:30:00-05:00. */
export function localIso(ms: number): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: tz(), hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(ms)).map(p => [p.type, p.value]));
  const local = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  const off = Math.round((local - Math.floor(ms / 1000) * 1000) / 60_000);
  const sign = off < 0 ? "-" : "+";
  const hh = String(Math.floor(Math.abs(off) / 60)).padStart(2, "0"), mm = String(Math.abs(off) % 60).padStart(2, "0");
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${sign}${hh}:${mm}`;
}

const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const PRI_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

export function renderSnapshot(tasks: TaskRow[], links: LinkRow[], nowMs: number): string {
  const today = localDate(nowMs);
  const weekEnd = addDays(today, 7);
  const byTask = new Map<string, LinkRow[]>();
  for (const l of links) byTask.set(l.task_id, [...(byTask.get(l.task_id) || []), l]);
  const groups: Record<string, TaskRow[]> = { "Overdue": [], "Due today": [], "Due this week": [], "In progress": [], "Later": [] };
  for (const t of tasks) {
    if (t.status !== "pending" && t.status !== "in_progress") continue;
    if (t.due && t.due < today) groups["Overdue"].push(t);
    else if (t.due === today) groups["Due today"].push(t);
    else if (t.due && t.due <= weekEnd) groups["Due this week"].push(t);
    else if (t.status === "in_progress") groups["In progress"].push(t);
    else groups["Later"].push(t);
  }
  const sort = (a: TaskRow, b: TaskRow) => (a.due || "9999").localeCompare(b.due || "9999") || (PRI_ORDER[a.priority || "low"] - PRI_ORDER[b.priority || "low"]) || a.title.localeCompare(b.title);
  const line = (t: TaskRow) => {
    const keys = (byTask.get(t.id) || []).filter(l => l.external_key).map(l => (l.external_url ? `[${l.external_key}](${l.external_url})` : l.external_key));
    const bits = [t.ref ? `**${t.ref}**` : null, t.title, t.project || "no project", t.due ? `due ${t.due}` : null, t.priority, t.status === "in_progress" ? "in progress" : null,
      ...keys].filter(Boolean);
    return `- ${bits.join(" · ")}`;
  };
  const out = ["# Tasks snapshot", "", `*Written ${localIso(nowMs)} by the connector sync.*`, "",
    "Open tasks from Harold's task list (Supabase), grouped by due date in the owner's time zone. Generated: edit tasks with the task tools or in a linked tool (Linear, Todoist, Asana, Notion), not here.", ""];
  for (const [name, list] of Object.entries(groups)) {
    out.push(`## ${name} (${list.length})`, "");
    out.push(...(list.length ? list.sort(sort).map(line) : ["- none"]), "");
  }
  return out.join("\n");
}
