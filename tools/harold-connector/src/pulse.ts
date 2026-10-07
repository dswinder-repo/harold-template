// harold_pulse: for each active project in harold/projects.md, its newest activity, its next step, and whether it
// has gone quiet. The same procedure as `bin/harold pulse` (pulse_data in bin/harold-index), over the same rows:
// harold/graph.json holds exactly what bin/harold-index computes from (nodes with the dates written in the notes,
// links, and the daily and meeting notes that name each project), the project map, card and README are read
// from the repository, and the newest commit touching the project's folder comes from the GitHub API instead of
// `git log`. Same repository, same answer. Change one, change the other.
//
// Activity of a project (newest wins; dates after today never count):
//   - its card (the `card:` field, else the project note whose title or file name is the project's name);
//   - every note linking to the card, and the meeting, daily and decision notes the card links to;
//   - every note in its folder;
//   - daily and meeting notes that name it (its name or an alias, graph.json "mentions": bin/harold-index decides
//     which count, leaving out roll-ups such as a review that names every project);
//   - the newest commit touching its folder.
// Quiet: no activity in more than HAROLD_PULSE_DAYS days (default 14). Only status: active projects are judged.
// Next step: the map entry's next_step, then the card's frontmatter next_step, then a "Next step: ..." line (or the
// first line under a "Next step" heading) in the card, then in <folder>/README.md.

import type { HaroldRepo } from "./github.js";
import { GRAPH_PATH, parseGraph, type Graph } from "./graph.js";
import { parseProjects, type Project } from "./projects.js";

export const PROJECTS_PATH = "harold/projects.md";
const LABEL: Record<string, string> = {
  meeting: "meeting note", daily: "daily note", decision: "decision", intel: "intel note",
  person: "person card", company: "company card", project: "project card",
};
const OUT_TYPES = new Set(["meeting", "daily", "decision"]);
const VIA_RANK: Record<string, number> = { card: 0, folder: 1, link: 2, mention: 3 };
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const NEXT_LINE = /^\s*(?:[-*+]\s+)?(?:\*\*|__)?next[ _-]?steps?(?:\*\*|__)?\s*:\s*(?:\*\*|__)?\s*(.*)$/i;
const NEXT_HEAD = /^#{1,6}\s+next[ _-]?steps?\s*:?\s*$/i;
const FM_BLOCK = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;

export interface PulseLast { kind: "note" | "commit"; date: string; path: string; title: string; via: string; label: string }
export interface PulseProject {
  name: string; status: string; folder: string; card: string;
  quiet: boolean | null; days: number | null; last: PulseLast | null;
  next_step: string; next_step_source: string;
}
export interface PulseData { today: string; pulse_days: number; git: string; active: number; quiet: number; projects: PulseProject[] }

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

