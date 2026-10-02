// harold/projects.md parsing and `where` scoring, ported line for line from bin/harold
// (loadProjects + cmdWhere) so the connector and the CLI resolve a topic to the same project.

export interface Project {
  name: string;
  folder?: string; status?: string; type?: string; aliases?: string; keywords?: string;
  routes?: string; people?: string; card?: string; notes?: string; competitors?: string;
  aliasList: string[]; keywordList: string[]; aliasesTodo: boolean;
  [k: string]: unknown;
}

export function parseProjects(text: string): Project[] {
  const projects: Project[] = [];
  let cur: Record<string, unknown> | null = null;
  for (const line of text.split("\n")) {
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h) { cur = { name: h[1].trim() }; projects.push(cur as unknown as Project); continue; }
    const kv = cur && line.match(/^-\s+([a-z_]+):\s*(.*)$/);
    if (kv && cur) cur[kv[1]] = kv[2].trim();
  }
  const split = (s?: string) => (s || "").replace(/—\s*ALIASES:\s*TODO/i, "").split(",").map(x => x.trim()).filter(Boolean);
  projects.forEach(p => { p.aliasList = split(p.aliases); p.keywordList = split(p.keywords); p.aliasesTodo = /ALIASES:\s*TODO/i.test(p.aliases || ""); });
  return projects;
}

export function scoreProject(p: Project, query: string): number {
  const q = query.trim().toLowerCase();
  let s = 0; const name = p.name.toLowerCase();
  if (name === q || p.aliasList.some(a => a.toLowerCase() === q)) s += 100;
  if (name.includes(q) || q.includes(name)) s += 40;
  p.aliasList.forEach(a => { const al = a.toLowerCase(); if (al && (q.includes(al) || al.includes(q))) s += 30; });
  p.keywordList.forEach(k => { const kl = k.toLowerCase(); if (kl && (q.includes(kl) || kl.includes(q))) s += 10; });
  const f = (p.folder || "").toLowerCase(); if (f && (f.includes(q.replace(/\s+/g, "_")) || f.includes(q.replace(/\s+/g, "-")))) s += 25;
  if (p.status === "archived") s -= 15;
  return s;
}

export function rankProjects(projects: Project[], query: string) {
  return projects.map(p => ({ p, s: scoreProject(p, query) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s);
}

/** Same output shape as `bin/harold where`, with repo-relative paths (there is no local root here). */
export function formatWhere(projects: Project[], query: string): { found: boolean; text: string } {
  const q = query.trim().toLowerCase();
  if (!q) return { found: false, text: "usage: harold_where(topic)" };
  const ranked = rankProjects(projects, q);
  if (!ranked.length) return { found: false, text: `no project matches "${q}" — if this is a new project, run playbook/core/project-intake.md: create the folder, add the harold/projects.md entry, create the vault card, cross-link.` };
  const top = ranked[0].p;
  const L = [`${top.name} [${top.status}]`, `folder: ${top.folder || ""}`];
  if (top.routes) L.push("routes:\n" + top.routes.split(";").map(r => "  " + r.trim()).join("\n"));
  if (top.card) L.push(`card: ${top.card}`);
  if (top.people) L.push(`people: ${top.people}`);
  if (top.notes) L.push(`notes: ${top.notes}`);
  if (ranked.length > 1) L.push(`also: ${ranked.slice(1, 4).map(x => x.p.name).join(", ")}`);
  return { found: true, text: L.join("\n") };
}
