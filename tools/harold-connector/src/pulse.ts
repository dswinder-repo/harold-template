// harold_pulse: which projects are active and which are quiet, with each active project's newest activity and next
// step. The same procedure as `bin/harold pulse` (pulse_data in bin/harold-index), over the same rows:
// harold/graph.json holds exactly what bin/harold-index computes from (nodes with the dates written in the notes,
// links, and the daily and meeting notes that name each project), the project map, task snapshot, card and README are
// read from the repository, and the commits touching the project's folder come from the GitHub API instead of
// `git log`. Same repository, same answer: test/unit/pulse-fixture.json is shared with the workspace's Python tests.
// Change one, change the other.
//
// Active is derived, never hand-set. status: in harold/projects.md holds only archived (finished) and autonomous
// (self-maintaining, never surfaced); those are never judged. A legacy active or paused is ignored. Any other project
// is ACTIVE when it has activity within HAROLD_PULSE_DAYS days of today (default 14), looking ahead as well as back;
// otherwise QUIET. Quiet projects are listed plainly and never nagged about. (The starter keeps no roster of the
// sessions managing each project, so activity alone decides.)
//
// Activity of a project (newest wins):
//   - its newest heartbeat, when it posts them (then it is judged by them alone);
//   - the meeting, daily and decision notes linked with its card (the `card:` field, else the project note whose
//     title or file name is the project's name), in either direction; the card's own date and person, company or
//     intel cards linking to it do not count;
//   - every note in its folder other than the card;
//   - open tasks of harold/tasks-snapshot.md for it and meeting notes dated ahead, within +-HAROLD_PULSE_DAYS of today;
//     past activity in the window wins, else the nearest upcoming item;
//   - meeting notes that name it without a link (its name or an alias, graph.json "mentions": bin/harold-index decides
//     which count, leaving out roll-ups such as a review that names every project);
//   - the newest commit that adds or changes files in its folder and touches no more than 3 projects' folders.
// Next step: the map entry's next_step, then the card's frontmatter next_step, then a "Next step: ..." line (or the
// first line under a "Next step" heading) in the card, then in <folder>/README.md.

import type { HaroldRepo } from "./github.js";
import { GRAPH_PATH, parseGraph, type Graph } from "./graph.js";
import { parseProjects, type Project } from "./projects.js";
import { heartbeatPath, latestHeartbeat, type Heartbeat } from "./heartbeat.js";

export const PROJECTS_PATH = "harold/projects.md";
export const TERMINAL = ["archived", "autonomous"];
const LABEL: Record<string, string> = {
  meeting: "meeting note", daily: "daily note", decision: "decision", intel: "intel note",
  person: "person card", company: "company card",
};
const OUT_TYPES = new Set(["meeting", "daily", "decision"]);
const VIA_RANK: Record<string, number> = { folder: 0, link: 1, mention: 2, plan: 3 };
export const TASKS_PATH = "harold/tasks-snapshot.md";
// One open task of the snapshot: - **ref** · title · project · due YYYY-MM-DD[ · priority ...]
const TASK_RE = /^\s*-\s+\*\*[^*]+\*\*\s+·\s+(.+)\s+·\s+(.+?)\s+·\s+due\s+(\d{4}-\d{2}-\d{2})(?:\s+·\s+.*)?\s*$/;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const NEXT_LINE = /^\s*(?:[-*+]\s+)?(?:\*\*|__)?next[ _-]?steps?(?:\*\*|__)?\s*:\s*(?:\*\*|__)?\s*(.*)$/i;
const NEXT_HEAD = /^#{1,6}\s+next[ _-]?steps?\s*:?\s*$/i;
const FM_BLOCK = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;

export interface PulseLast { kind: "note" | "commit" | "heartbeat"; date: string; path: string; title: string; via: string; label: string }
export interface PulseProject {
  name: string;
  /** "active" | "quiet" | the terminal word ("archived", "autonomous") */
  status: string;
  /** the first word of the map's status:, lowercased ("" when none) */
  set_status: string;
  folder: string; card: string;
  quiet: boolean | null; days: number | null; last: PulseLast | null;
  next_step: string; next_step_source: string;
}
export interface PulseData {
  today: string; pulse_days: number; git: string; active: number; quiet: number;
  projects: PulseProject[];
}

/** HAROLD_PULSE_DAYS on the connector, else the workspace's value carried in graph.json, else 14. */
export function pulseDays(g?: Graph): number {
  const raw = (process.env.HAROLD_PULSE_DAYS || "").trim();
  const n = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (Number.isFinite(n)) return n;
  return g && g.pulseDays !== null ? g.pulseDays : 14;
}