/** The newest dated activity of one project: a note (dates written in the note) or a commit. null when nothing. */
export function activity(p: Project, g: Graph, card: string, folder: string, today: string, commit: { date: string; subject: string } | null): PulseLast | null {
  const cands: PulseLast[] = [];
  const seen = new Set<string>();
  const add = (path: string, via: string) => {
    const n = g.nodes.get(path);
    if (seen.has(path) || !n || n.type === "template") return;
    const d = n.last_updated || "";
    if (!ISO.test(d) || d > today) return;
    seen.add(path);
    cands.push({ kind: "note", date: d, path, title: n.title, via, label: path === card ? "project card" : LABEL[n.type] || "note" });
  };
  if (g.nodes.has(card)) add(card, "card");
  for (const s of sorted(g.inn.get(card)?.keys() || [])) add(s, "link");
  for (const d of sorted(g.out.get(card)?.keys() || [])) if (OUT_TYPES.has(g.nodes.get(d)?.type || "")) add(d, "link");
  if (folder) for (const path of sorted(g.nodes.keys())) if (path.startsWith(`${folder}/`)) add(path, "folder");
  for (const s of sorted(g.mentions.get(p.name) || [])) { const t = g.nodes.get(s)?.type; if (t === "daily" || t === "meeting") add(s, "mention"); }
  cands.sort((a, b) => Number(b.date.replace(/-/g, "")) - Number(a.date.replace(/-/g, "")) || VIA_RANK[a.via] - VIA_RANK[b.via] || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  let best: PulseLast | null = cands[0] || null;
  if (commit && ISO.test(commit.date) && commit.date <= today && (!best || commit.date > best.date)) {
    best = { kind: "commit", date: commit.date, path: `${folder}/`, title: commit.subject, via: "git", label: "commit" };
  }
  return best;
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

export interface PulseOpts { all?: boolean; nextFor?: "all" | "quiet" }

/** Everything `bin/harold pulse --json` returns. Next steps are read for the quiet projects only unless nextFor is "all" (or all is set). */
export async function pulseData(repo: HaroldRepo, today: string, tz: string, opts: PulseOpts = {}): Promise<PulseData> {
  const [gf, pf] = await Promise.all([repo.getText(GRAPH_PATH), repo.getText(PROJECTS_PATH)]);
  if (!gf) throw new Error(`${GRAPH_PATH} is not in ${repo.repo} @ ${repo.branch}; it is written by \`bin/harold close\` in current versions of Harold (\`bin/harold update\`). Until then, run \`bin/harold pulse\` in a session.`);
  if (!pf) throw new Error(`${PROJECTS_PATH} is not in ${repo.repo} @ ${repo.branch}.`);
  const g = parseGraph(gf.text, today);
  const limit = pulseDays(g);
  const projects = parseProjects(pf.text);
  let gitErr = "";
  const items = await Promise.all(projects.map(async (p): Promise<PulseProject | null> => {
    const status = String(p.status || "").trim().toLowerCase();
    if (status !== "active" && !opts.all) return null;
    const folder = normFolder(p.folder), card = findCard(p, g);
    const item: PulseProject = { name: p.name, status, folder, card, quiet: null, days: null, last: null, next_step: "", next_step_source: "" };
    if (status === "active") {
      let commit: { date: string; subject: string } | null = null;
      if (folder) {
        try {
          const c = await repo.lastCommit(folder);
          if (c) commit = { date: dateIn(c.date, tz), subject: cut((c.message.trim().split("\n")[0] || "").trim(), 72) };
        } catch (e) { gitErr = gitErr || `GitHub commits API: ${e instanceof Error ? e.message : String(e)}`; }
      }
      const last = activity(p, g, card, folder, today, commit);
      const days = last ? g.ageDays(last.date) : null;
      Object.assign(item, { quiet: last === null || (days ?? 0) > limit, days, last });
    }
    if (opts.all || opts.nextFor === "all" || item.quiet) [item.next_step, item.next_step_source] = await nextStep(repo, p, card, folder);
    return item;
  }));
  const list = items.filter((x): x is PulseProject => x !== null);
  const act = list.filter(x => x.status === "active")
    .sort((a, b) => (a.quiet ? 0 : 1) - (b.quiet ? 0 : 1) || (b.days ?? 1e9) - (a.days ?? 1e9) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const rest = list.filter(x => x.status !== "active").sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { today, pulse_days: limit, git: gitErr || "ok", active: act.length, quiet: act.filter(x => x.quiet).length, projects: [...act, ...rest] };
}

export function pulseLine(x: PulseProject, full: boolean): string {
  const last = x.last;
  let act: string;
  if (!last) act = "quiet, no dated activity found";
  else {
    let lab = `${last.label} ${last.date}`;
    if (last.kind === "commit" || last.label !== "project card") lab += `, "${last.title}"`;
    const d = x.days ?? 0;
    const when = d === 0 ? "today" : d === 1 ? "1 day ago" : `${d} days ago`;
    act = `${x.quiet ? `quiet ${d} days` : `active ${when}`} (last: ${lab})`;
  }
  return `- ${x.name} — ${act}${full ? `; next step: ${x.next_step || "no next step recorded"}` : ""}`;
}

/** The same text as `bin/harold pulse [--all]`. */
export function pulseText(data: PulseData, showAll = false): string {
  const act = data.projects.filter(x => x.status === "active");
  const { active: n, quiet: q, pulse_days: days } = data;
  let L: string[];
  if (!n) L = [`# Project pulse, ${data.today}: no active projects in harold/projects.md`];
  else {
    L = [`# Project pulse, ${data.today}: ${q} of ${n} active project${n !== 1 ? "s" : ""} quiet (no activity in more than ${days} days)`];
    const quiet = act.filter(x => x.quiet), live = act.filter(x => !x.quiet);
    if (quiet.length) L.push("", "Quiet:", ...quiet.map(x => pulseLine(x, true)));
    if (live.length) L.push("", "Active:", ...live.map(x => pulseLine(x, showAll)));
  }
  const other = data.projects.filter(x => x.status !== "active");
  if (showAll && other.length) L.push("", "Not judged (not active):", ...other.map(x => `- ${x.name} [${x.status || "no status"}]`));
  L.push("", "Activity: notes linked to the project card, files in its folder, daily and meeting notes that name it (dates written in the notes), "
    + `and git commits touching its folder. Quiet after HAROLD_PULSE_DAYS (${days}) days without any. `
    + "Record a next step as next_step: in the project's harold/projects.md entry or its card's frontmatter.");
  if (data.git !== "ok") L.push(`Git history not used here (${data.git}): commits were not counted.`);
  return L.join("\n");
}

/** The "Quiet projects" part of harold_today: the quiet ones with their next step, or one line. */
export function pulseTodaySection(data: PulseData): string {
  const { active: n, quiet: q, pulse_days: days } = data;
  if (!n) return "No active projects in harold/projects.md.";
  if (!q) return `All ${n} active project${n !== 1 ? "s" : ""} have activity within ${days} days (harold_pulse for details).`;
  return [`${q} of ${n} active project${n !== 1 ? "s" : ""} quiet, no activity in more than ${days} days (harold_pulse for all). List them under WATCH, with their next step:`,
    ...data.projects.filter(x => x.status === "active" && x.quiet).map(x => pulseLine(x, true))].join("\n");
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
