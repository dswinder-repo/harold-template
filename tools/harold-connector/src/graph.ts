// harold_related: follow the links between notes, from harold/graph.json.
// graph.json is the committed copy of the link graph that bin/harold-index builds (bin/harold close
// writes it): nodes [path, title, type, last_updated], edges [src, dst, kind], broken [src, target, kind],
// mentions [src, project] (daily and meeting notes that name a project of harold/projects.md; read by pulse.ts).
// This file ports the ranking and the gaps line of `bin/harold related` (bin/harold-index) so a chat
// gets the same answer a terminal session does, from the same file, through the same GitHub access.

import type { HaroldRepo } from "./github.js";

export const GRAPH_PATH = "harold/graph.json";
const EVENT_TYPES = new Set(["daily", "meeting", "archive"]); // dated records and archives, never flagged stale
const ENTITY_TYPES = new Set(["person", "company", "project", "decision", "intel"]);

/** Archived notes (an archive/ folder, or a file named *-archive.md) stay searchable and are never stale, as in bin/harold-index. */
export function isArchived(p: string): boolean {
  const parts = p.split("/");
  return parts.slice(0, -1).includes("archive") || p.endsWith("-archive.md");
}

/** HAROLD_HUB_DEGREE (default 40): a note with more links than this is a hub, and no longer makes its neighbours related. */
export function hubDegree(): number {
  const n = Number.parseInt((process.env.HAROLD_HUB_DEGREE || "").trim(), 10);
  return Number.isFinite(n) && n >= 0 ? n : 40;
}

export interface GNode { path: string; title: string; type: string; last_updated: string }
type Relation = "both" | "outgoing" | "backlink" | "shared" | "via";
export interface RelatedRow {
  path: string; title: string; type: string; last_updated: string; age_days: number | null; stale: boolean;
  relation: Relation; kind: string; shared: number; shared_via: string[]; broken: number;
}

export class Graph {
  nodes = new Map<string, GNode>();
  out = new Map<string, Map<string, string>>();   // src -> dst -> kind (first kind wins, as bin/harold-index)
  inn = new Map<string, Map<string, string>>();
  broken = new Map<string, { target: string; kind: string }[]>();
  mentions = new Map<string, Set<string>>();     // project name -> daily and meeting notes that name it
  staleDays = 30;
  pulseDays: number | null = null;               // the workspace's HAROLD_PULSE_DAYS, when graph.json carries it
  constructor(public today: string) {}

  node(p: string): GNode {
    return this.nodes.get(p) || { path: p, title: (p.split("/").pop() || p).replace(/\.[^.]+$/, ""), type: "file", last_updated: "" };
  }
  nbrs(p: string): Set<string> { return new Set([...(this.out.get(p)?.keys() || []), ...(this.inn.get(p)?.keys() || [])]); }
  degree(p: string): number { return this.nbrs(p).size; }
  ageDays(d: string): number | null {
    const a = d.match(/^(\d{4})-(\d{2})-(\d{2})$/), b = this.today.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!a || !b) return null;
    const t = (m: RegExpMatchArray) => Date.UTC(+m[1], +m[2] - 1, +m[3]);
    return Math.round((t(b) - t(a)) / 86_400_000);
  }
  isStale(n: GNode): boolean {
    const a = this.ageDays(n.last_updated);
    return !EVENT_TYPES.has(n.type) && !isArchived(n.path) && a !== null && a > this.staleDays;
  }
}