const cut = (s: string, max: number) => { const cps = [...s]; return cps.length <= max ? s : `${cps.slice(0, max - 1).join("")}…`; };

export function cleanStep(raw: string | undefined): string {
  let v = String(raw || "").trim();
  if (v.startsWith("#")) return "";
  v = v.replace(/\s+#\s.*$/, "").trim();
  if (v.length >= 2 && v[0] === v[v.length - 1] && (v[0] === '"' || v[0] === "'")) v = v.slice(1, -1);
  v = v.replace(/^(?:\*\*|__)+|(?:\*\*|__)+$/g, "").trim();
  v = v.split(/\s+/).filter(Boolean).join(" ");
  if (v.includes("{{")) return "";
  return cut(v, 200);
}

export function fmNextStep(text: string): string {
  const m = (text || "").match(FM_BLOCK);
  if (!m) return "";
  for (const line of m[0].split("\n")) {
    const k = line.replace(/\r$/, "").match(/^next_step:\s*(.*)$/);
    if (k) return cleanStep(k[1]);
  }
  return "";
}

/** A "Next step: ..." line (bold or a list item is fine), or the first line under a "Next step(s)" heading. */
export function bodyNextStep(text: string): string {
  const body = (text || "").replace(FM_BLOCK, "").replace(/<!--[\s\S]*?-->/g, "");
  const lines = body.split("\n").map(l => l.replace(/\r$/, ""));
  let fence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) { fence = !fence; continue; }
    if (fence) continue;
    const m = line.match(NEXT_LINE);
    if (m) { const v = cleanStep(m[1]); if (v) return v; continue; }
    if (NEXT_HEAD.test(line)) {
      for (const nxt of lines.slice(i + 1)) {
        if (/^#{1,6}\s/.test(nxt)) break;
        const v = cleanStep(nxt.replace(/^\s*(?:[-*+]|\d+\.)\s+(?:\[[ xX]\]\s+)?/, ""));
        if (v) return v;
      }
    }
  }
  return "";
}

export function normFolder(f: unknown): string {
  let s = String(f || "").trim().replace(/^`+|`+$/g, "").trim();
  s = s.replace(/^\.\/+/, "").replace(/\/+$/, "");
  return s === "" || s === "." || s.startsWith("/") || s.split("/").includes("..") ? "" : s;
}

export function findCard(p: Project, g: Graph): string {
  const c = String(p.card || "").trim().replace(/^`+|`+$/g, "").trim().replace(/^\.\/+/, "");
  if (c) return c;
  const name = p.name.toLowerCase();
  const stem = (x: string) => (x.split("/").pop() || x).replace(/\.[^.]+$/, "");
  const hits = [...g.nodes.values()].filter(n => n.type === "project" && (n.title.toLowerCase() === name || stem(n.path).toLowerCase() === name))
    .map(n => n.path).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return hits[0] || "";
}

/** "YYYY-MM-DD" of an ISO instant in the given IANA zone. */
export function dateIn(instant: string, tz: string): string {
  const d = new Date(instant);
  if (Number.isNaN(d.getTime())) return "";
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

const sorted = <T>(it: Iterable<T>) => [...it].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

export function addDays(iso: string, n: number): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)!;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + n)).toISOString().slice(0, 10);
}

export interface Plan { date: string; title: string; project: string }

/** Forward-looking work from the committed task snapshot (harold/tasks-snapshot.md, written by the connector's sync):
 *  open tasks due within win days of today, overdue ones included. As bin/harold-index read_plans. */
export function readPlans(tasksText: string | null, today: string, win: number): Plan[] {
  const lo = addDays(today, -win), hi = addDays(today, win);
  const tasks: Plan[] = [];
  for (const line of String(tasksText || "").split("\n")) {
    const m = TASK_RE.exec(line);
    if (m && m[3] >= lo && m[3] <= hi) tasks.push({ date: m[3], title: m[1].trim(), project: m[2].trim().toLowerCase() });
  }
  return tasks;
}

/** The newest dated activity of one project: a note (dates written in the note), a commit or an open task due
 *  (within win days either side of today). Past activity within the window wins; failing that the nearest thing
 *  coming up (a task due, a meeting note dated ahead). null when nothing. */
