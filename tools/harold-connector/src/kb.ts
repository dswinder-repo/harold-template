// The knowledge base: read and write operations on the Harold repository (HAROLD_REPO), shared by the MCP tools.
// Every write is one commit through the GitHub Contents API (HaroldRepo.commit).

import { isNoLogType, tzInfo } from "./config.js";
import { HaroldRepo, GithubError, cleanPath } from "./github.js";
import { appendLearning, CATEGORIES, SEVERITIES } from "./learnings.js";
import { criticalLessons, housekeepingNew, morningStep0 } from "./morning.js";
import { formatWhere, parseProjects } from "./projects.js";
import { pulseData, pulseTodaySection } from "./pulse.js";
import { appendUnderHeading, frontmatter, localParts, slugify, truncate, updateFrontmatter } from "./text.js";

export interface ToolText { text: string; isError?: boolean }
const fail = (text: string): ToolText => ({ text, isError: true });
const msg = (what: string) => `chore(connector): ${what}`.slice(0, 200);

// ───────────── read ─────────────

export function currentAlerts(alertsText: string): string {
  const m = alertsText.match(/##\s*Current Alerts[\s\S]*?(?=\n##\s|\n---|$)/i);
  return m ? m[0].trim() : "";
}

function firstLine(text: string): string {
  const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/, "");
  const l = body.split("\n").map(s => s.trim()).find(Boolean) || "";
  return l.slice(0, 200);
}

export async function today(repo: HaroldRepo, now = new Date()): Promise<ToolText> {
  const zone = tzInfo();
  const t = localParts(now, zone.tz);
  const [brief, alerts, tree, lessons, hk, pulse] = await Promise.all([
    repo.getText(`harold/briefs/${t.iso}.md`).catch(() => null),
    repo.getText("harold/alerts.md").catch(() => null),
    repo.tree(),
    repo.getText("harold/learnings.jsonl").catch(() => null),
    repo.getText("harold/briefs/housekeeping-notes.md").catch(() => null),
    pulseData(repo, t.iso, zone.tz).then(pulseTodaySection, e => `Project pulse unavailable: ${e instanceof Error ? e.message : String(e)}`),
  ]);
  const hkNew = hk ? housekeepingNew(hk.text) : "";
  const dailies = tree.map(f => f.path).filter(p => /^vault\/daily\/\d{4}-\d{2}-\d{2}[^/]*\.md$/.test(p)).sort().reverse().slice(0, 5);
  const firsts = await Promise.all(dailies.map(p => repo.getText(p).then(f => (f ? firstLine(f.text) : "")).catch(() => "")));
  const L: string[] = [
    `# Harold — ${t.weekday}, ${t.iso} (${t.hm} ${zone.tz})`,
    `Repository: ${repo.repo} @ ${repo.branch}`,
    ...(zone.warning ? [`Note: ${zone.warning}`] : []),
    "",
    "## Today's morning brief draft",
    brief ? `harold/briefs/${t.iso}.md\n\n${truncate(brief.text, 35_000, "brief truncated; read the rest with harold_read")}` : `No brief draft for ${t.iso} (harold/briefs/${t.iso}.md does not exist).${["Saturday", "Sunday"].includes(t.weekday) ? " Weekend: none is scheduled." : " The scheduled morning brief is optional; if it is turned on, it may not have run yet."}`,
    "",
    "## Alerts",
    alerts ? (currentAlerts(alerts.text) ? truncate(currentAlerts(alerts.text), 20_000) : "harold/alerts.md has no Current Alerts section.") : "harold/alerts.md could not be read.",
    "",
    "## Critical lessons",
    lessons ? criticalLessons(lessons.text) : "harold/learnings.jsonl could not be read.",
    "",
    "## Housekeeping notes",
    hkNew ? `From harold/briefs/housekeeping-notes.md (under "## New"):\n${hkNew}` : "None waiting.",
    "",
    "## Quiet projects",
    pulse,
    "",
    "## Most recent daily notes",
    ...(dailies.length ? dailies.map((p, i) => `- ${p}${firsts[i] ? ` — ${firsts[i]}` : ""}`) : ["(none)"]),
    "",
    "## Starting the day",
    morningStep0(!!brief),
  ];
  return { text: L.join("\n") };
}