/** Parse harold/graph.json (version 1). Throws with a plain message when the file is not a graph. */
export function parseGraph(text: string, today: string): Graph {
  let j: Record<string, unknown>;
  try { j = JSON.parse(text); } catch { throw new Error(`${GRAPH_PATH} is not valid JSON; the next bin/harold close rewrites it.`); }
  const g = new Graph(today);
  const idx = (fields: unknown, name: string, dflt: number) => (Array.isArray(fields) && fields.indexOf(name) >= 0 ? fields.indexOf(name) : dflt);
  if (!Array.isArray(j.nodes) || !Array.isArray(j.edges)) throw new Error(`${GRAPH_PATH} has no nodes/edges; the next bin/harold close rewrites it.`);
  if (typeof j.stale_days === "number" && j.stale_days > 0) g.staleDays = j.stale_days;
  if (typeof j.pulse_days === "number" && Number.isInteger(j.pulse_days) && j.pulse_days >= 0) g.pulseDays = j.pulse_days;
  const nf = j.node_fields, ef = j.edge_fields, bf = j.broken_fields;
  const [np, nt, nty, nlu] = [idx(nf, "path", 0), idx(nf, "title", 1), idx(nf, "type", 2), idx(nf, "last_updated", 3)];
  for (const r of j.nodes as unknown[][]) {
    if (!Array.isArray(r)) continue;
    const path = String(r[np] ?? "");
    if (path) g.nodes.set(path, { path, title: String(r[nt] ?? "") || g.node(path).title, type: String(r[nty] ?? ""), last_updated: String(r[nlu] ?? "") });
  }
  const [es, ed, ek] = [idx(ef, "src", 0), idx(ef, "dst", 1), idx(ef, "kind", 2)];
  for (const r of j.edges as unknown[][]) {
    if (!Array.isArray(r)) continue;
    const s = String(r[es] ?? ""), d = String(r[ed] ?? ""), k = String(r[ek] ?? "");
    if (!s || !d || s === d) continue;
    if (!g.out.has(s)) g.out.set(s, new Map());
    if (!g.out.get(s)!.has(d)) g.out.get(s)!.set(d, k);
    if (!g.inn.has(d)) g.inn.set(d, new Map());
    if (!g.inn.get(d)!.has(s)) g.inn.get(d)!.set(s, k);
  }
  const [bs, bt, bk] = [idx(bf, "src", 0), idx(bf, "target", 1), idx(bf, "kind", 2)];
  for (const r of (Array.isArray(j.broken) ? j.broken : []) as unknown[][]) {
    if (!Array.isArray(r)) continue;
    const s = String(r[bs] ?? "");
    if (!s) continue;
    if (!g.broken.has(s)) g.broken.set(s, []);
    g.broken.get(s)!.push({ target: String(r[bt] ?? ""), kind: String(r[bk] ?? "") });
  }
  const mf = j.mention_fields;
  const [ms, mp] = [idx(mf, "src", 0), idx(mf, "project", 1)];
  for (const r of (Array.isArray(j.mentions) ? j.mentions : []) as unknown[][]) {
    if (!Array.isArray(r)) continue;
    const s = String(r[ms] ?? ""), p = String(r[mp] ?? "");
    if (!s || !p) continue;
    if (!g.mentions.has(p)) g.mentions.set(p, new Set());
    g.mentions.get(p)!.add(s);
  }
  return g;
}

// ───────────── resolving the query to a note ─────────────

const squash = (s: string) => s.trim().split(/\s+/).join(" ");

function pick(cands: string[]): string {
  return [...new Set(cands)].sort((a, b) =>
    (a.startsWith("vault/") ? 0 : 1) - (b.startsWith("vault/") ? 0 : 1) || a.length - b.length || (a < b ? -1 : a > b ? 1 : 0))[0];
}

/** By file name, then title (exact case first, then any case); a target with a slash by path suffix. */
export function resolveName(g: Graph, raw: string): string | null {
  let t = squash(raw);
  if (!t) return null;
  if (t.includes("/")) {
    let k = t.toLowerCase().replace(/^[./]+/, "");
    if (k.endsWith(".md")) k = k.slice(0, -3);
    const keys = [...g.nodes.keys()].map(p => [p.replace(/\.[^./]+$/, "").toLowerCase(), p] as const);
    for (const cand of [k, `vault/${k}`]) { const hit = keys.find(([pk]) => pk === cand); if (hit) return hit[1]; }
    const suf = keys.filter(([pk]) => pk.endsWith(`/${k}`)).map(([, p]) => p);
    if (suf.length) return pick(suf);
    t = t.slice(t.lastIndexOf("/") + 1);
  }
  if (t.toLowerCase().endsWith(".md")) t = t.slice(0, -3);
  const stem = (p: string) => (p.split("/").pop() || p).replace(/\.[^.]+$/, "");
  for (const lower of [false, true]) {
    for (const get of [(n: GNode) => stem(n.path), (n: GNode) => n.title]) {
      const hits = [...g.nodes.values()].filter(n => { const v = squash(get(n)); return v && (lower ? v.toLowerCase() === t.toLowerCase() : v === t); }).map(n => n.path);
      if (hits.length) return pick(hits);
    }
  }
  return null;
}