export function activity(p: Project, g: Graph, card: string, folder: string, today: string, commit: { date: string; subject: string } | null, hb: Heartbeat | null = null, tasks: Plan[] | null = null, win = 14): PulseLast | null {
  // A project that posts heartbeats is judged by them alone: its own sessions say what finished. Notes that merely
  // mention the project (a roll-up, another project's note) no longer make it look active.
  if (hb && ISO.test(hb.date) && hb.date <= today) {
    return { kind: "heartbeat", date: hb.date, path: heartbeatPath(p), title: cut(hb.done.trim().split("\n")[0], 72), via: "heartbeat", label: "heartbeat" };
  }
  const horizon = addDays(today, win);
  const cands: PulseLast[] = [], upcoming: PulseLast[] = [];
  const seen = new Set<string>();
  const put = (c: PulseLast) => (c.date > today ? upcoming : cands).push(c);
  const add = (path: string, via: string) => {
    const n = g.nodes.get(path);
    if (seen.has(path) || !n || n.type === "template") return;
    const d = n.last_updated || "";
    if (!ISO.test(d)) return;
    if (d > today && !(n.type === "meeting" && d <= horizon)) return;
    seen.add(path);
    put({ kind: "note", date: d, path, title: n.title, via, label: d > today ? "upcoming meeting" : LABEL[n.type] || "note" });
  };
  // The card's own date is not activity (cards get edited in bulk), nor are person, company or intel cards linking to it.
  for (const s of sorted(g.inn.get(card)?.keys() || [])) if (OUT_TYPES.has(g.nodes.get(s)?.type || "")) add(s, "link");
  for (const d of sorted(g.out.get(card)?.keys() || [])) if (OUT_TYPES.has(g.nodes.get(d)?.type || "")) add(d, "link");
  if (folder) for (const path of sorted(g.nodes.keys())) if (path.startsWith(`${folder}/`) && path !== card) add(path, "folder");
  for (const s of sorted(g.mentions.get(p.name) || [])) { if (g.nodes.get(s)?.type === "meeting") add(s, "mention"); }
  for (const t of tasks || []) if (t.project === p.name.toLowerCase()) put({ kind: "note", date: t.date, path: TASKS_PATH, title: t.title, via: "plan", label: "task due" });
  const lt = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const num = (c: PulseLast) => Number(c.date.replace(/-/g, ""));
  cands.sort((a, b) => num(b) - num(a) || VIA_RANK[a.via] - VIA_RANK[b.via] || lt(a.path, b.path) || lt(a.title, b.title));
  let best: PulseLast | null = cands[0] || null;
  if (commit && ISO.test(commit.date) && commit.date <= today && (!best || commit.date > best.date)) {
    best = { kind: "commit", date: commit.date, path: `${folder}/`, title: commit.subject, via: "git", label: "commit" };
  }
  if (best && best.date >= addDays(today, -win)) return best;
  if (upcoming.length) {
    upcoming.sort((a, b) => num(a) - num(b) || VIA_RANK[a.via] - VIA_RANK[b.via] || lt(a.path, b.path) || lt(a.title, b.title));
    return upcoming[0];
  }
  return best;
}

/** The first word of the map's status:, lowercased ("autonomous (side project; ...)" is "autonomous"). */
export function setStatus(p: Project): string {
  return (String(p.status || "").trim().toLowerCase().match(/^[a-z]+/) || [""])[0];
}

async function nextStep(repo: HaroldRepo, p: Project, card: string, folder: string): Promise<[string, string]> {
  const read = async (rel: string) => { try { return (await repo.getText(rel))?.text ?? null; } catch { return null; } };
  let v = cleanStep(typeof p.next_step === "string" ? p.next_step : "");
  if (v) return [v, PROJECTS_PATH];
  const ct = card ? await read(card) : null;
  if (ct !== null) {
    v = fmNextStep(ct); if (v) return [v, `${card} (frontmatter)`];
    v = bodyNextStep(ct); if (v) return [v, card];
  }
  if (folder) {
    const rel = `${folder}/README.md`;
    const rt = await read(rel);
    if (rt !== null) { v = bodyNextStep(rt); if (v) return [v, rel]; }
  }
  return ["", ""];
}

export const PULSE_BULK_PROJECTS = 3;   // a commit touching the folders of more than this many projects is housekeeping, not work
export const PULSE_COMMIT_WALK = 20;    // commits looked at per project