export async function search(repo: HaroldRepo, query: string, limit = 10): Promise<ToolText> {
  const q = query.trim();
  if (!q) return fail("Give a search query.");
  const lim = Math.min(Math.max(limit, 1), 30);
  const note = `Note: code search reflects the ${repo.branch === "main" ? "main" : "default"} branch as GitHub last indexed it and can lag a few minutes behind recent writes (including ones made through this connector).`;
  let hits: { path: string; fragments: string[] }[] = [];
  let why = "";
  try { hits = await repo.searchCode(q.replace(/[:"]/g, " "), lim); }
  catch (e) { why = e instanceof Error ? e.message : String(e); }
  if (hits.length) {
    const body = hits.slice(0, lim).map((h, i) => {
      const frags = h.fragments.slice(0, 3).map(f => "    " + f.replace(/\s+/g, " ").trim().slice(0, 300)).join("\n");
      return `${i + 1}. ${h.path}${frags ? `\n${frags}` : ""}`;
    }).join("\n");
    return { text: truncate(`Found ${hits.length} file${hits.length === 1 ? "" : "s"} for "${q}" (GitHub code search):\n\n${body}\n\n${note} Read a file with harold_read.`, 95_000) };
  }
  // Fallback: file paths from the git tree of the configured branch (current, not indexed).
  const words = q.toLowerCase().split(/\s+/).filter(w => w.length > 1);
  const tree = await repo.tree();
  const scored = tree
    .filter(f => !/(^|\/)(node_modules|\.git)\//.test(f.path))
    .map(f => { const p = f.path.toLowerCase(); const s = words.reduce((n, w) => n + (p.includes(w) ? 1 : 0), 0); return { p: f.path, s }; })
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s || a.p.length - b.p.length)
    .slice(0, lim);
  const head = why ? `Code search failed (${why}); matched file names instead.` : `Code search found nothing for "${q}"; matched file names instead.`;
  if (!scored.length) return { text: `${head}\nNo file names match either. Try other words, harold_person for a person, or harold_where for a project.\n\n${note}` };
  return { text: `${head}\n\n${scored.map((x, i) => `${i + 1}. ${x.p}`).join("\n")}\n\n${note}` };
}

export async function read(repo: HaroldRepo, path: string): Promise<ToolText> {
  const f = await repo.get(path);
  if (!f) return fail(`Not found: ${path} (on ${repo.branch}). Use harold_list or harold_search to find the right path.`);
  if (f.kind === "dir") return fail(`${f.path} is a folder. Use harold_list("${f.path}").`);
  if (f.kind === "binary") return fail(`${f.path} is a binary file (${f.size} bytes); only text files can be read here.`);
  return { text: `# ${f.path}\n\n${truncate(f.text, 90_000, "file truncated")}` };
}

export async function list(repo: HaroldRepo, folder: string): Promise<ToolText> {
  const p = cleanPath(folder || "");
  if (p === "") {
    const f = await repo.get("");
    if (!f || f.kind !== "dir") return fail("Could not list the repository root.");
    return { text: fmtDir("(repository root)", f.entries) };
  }
  const f = await repo.get(p);
  if (!f) return fail(`No folder ${p} on ${repo.branch}.`);
  if (f.kind !== "dir") return fail(`${p} is a file. Use harold_read("${p}").`);
  return { text: fmtDir(p, f.entries) };
}

function fmtDir(label: string, entries: { name: string; type: string; size: number }[]): string {
  const sorted = [...entries].sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));
  const lines = sorted.slice(0, 1500).map(e => (e.type === "dir" ? `${e.name}/` : e.name));
  return `${label} — ${entries.length} entr${entries.length === 1 ? "y" : "ies"}\n\n${lines.join("\n")}${entries.length > 1500 ? `\n… and ${entries.length - 1500} more` : ""}`;
}

export async function where(repo: HaroldRepo, topic: string): Promise<ToolText> {
  const f = await repo.getText("harold/projects.md");
  if (!f) return fail("harold/projects.md could not be read.");
  const r = formatWhere(parseProjects(f.text), topic);
  return r.found ? { text: r.text } : { text: r.text };
}

// ───────────── people ─────────────

const norm = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\.md$/, "").replace(/[^a-z0-9]+/g, " ").trim();

export function scorePersonFile(fileBase: string, query: string): number {
  const f = norm(fileBase), q = norm(query);
  if (!q) return 0;
  if (f === q) return 100;
  const fw = f.split(" "), qw = q.split(" ");
  if (qw.every(w => fw.includes(w))) return 90 - 2 * Math.max(0, fw.length - qw.length);
  if (f.includes(q)) return 60;
  if (q.includes(f) && f.length >= 4) return 55;
  const overlap = qw.filter(w => w.length > 1 && fw.some(x => x.startsWith(w) || w.startsWith(x))).length;
  return overlap ? Math.round((overlap / Math.max(qw.length, fw.length)) * 50) : 0;
}

export async function findPersonCards(repo: HaroldRepo, name: string): Promise<{ path: string; score: number }[]> {
  const tree = await repo.tree();
  return tree.map(f => f.path).filter(p => /^vault\/people\/[^/]+\.md$/.test(p) && !/README\.md$/i.test(p))
    .map(p => ({ path: p, score: scorePersonFile(p.slice("vault/people/".length), name) }))
    .filter(x => x.score >= 25).sort((a, b) => b.score - a.score);
}

/** The one card that is clearly this person (score >= 80 and not tied), else null. */
export async function personCard(repo: HaroldRepo, name: string): Promise<{ path: string; text: string; sha: string; fm: Record<string, string> } | null> {
  const c = await findPersonCards(repo, name);
  if (!c.length || c[0].score < 80 || (c[1] && c[1].score === c[0].score)) return null;
  const f = await repo.getText(c[0].path);
  return f ? { path: c[0].path, text: f.text, sha: f.sha, fm: frontmatter(f.text) } : null;
}

/** A person card's type: `type`, or `category` on older cards (as bin/harold reads it). */
export const cardType = (fm: Record<string, string>) => String(fm.type || fm.category || "").trim().toLowerCase();
/** true when HAROLD_NO_LOG_TYPES lists the card's type. Always false when the setting is empty. */
export const isNoLogCard = (fm: Record<string, string>) => isNoLogType(cardType(fm));

/** Harold's filing rule: a CRM write about a person also freshens their vault card. */
export async function touchPersonCard(repo: HaroldRepo, name: string, now = new Date()): Promise<string> {
  const card = await personCard(repo, name).catch(() => null);
  if (!card) return `No vault card found for ${name}; nothing to update in vault/people.`;
  if (isNoLogCard(card.fm)) return `${card.path}: type "${cardType(card.fm)}" is in HAROLD_NO_LOG_TYPES; card not updated.`;
  const iso = localParts(now).iso;
  if (card.fm.last_updated === iso) return `${card.path}: last_updated already ${iso}.`;
  const r = await repo.commit(card.path, cur => {
    if (!cur) return { refuse: "card disappeared" };
    const u = updateFrontmatter(cur.text, { last_updated: iso });
    return u.error ? { refuse: u.error } : { text: u.text };
  }, msg(`touch ${card.path.slice("vault/people/".length, -3)} card after CRM update`));
  return r.ok ? `Vault card ${card.path}: last_updated → ${iso} (commit ${r.commit.slice(0, 7)}).` : `Vault card not updated: ${r.reason}`;
}

// ───────────── write ─────────────

export async function capture(repo: HaroldRepo, text: string, topic?: string, now = new Date()): Promise<ToolText> {
  const body = text.trim();
  if (!body) return fail("Nothing to capture.");
  if (body.length > 20_000) return fail("That is too long for a capture (20,000 characters max). Use harold_note for a longer note.");
  const t = localParts(now);
  const path = `vault/daily/${t.iso}-chat.md`;
  const lines = body.split("\n");
  const bullet = `- **${t.hm}**${topic?.trim() ? ` [${topic.trim()}]` : ""} ${lines[0]}${lines.slice(1).map(l => `\n  ${l}`).join("")}`;
  const r = await repo.commit(path, cur => {
    if (!cur) return { text: `---\ndate: ${t.iso}\nsession: chat\n---\n\n# ${t.iso} — captured from chat\n\n${bullet}\n` };
    return { text: `${cur.text.replace(/\s+$/, "")}\n${bullet}\n` };
  }, msg(`capture to ${t.iso} chat log`));
  if (!r.ok) return fail(r.reason);
  return { text: `Captured in ${path} (commit ${r.commit.slice(0, 7)} on ${repo.branch}):\n${bullet}` };
}

export const NOTE_KINDS = ["intel", "decision", "meeting", "company", "project"] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];