/** Path → exact name or title → search (entity notes first). `search` returns repo paths, best first. */
export async function findStart(g: Graph, q: string, search: (q: string) => Promise<string[]>, nstarts = 3): Promise<{ starts: string[]; how: "path" | "name" | "search" | "title words" }> {
  const qq = q.trim().replace(/^\.?\/+/, "");
  for (const c of [qq, `${qq}.md`]) if (g.nodes.has(c)) return { starts: [c], how: "path" };
  const byName = resolveName(g, qq);
  if (byName) return { starts: [byName], how: "name" };
  const rank = (paths: string[]) => {
    const seen = [...new Set(paths.filter(p => g.nodes.has(p)))].slice(0, 10);
    return seen.sort((a, b) => (ENTITY_TYPES.has(g.node(a).type) ? 0 : 1) - (ENTITY_TYPES.has(g.node(b).type) ? 0 : 1) || seen.indexOf(a) - seen.indexOf(b)).slice(0, nstarts);
  };
  let hits: string[] = [];
  try { hits = rank(await search(qq)); } catch { hits = []; }
  if (hits.length) return { starts: hits, how: "search" };
  // Search unavailable or empty (it lags behind recent writes): match the words against titles and paths.
  const words = qq.toLowerCase().split(/\s+/).filter(w => w.length > 1);
  if (!words.length) return { starts: [], how: "title words" };
  const scored = [...g.nodes.values()].map(n => {
    const hay = `${n.title} ${n.path}`.toLowerCase();
    return { p: n.path, s: words.filter(w => hay.includes(w)).length };
  }).filter(x => x.s === words.length).sort((a, b) => a.p.length - b.p.length).map(x => x.p);
  return { starts: rank(scored), how: "title words" };
}

// ───────────── neighbours and gaps (bin/harold-index related / gaps) ─────────────

export function related(g: Graph, starts: string[], depth = 1, limit = 15, showAll = false): { rows: RelatedRow[]; total: number; hiddenDaily: RelatedRow[] } {
  const S = new Set(starts);
  const direct = new Map<string, { out: string | null; in: string | null }>();
  for (const s of starts) {
    for (const [d, k] of g.out.get(s) || []) { if (S.has(d)) continue; const e = direct.get(d) || { out: null, in: null }; e.out = e.out ?? k; direct.set(d, e); }
    for (const [d, k] of g.inn.get(s) || []) { if (S.has(d)) continue; const e = direct.get(d) || { out: null, in: null }; e.in = e.in ?? k; direct.set(d, e); }
  }
  const startNbrs = new Set<string>();
  for (const s of starts) for (const n of g.nbrs(s)) if (!S.has(n)) startNbrs.add(n);
  const shared = new Map<string, Set<string>>();
  const hub = hubDegree();
  for (const c of startNbrs) {
    if (g.degree(c) > hub) continue;
    for (const x of g.nbrs(c)) {
      if (S.has(x) || x === c) continue;
      if (!shared.has(x)) shared.set(x, new Set());
      shared.get(x)!.add(c);
    }
  }
  const cands = new Set<string>(direct.keys());
  for (const [x, v] of shared) if (v.size >= (depth >= 2 ? 1 : 2)) cands.add(x);
  let rows: RelatedRow[] = [...cands].map(x => {
    const n = g.node(x), d = direct.get(x);
    let relation: Relation, kind = "";
    if (d) { relation = d.out && d.in ? "both" : d.out ? "outgoing" : "backlink"; kind = (d.out || d.in)!; }
    else relation = (shared.get(x)?.size || 0) >= 2 ? "shared" : "via";
    const sh = [...(shared.get(x) || [])].sort((a, b) => g.degree(b) - g.degree(a) || (a < b ? -1 : 1));
    return { path: x, title: n.title, type: n.type, last_updated: n.last_updated, age_days: g.ageDays(n.last_updated), stale: g.isStale(n),
      relation, kind, shared: sh.length, shared_via: sh.slice(0, 3).map(c => g.node(c).title), broken: (g.broken.get(x) || []).length };
  });
  const order: Record<Relation, number> = { both: 0, outgoing: 1, backlink: 1, shared: 2, via: 3 };
  const dnum = (s: string) => (s ? Number(s.replace(/-/g, "")) || 0 : 0);
  rows.sort((a, b) => order[a.relation] - order[b.relation] || b.shared - a.shared || dnum(b.last_updated) - dnum(a.last_updated) || (a.path < b.path ? -1 : 1));
  const total = rows.length;
  const hiddenDaily: RelatedRow[] = [];
  if (!showAll) {
    let nd = 0;
    rows = rows.filter(r => { if (r.type !== "daily") return true; nd++; if (nd > 3) { hiddenDaily.push(r); return false; } return true; });
  }
  return { rows: rows.slice(0, limit), total, hiddenDaily };
}

