import { beforeEach, describe, expect, it } from "vitest";
import { findStart, gaps, parseGraph, related, relatedText, resolveName } from "../../src/graph.js";
import { HaroldRepo } from "../../src/github.js";
import { FakeGithub } from "./fakes.js";
import { OWNER, setTestEnv } from "./env.js";
import { ACME, BOB, CAROL, DAILIES, DECISION, JANE, MEETING, ORPHAN, PILOT, TODAY, graphJson } from "./graph-fixture.js";

beforeEach(() => setTestEnv());

function repoWith(files: Record<string, string>) {
  const gh = new FakeGithub();
  gh.users.set("tok", OWNER);
  for (const [p, t] of Object.entries(files)) gh.files.set(p, t);
  return { gh, repo: new HaroldRepo("tok", "owner/harold", "main", gh.fetch) };
}

describe("graph.json parsing and name resolution", () => {
  const g = parseGraph(graphJson(), TODAY);

  it("reads nodes, edges both ways, broken links and stale_days", () => {
    expect(g.nodes.size).toBe(8 + DAILIES.length);
    expect(g.out.get(JANE)?.get(ACME)).toBe("frontmatter:org");
    expect(g.inn.get(JANE)?.get(ACME)).toBe("wikilink");
    expect(g.broken.get(JANE)).toHaveLength(2);
    expect(g.staleDays).toBe(30);
    expect(g.ageDays("2026-08-01")).toBe(67);
    expect(g.isStale(g.node(JANE))).toBe(true);
    expect(g.isStale(g.node(MEETING))).toBe(false);   // dated records are never stale
  });

  it("resolves by file name, then title, any case, and by path suffix", () => {
    expect(resolveName(g, "Jane Doe")).toBe(JANE);
    expect(resolveName(g, "jane doe")).toBe(JANE);
    expect(resolveName(g, "Pilot Program")).toBe(PILOT);       // title
    expect(resolveName(g, "people/Jane Doe")).toBe(JANE);      // path suffix
    expect(resolveName(g, "Nobody")).toBeNull();
  });

  it("refuses something that is not a graph", () => {
    expect(() => parseGraph("not json", TODAY)).toThrow(/not valid JSON/);
    expect(() => parseGraph("{}", TODAY)).toThrow(/no nodes\/edges/);
  });

  it("finds the start note by path, name, search (entity notes first), then title words", async () => {
    const none = async () => [] as string[];
    expect(await findStart(g, JANE, none)).toEqual({ starts: [JANE], how: "path" });
    expect(await findStart(g, "vault/people/Jane Doe", none)).toEqual({ starts: [JANE], how: "path" });
    expect(await findStart(g, "Acme", none)).toEqual({ starts: [ACME], how: "name" });
    const s = await findStart(g, "kickoff pricing", async () => [DAILIES[0], MEETING, BOB, "not/in/graph.md"]);
    expect(s).toEqual({ starts: [BOB, DAILIES[0], MEETING], how: "search" });
    const w = await findStart(g, "lonely", async () => { throw new Error("search down"); });
    expect(w).toEqual({ starts: [ORPHAN], how: "title words" });
  });
});