export function notePath(kind: NoteKind, title: string, dateIso: string): string {
  const slug = slugify(title);
  switch (kind) {
    case "intel": return `vault/intel/${slug}.md`;
    case "decision": return `vault/decisions/${dateIso}-${slug}.md`;
    case "meeting": return `vault/meetings/${dateIso}-${slug}.md`;
    case "project": return `vault/projects/${slug}.md`;
    case "company": {
      // Company cards are named like people cards: the organisation's own name.
      const name = title.replace(/[\/\\:*?"<>|#^\[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || slug;
      return `vault/companies/${name}.md`;
    }
  }
}

export async function note(repo: HaroldRepo, kind: NoteKind, title: string, body: string, now = new Date()): Promise<ToolText> {
  if (!title.trim()) return fail("A note needs a title.");
  if (!body.trim()) return fail("A note needs a body.");
  const iso = localParts(now).iso;
  const path = notePath(kind, title.trim(), iso);
  const tag = kind === "company" ? "company" : kind;
  const heading = /^#\s/.test(body.trim()) ? "" : `# ${title.trim()}\n\n`;
  const content = `---\ntags: [${tag}]\ndate: ${iso}\nlast_updated: ${iso}\nsource: connector\n---\n\n${heading}${body.trim()}\n`;
  const r = await repo.commit(path, cur => (cur ? { refuse: `${path} already exists. Use harold_update to add to it instead of overwriting it.` } : { text: content }), msg(`new ${kind} note ${path.split("/").pop()}`));
  if (!r.ok) return fail(r.reason);
  return { text: `Created ${path} (commit ${r.commit.slice(0, 7)} on ${repo.branch}).` };
}

export function updatePathError(path: string): string | null {
  let p: string;
  try { p = cleanPath(path); } catch (e) { return e instanceof Error ? e.message : "bad path"; }
  if (!/^(vault|harold)\//.test(p)) return "harold_update only edits files under vault/ or harold/.";
  if (/\.jsonl$/i.test(p)) return "JSONL files are not edited here (use harold_learning for learnings).";
  if (!/\.md$/i.test(p)) return "Only markdown (.md) files can be updated.";
  if (/(^|\/)AGENTS\.md$/i.test(p) || /^(bin|tools|\.github)\//.test(p) || /(^|\/)(bin|tools|\.github)\//.test(p)) return "That file is part of Harold's machinery and is only changed in a code session.";
  return null;
}

export async function update(repo: HaroldRepo, path: string, opts: { append_text?: string; heading?: string; frontmatter_updates?: Record<string, string> }, now = new Date()): Promise<ToolText> {
  const bad = updatePathError(path);
  if (bad) return fail(bad);
  const p = cleanPath(path);
  const hasAppend = !!opts.append_text && opts.append_text.trim().length > 0;
  const fmu = opts.frontmatter_updates && Object.keys(opts.frontmatter_updates).length ? { ...opts.frontmatter_updates } : undefined;
  if (!hasAppend && !fmu) return fail("Nothing to do: give append_text and/or frontmatter_updates.");
  const iso = localParts(now).iso;
  const r = await repo.commit(p, cur => {
    if (!cur) return { refuse: `${p} does not exist. Create new notes with harold_note (or harold_capture for a quick fact).` };
    let text = cur.text;
    if (hasAppend) text = appendUnderHeading(text, opts.append_text!, opts.heading);
    const upd = { ...(fmu || {}) };
    // Freshen last_updated when the file tracks it and the caller did not set it.
    if (frontmatter(text).last_updated !== undefined && upd.last_updated === undefined) upd.last_updated = iso;
    if (Object.keys(upd).length) {
      const u = updateFrontmatter(text, upd);
      if (u.error) return { refuse: u.error };
      text = u.text;
    }
    if (text === cur.text) return { refuse: "No change: the file already says that." };
    return { text };
  }, msg(`update ${p}`));
  if (!r.ok) return fail(r.reason);
  const did = [hasAppend ? `appended${opts.heading ? ` under "${opts.heading}"` : " at the end"}` : "", fmu ? `frontmatter ${Object.keys(fmu).join(", ")}` : ""].filter(Boolean).join("; ");
  return { text: `Updated ${p}: ${did} (commit ${r.commit.slice(0, 7)} on ${repo.branch}).` };
}

export async function learning(repo: HaroldRepo, a: { lesson: string; severity: string; category: string; project?: string }, now = new Date()): Promise<ToolText> {
  if (!a.lesson.trim()) return fail("A learning needs the lesson text.");
  if (!(SEVERITIES as readonly string[]).includes(a.severity)) return fail(`severity must be one of ${SEVERITIES.join(", ")}`);
  if (!(CATEGORIES as readonly string[]).includes(a.category)) return fail(`category must be one of ${CATEGORIES.join(", ")}`);
  if (/[\r\n]/.test(a.project || "")) return fail("project must be one line.");
  const iso = localParts(now).iso;
  let entry: Record<string, string> = {};
  const r = await repo.commit("harold/learnings.jsonl", cur => {
    const out = appendLearning(cur ? cur.text : "", a, iso);
    entry = out.entry;
    return { text: out.text };
  }, msg(`learning (${a.severity}, ${a.category})`));
  if (!r.ok) return fail(r.reason);
  return { text: `Recorded ${entry.id} in harold/learnings.jsonl (commit ${r.commit.slice(0, 7)} on ${repo.branch}${r.attempts > 1 ? `, after ${r.attempts - 1} retr${r.attempts === 2 ? "y" : "ies"}` : ""}):\n${JSON.stringify(entry)}` };
}

export { GithubError };