export function gaps(g: Graph, p: string): string[] {
  const n = g.node(p), out: string[] = [];
  const a = g.ageDays(n.last_updated);
  if (a !== null && g.isStale(n)) out.push(`last updated ${a} days ago (${n.last_updated})`);
  if (!n.last_updated && ENTITY_TYPES.has(n.type)) out.push("no last_updated date in the note");
  const b = g.broken.get(p) || [];
  const links = b.filter(x => !x.kind.startsWith("frontmatter:")), named = b.filter(x => x.kind.startsWith("frontmatter:"));
  if (links.length) {
    const names = [...new Set(links.map(x => (x.kind === "wikilink" ? `[[${x.target}]]` : x.target)))].sort();
    out.push(`${links.length} broken link${links.length !== 1 ? "s" : ""} (${names.slice(0, 4).join(", ")}${names.length > 4 ? ", …" : ""})`);
  }
  if (named.length) out.push("no note for " + [...new Set(named.map(x => `${x.kind.split(":")[1]}: ${x.target}`))].sort().slice(0, 3).join(", "));
  const hasOut = (g.out.get(p)?.size || 0) > 0, hasIn = (g.inn.get(p)?.size || 0) > 0;
  if (!hasOut && !hasIn) out.push("no links in or out (orphan)");
  else if (!hasIn) out.push("nothing links to it");
  else if (!hasOut) out.push("links to nothing");
  const nb = [...g.nbrs(p)];
  if (["person", "company", "project"].includes(n.type) && !nb.some(x => g.node(x).type === "meeting")) out.push("no meeting notes linked");
  if (["person", "company"].includes(n.type) && !nb.some(x => g.node(x).type === "daily")) out.push("not in any daily note");
  const staleN = nb.filter(x => g.isStale(g.node(x))).length;
  if (staleN) out.push(`${staleN} directly linked note${staleN !== 1 ? "s" : ""} stale (>${g.staleDays}d)`);
  return out;
}

const KIND_LABEL: Record<string, string> = { wikilink: "[[wikilink]]", mdlink: "md link" };
const edgeLabel = (k: string) => KIND_LABEL[k] || k;

function fmtDate(g: Graph, n: { last_updated: string; type: string }): string {
  if (!n.last_updated) return "no date";
  const a = g.ageDays(n.last_updated);
  return `${n.last_updated}${a !== null ? ` (${a}d)` : ""}${g.isStale(n as GNode) ? " STALE" : ""}`;
}

export interface RelatedOpts { depth?: number; limit?: number; all?: boolean }