describe("related (as bin/harold related) and gaps", () => {
  const g = parseGraph(graphJson(), TODAY);

  it("depth 1: direct links first (both ways before one way), shared 2-hop notes, daily notes collapsed to 3", () => {
    const { rows, total, hiddenDaily } = related(g, [JANE], 1, 15);
    expect(rows[0]).toMatchObject({ path: ACME, relation: "both", kind: "frontmatter:org", last_updated: "2026-10-01", stale: false });
    const byPath = Object.fromEntries(rows.map(r => [r.path, r]));
    expect(byPath[PILOT]).toMatchObject({ relation: "outgoing", kind: "wikilink" });
    expect(byPath[MEETING]).toMatchObject({ relation: "backlink", kind: "wikilink", shared: 1 });
    expect(byPath[BOB]).toMatchObject({ relation: "shared", shared: 2 });        // via Acme and Pilot
    expect(byPath[CAROL]).toBeUndefined();                                       // one shared link: depth 2 only
    expect(rows.filter(r => r.type === "daily")).toHaveLength(3);
    expect(hiddenDaily).toHaveLength(2);
    expect(total).toBe(3 + DAILIES.length + 1 /* Bob; the decision shares only Acme: depth 2 */);
  });

  it("depth 2 adds every note 2 hops out", () => {
    const { rows } = related(g, [JANE], 2, 50, true);
    expect(rows.find(r => r.path === CAROL)).toMatchObject({ relation: "via", shared: 1, shared_via: ["Acme"] });
    expect(rows.filter(r => r.type === "daily")).toHaveLength(DAILIES.length);
  });

  it("gaps: stale, broken links, frontmatter names with no note, orphans, no meetings", () => {
    const j = gaps(g, JANE);
    expect(j).toContain("last updated 67 days ago (2026-08-01)");
    expect(j).toContain("1 broken link ([[Nonexistent Person]])");
    expect(j).toContain("no note for company: Gone Corp");
    expect(j.join("; ")).not.toMatch(/orphan|no meeting notes/);
    expect(gaps(g, ORPHAN)).toEqual(["no links in or out (orphan)"]);
    expect(gaps(g, CAROL)).toEqual(["links to nothing", "no meeting notes linked", "not in any daily note"]);
    expect(gaps(g, DECISION)).toEqual(["no last_updated date in the note", "nothing links to it"]);
    expect(gaps(g, ACME)).toContain("1 directly linked note stale (>30d)");
  });
});

describe("relatedText (the harold_related tool)", () => {
  it("says clearly when graph.json is absent (an older repo)", async () => {
    const { repo } = repoWith({ "vault/people/Jane Doe.md": "# Jane" });
    const r = await relatedText(repo, "Jane Doe", TODAY);
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/harold\/graph\.json is not in owner\/harold @ main/);
    expect(r.text).toMatch(/bin\/harold close/);
    expect(r.text).toMatch(/harold_search and harold_read/);
  });

  it("lists neighbours with kind and date, then the gaps line", async () => {
    const { repo } = repoWith({ "harold/graph.json": graphJson() });
    const r = await relatedText(repo, "Jane Doe", TODAY);
    expect(r.isError).toBeFalsy();
    expect(r.text.split("\n")[0]).toBe(`Jane Doe · ${JANE} · person · updated 2026-08-01 (67d) STALE · 2 out, 7 in, 2 broken`);
    expect(r.text).toContain(`1. ↔ Acme · ${ACME} · company · 2026-10-01 (6d)\n   linked both ways by frontmatter:org`);
    expect(r.text).toContain("linked from it by [[wikilink]]");
    expect(r.text).toMatch(/⇄ Bob Roe · .* · 2026-09-15 \(22d\)\n {3}2 shared links \(Acme, Pilot Program\), 2 hops/);
    expect(r.text).toContain("2 more daily notes (latest 2026-10-02; all: true shows them)");
    expect(r.text).toContain("gaps: Jane Doe: last updated 67 days ago (2026-08-01); 1 broken link ([[Nonexistent Person]]); no note for company: Gone Corp");
    expect(r.text).toMatch(/Say the staleness and the gaps in your answer/);
  });

  it("resolves a topic through code search and says it did", async () => {
    const { gh, repo } = repoWith({ "harold/graph.json": graphJson() });
    gh.searchHits = [DAILIES[1], ACME];
    const r = await relatedText(repo, "widget pricing", TODAY, { depth: 2 });
    expect(r.text.split("\n")[0]).toMatch(/^Acme · /);
    expect(r.text).toContain('(matched by search for "widget pricing"; pass a path or exact title to pin one note)');
    expect(gh.calls.some(c => c === "GET /search/code")).toBe(true);
    expect(r.text).toContain("⋯ ");                                                    // depth 2 rows
  });

  it("says when nothing matches", async () => {
    const { repo } = repoWith({ "harold/graph.json": graphJson() });
    const r = await relatedText(repo, "zzqx nothing", TODAY);
    expect(r.text).toMatch(/No note found for "zzqx nothing"/);
  });
});