/** Whether a commit counts as activity for the project whose folder is `folder`: it adds or changes (A, M, R) a file inside the
 *  folder, and the files it touches (any status) fall inside the folders of at most PULSE_BULK_PROJECTS distinct projects
 *  (folders: project name -> folder; nested folders count separately). Same rule as commit_counts in bin/harold-index. */
export function commitCounts(files: [string, string][], folder: string, folders: Record<string, string>): boolean {
  let hit = false;
  const touched = new Set<string>();
  for (const [st, path] of files) {
    for (const [name, f] of Object.entries(folders)) if (f && path.startsWith(`${f}/`)) touched.add(name);
    if (st !== "D" && folder && path.startsWith(`${folder}/`)) hit = true;
  }
  return hit && touched.size <= PULSE_BULK_PROJECTS;
}

/** The newest commit that counts as activity for the folder (see commitCounts), or null. Walks back through at most
 *  PULSE_COMMIT_WALK commits touching the folder and stops once one is older than cutoff without counting. */
export async function lastCommit(repo: HaroldRepo, folder: string, folders: Record<string, string>, cutoff: string, tz: string): Promise<{ date: string; subject: string } | null> {
  for (const c of await repo.commitsTouching(folder, PULSE_COMMIT_WALK)) {
    const date = dateIn(c.date, tz);
    if (!c.merge) {
      const files = await repo.commitFiles(c.sha);
      if (files && commitCounts(files, folder, folders)) return { date, subject: cut((c.message.trim().split("\n")[0] || "").trim(), 72) };
    }
    if (cutoff && date < cutoff) break;
  }
  return null;
}

export interface PulseOpts { all?: boolean; nextFor?: "all" | "active" }

/** Everything `bin/harold pulse --json` returns. all adds the archived and autonomous projects. Next steps are read
 *  for the active projects only unless nextFor is "all" (or all is set). */
export async function pulseData(repo: HaroldRepo, today: string, tz: string, opts: PulseOpts = {}): Promise<PulseData> {
  const [gf, pf, tf] = await Promise.all([repo.getText(GRAPH_PATH), repo.getText(PROJECTS_PATH), repo.getText(TASKS_PATH).catch(() => null)]);
  if (!gf) throw new Error(`${GRAPH_PATH} is not in ${repo.repo} @ ${repo.branch}; it is written by \`bin/harold close\` in current versions of Harold (\`bin/harold update\`). Until then, run \`bin/harold pulse\` in a session.`);
  if (!pf) throw new Error(`${PROJECTS_PATH} is not in ${repo.repo} @ ${repo.branch}.`);
  const g = parseGraph(gf.text, today);
  const limit = pulseDays(g);
  const projects = parseProjects(pf.text);
  const tasks = readPlans(tf ? tf.text : null, today, limit);
  const folders = Object.fromEntries(projects.map(q => [q.name, normFolder(q.folder)]));
  let gitErr = "";
  const items = await Promise.all(projects.map(async (p): Promise<PulseProject | null> => {
    const raw = setStatus(p);
    const terminal = TERMINAL.includes(raw);
    if (terminal && !opts.all) return null;
    const folder = normFolder(p.folder), card = findCard(p, g);
    const item: PulseProject = { name: p.name, status: raw, set_status: raw, folder, card,
      quiet: null, days: null, last: null, next_step: "", next_step_source: "" };
    if (!terminal) {
      let commit: { date: string; subject: string } | null = null;
      let hb: Heartbeat | null = null;
      const hbPath = heartbeatPath(p);
      { try { const f = await repo.getText(hbPath); if (f) hb = latestHeartbeat(f.text, today); } catch { /* fall back to notes */ } }
      if (folder && !hb) {
        try { commit = await lastCommit(repo, folder, folders, addDays(today, -limit), tz); }
        catch (e) { gitErr = gitErr || `GitHub commits API: ${e instanceof Error ? e.message : String(e)}`; }
      }
      const last = activity(p, g, card, folder, today, commit, hb, tasks, limit);
      const days = last ? g.ageDays(last.date) : null;
      const recent = last !== null && days !== null && days <= limit;   // a future item has negative days
      item.status = recent ? "active" : "quiet";
      Object.assign(item, { quiet: item.status === "quiet", days, last });
    }
    if (opts.all || opts.nextFor === "all" || item.status === "active") [item.next_step, item.next_step_source] = await nextStep(repo, p, card, folder);
    return item;
  }));
  const list = items.filter((x): x is PulseProject => x !== null);
  const byName = (a: PulseProject, b: PulseProject) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const act = list.filter(x => x.status === "active")
    .sort((a, b) => Number(a.days === null) - Number(b.days === null) || Math.abs(a.days ?? 0) - Math.abs(b.days ?? 0) || byName(a, b));
  const quiet = list.filter(x => x.status === "quiet").sort(byName);
  const rest = list.filter(x => x.status !== "active" && x.status !== "quiet").sort(byName);
  return { today, pulse_days: limit, git: gitErr || "ok", active: act.length, quiet: quiet.length, projects: [...act, ...quiet, ...rest] };
}

