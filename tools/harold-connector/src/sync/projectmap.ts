// Harold project <-> provider project, from harold/projects.md (parsed read-only with src/projects.ts).
// A map entry may carry `<provider>_project: <name>` (linear_project, todoist_project, ...); for that provider it
// wins over the entry's name and aliases.

import { parseProjects, type Project } from "../projects.js";

export interface CachedProject {
  name: string; aliases: string[]; folder: string | null; linear_project: string | null;
  /** Every other `<provider>_project:` field of the entry, keyed by provider; present only when there is one. */
  provider_projects?: Record<string, string>;
}

const norm = (s: string | null | undefined) => (s || "").trim().toLowerCase();
const explicitField = (provider: string) => `${provider.toLowerCase()}_project`;

export class ProjectMap {
  constructor(public readonly projects: Project[]) {}

  static fromMarkdown(text: string): ProjectMap { return new ProjectMap(parseProjects(text)); }

  /** The slice of each entry the sync needs, as stored in sync_state 'harold-projects'. */
  toCache(): CachedProject[] {
    return this.projects.map(p => {
      const others: Record<string, string> = {};
      for (const [k, v] of Object.entries(p)) {
        const m = k.match(/^([a-z][a-z0-9]*)_project$/);
        if (m && m[1] !== "linear" && typeof v === "string" && v.trim()) others[m[1]] = v.trim();
      }
      return {
        name: p.name, aliases: p.aliasList, folder: p.folder ?? null, linear_project: (p.linear_project as string | undefined)?.trim() || null,
        ...(Object.keys(others).length ? { provider_projects: others } : {}),
      };
    });
  }

  static fromCache(list: CachedProject[]): ProjectMap {
    return new ProjectMap(list.filter(c => c && typeof c.name === "string").map(c => {
      const extra: Record<string, string> = {};
      for (const [prov, v] of Object.entries(c.provider_projects || {})) if (typeof v === "string") extra[explicitField(prov)] = v;
      return {
        ...extra,
        name: c.name, folder: c.folder ?? undefined, aliases: (c.aliases || []).join(", "), linear_project: c.linear_project ?? undefined,
        aliasList: Array.isArray(c.aliases) ? c.aliases : [], keywordList: [], aliasesTodo: false,
      };
    }));
  }

  /** The map entry a Harold project value names (by name or alias, case-insensitive). */
  entry(haroldProject: string | null | undefined): Project | undefined {
    const q = norm(haroldProject);
    if (!q) return undefined;
    return this.projects.find(p => norm(p.name) === q) || this.projects.find(p => p.aliasList.some(a => norm(a) === q));
  }

  /** A provider's project name -> Harold project name, or null when nothing matches. */
  fromProvider(provider: string, providerProject: string | null | undefined): string | null {
    const q = norm(providerProject);
    if (!q) return null;
    const f = explicitField(provider);
    const explicit = this.projects.find(p => norm(p[f] as string | undefined) === q);
    if (explicit) return explicit.name;
    return this.entry(q)?.name ?? null;
  }

  /** Harold project -> the provider project name to look for (the entry's `<provider>_project`, else its name). */
  toProvider(provider: string, haroldProject: string | null | undefined): string | null {
    if (!norm(haroldProject)) return null;
    const e = this.entry(haroldProject);
    if (!e) return (haroldProject as string).trim();
    const explicit = (e[explicitField(provider)] as string | undefined)?.trim();
    return explicit || e.name;
  }

  fromLinear(linearProject: string | null | undefined): string | null { return this.fromProvider("linear", linearProject); }
  toLinear(haroldProject: string | null | undefined): string | null { return this.toProvider("linear", haroldProject); }
}