/** The whole tool: read graph.json, resolve the query, list neighbours, state gaps. */
export async function relatedText(repo: HaroldRepo, query: string, today: string, opts: RelatedOpts = {}): Promise<{ text: string; isError?: boolean }> {
  const q = query.trim();
  if (!q) return { text: "Give a note path, a title or a topic.", isError: true };
  const f = await repo.getText(GRAPH_PATH);
  if (!f) {
    return { text: `${GRAPH_PATH} is not in ${repo.repo} @ ${repo.branch}, so links cannot be followed from a chat yet. It is written by \`bin/harold close\` in Harold 2.1 and later: update the workspace and let one session close (or run \`bin/harold-index graph-json\` and commit the file). Until then, use harold_search and harold_read.`, isError: true };
  }
  const g = parseGraph(f.text, today);
  const depth = opts.depth === 2 ? 2 : 1;
  const limit = Math.min(Math.max(opts.limit ?? 15, 1), 50);
  const { starts, how } = await findStart(g, q, async s => (await repo.searchCode(s.replace(/[:"]/g, " "), 20)).map(h => h.path));
  if (!starts.length) return { text: `No note found for "${q}" in ${GRAPH_PATH} (${g.nodes.size} notes). Try harold_search, or give the note's path. Notes written since the last session close are not in the graph yet.` };

  const L: string[] = [];
  for (const s of starts) {
    const n = g.node(s);
    L.push(`${n.title} · ${s} · ${n.type} · updated ${fmtDate(g, n)} · ${g.out.get(s)?.size || 0} out, ${g.inn.get(s)?.size || 0} in, ${(g.broken.get(s) || []).length} broken`);
  }
  if (how === "search" || how === "title words") L.push(`(matched by ${how === "search" ? "search" : "title words"} for "${q}"; pass a path or exact title to pin one note)`);
  L.push("");
  const { rows, total, hiddenDaily } = related(g, starts, depth, limit, !!opts.all);
  const arrow: Record<Relation, string> = { both: "↔", outgoing: "→", backlink: "←", shared: "⇄", via: "⋯" };
  if (!rows.length) L.push("No linked notes.");
  rows.forEach((r, i) => {
    L.push(`${i + 1}. ${arrow[r.relation]} ${r.title} · ${r.path} · ${r.type} · ${fmtDate(g, r)}`);
    const bits: string[] = [];
    if (r.relation === "both" || r.relation === "outgoing" || r.relation === "backlink") {
      bits.push(`${{ both: "linked both ways", outgoing: "linked from it", backlink: "links to it" }[r.relation]} by ${edgeLabel(r.kind)}`);
    }
    if (r.shared) bits.push(`${r.shared} shared link${r.shared !== 1 ? "s" : ""} (${r.shared_via.join(", ")}${r.shared > 3 ? ", …" : ""})${r.relation === "via" || r.relation === "shared" ? ", 2 hops" : ""}`);
    if (r.broken) bits.push(`${r.broken} broken`);
    L.push(`   ${bits.join("; ")}`);
  });
  const more = total - rows.length - hiddenDaily.length;
  const tail: string[] = [];
  if (hiddenDaily.length) tail.push(`${hiddenDaily.length} more daily note${hiddenDaily.length !== 1 ? "s" : ""} (latest ${hiddenDaily.map(r => r.last_updated).sort().pop() || "undated"}; all: true shows them)`);
  if (more > 0) tail.push(`${more} more (raise limit)`);
  if (depth < 2) tail.push("depth: 2 follows one more hop");
  if (tail.length) L.push("", tail.join("; "));
  L.push("");
  for (const s of starts) {
    const gp = gaps(g, s);
    L.push(`gaps: ${g.node(s).title}: ${gp.length ? gp.join("; ") : `none found (updated ${fmtDate(g, g.node(s))})`}`);
  }
  L.push("", `Graph: ${GRAPH_PATH}, as of the last session close; stale means not updated in more than ${g.staleDays} days. Say the staleness and the gaps in your answer. Open notes with harold_read.`);
  return { text: L.join("\n") };
}