/** 'last activity 4 days ago (commit 2026-10-03, "feat: ...")', or 'no dated activity found'. */
export function pulseWhen(x: PulseProject): string {
  const last = x.last;
  if (!last) return "no dated activity found";
  const d = x.days ?? 0;
  if (d < 0) return `upcoming: ${last.label} in ${d === -1 ? "1 day" : `${-d} days`} (${last.date}, "${last.title}")`;
  let lab = `${last.label} ${last.date}`;
  lab += `, "${last.title}"`;
  return `last activity ${d === 0 ? "today" : d === 1 ? "1 day ago" : `${d} days ago`} (${lab})`;
}

/** One active project: its last activity and its next step. */
export function pulseLine(x: PulseProject): string {
  return `- ${x.name} — ${pulseWhen(x)}; next step: ${x.next_step || "no next step recorded"}`;
}

const QUIET_HEAD = "Quiet (not nagged; work there makes them active again)";

/** The same text as `bin/harold pulse [--all]`. */
export function pulseText(data: PulseData, showAll = false): string {
  const { active: n, quiet: q, pulse_days: days } = data;
  const L = [`# Project pulse, ${data.today}: ${n} active, ${q} quiet (active: activity within ${days} days)`];
  const act = data.projects.filter(x => x.status === "active"), quiet = data.projects.filter(x => x.status === "quiet");
  if (act.length) L.push("", "Active:", ...act.map(pulseLine));
  if (quiet.length) {
    if (showAll) L.push("", `${QUIET_HEAD}:`, ...quiet.map(x => `- ${x.name} — ${pulseWhen(x)}`));
    else L.push("", `${QUIET_HEAD}: ${quiet.map(x => x.name).join(", ")}`);
  }
  const other = data.projects.filter(x => x.status !== "active" && x.status !== "quiet");
  if (showAll && other.length) L.push("", "Not judged (archived or autonomous):", ...other.map(x => `- ${x.name} [${x.status}]`));
  L.push("", "Activity: heartbeats; meeting, daily and decision notes linked with the project card (either way); files in its folder; meeting notes that name it without a link (dates written in the notes); "
    + `open tasks due (${TASKS_PATH}) and meeting notes dated ahead, within HAROLD_PULSE_DAYS of today; `
    + `and git commits that add or change files in its folder and touch no more than ${PULSE_BULK_PROJECTS} projects' folders. `
    + "The card's own date and links from person, company or intel cards do not count. "
    + `A project is active with activity within HAROLD_PULSE_DAYS (${days}) days; status: in harold/projects.md is only archived or autonomous. `
    + "Record a next step as next_step: in the project's harold/projects.md entry or its card's frontmatter.");
  if (data.git !== "ok") L.push(`Git history not used here (${data.git}): commits were not counted.`);
  return L.join("\n");
}

/** The same text as `bin/harold pulse --boot`: the counts only. Never the quiet projects. */
export function pulseBoot(data: PulseData): string {
  return `## Project pulse: ${data.active} active, ${data.quiet} quiet; active means activity within ${data.pulse_days} days (bin/harold pulse)`;
}

/** The "Projects" part of harold_today: the counts only. Quiet projects are never nagged about. */
export function pulseTodaySection(data: PulseData): string {
  return `${data.active} active, ${data.quiet} quiet; active means activity within ${data.pulse_days} days (harold_pulse lists them). Quiet projects are not raised.`;
}

/** The whole harold_pulse tool. */
export async function pulseTool(repo: HaroldRepo, today: string, tz: string, opts: { all?: boolean } = {}): Promise<{ text: string; isError?: boolean }> {
  try {
    const data = await pulseData(repo, today, tz, { all: !!opts.all });
    return { text: `${pulseText(data, !!opts.all)}\nGraph: ${GRAPH_PATH}, as of the last session close; the project map, cards and commits are current.` };
  } catch (e) {
    return { text: e instanceof Error ? e.message : String(e), isError: true };
  }
}
