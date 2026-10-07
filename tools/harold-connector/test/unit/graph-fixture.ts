// A small harold/graph.json in the format bin/harold-index graph-json writes (version 1).
// Today is 2026-10-07 in these tests.

export const TODAY = "2026-10-07";
export const JANE = "vault/people/Jane Doe.md";
export const ACME = "vault/companies/Acme.md";
export const PILOT = "vault/projects/Pilot.md";
export const BOB = "vault/people/Bob Roe.md";
export const CAROL = "vault/people/Carol Poe.md";
export const MEETING = "vault/meetings/2026-09-20-acme-kickoff.md";
export const DECISION = "vault/decisions/2026-09-01-go-with-acme.md";
export const ORPHAN = "vault/intel/lonely-intel.md";
export const DAILIES = ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-05", "2026-10-06"].map(d => `vault/daily/${d}-work.md`);

export function graphJson(): string {
  const nodes: [string, string, string, string][] = [
    [JANE, "Jane Doe", "person", "2026-08-01"],
    [ACME, "Acme", "company", "2026-10-01"],
    [PILOT, "Pilot Program", "project", "2026-09-30"],
    [BOB, "Bob Roe", "person", "2026-09-15"],
    [CAROL, "Carol Poe", "person", "2026-10-02"],
    [MEETING, "Acme kickoff", "meeting", "2026-09-20"],
    [DECISION, "Go with Acme", "decision", ""],
    [ORPHAN, "Lonely intel", "intel", "2026-10-06"],
    ...DAILIES.map(p => [p, p.slice(12, 22), "daily", p.slice(12, 22)] as [string, string, string, string]),
  ];
  const edges: [string, string, string][] = [
    [JANE, ACME, "frontmatter:org"], [ACME, JANE, "wikilink"],
    [JANE, PILOT, "wikilink"],
    [MEETING, JANE, "wikilink"], [MEETING, ACME, "wikilink"],
    [ACME, BOB, "wikilink"], [PILOT, BOB, "mdlink"],
    [ACME, CAROL, "wikilink"],
    [DECISION, ACME, "wikilink"],
    ...DAILIES.map(p => [p, JANE, "wikilink"] as [string, string, string]),
  ];
  const broken: [string, string, string][] = [[JANE, "Nonexistent Person", "wikilink"], [JANE, "Gone Corp", "frontmatter:company"]];
  const j = (x: unknown) => JSON.stringify(x);
  return '{"version":1,"generated_by":"bin/harold-index graph-json","stale_days":30,\n'
    + '"node_fields":["path","title","type","last_updated"],\n"nodes":[\n' + nodes.sort().map(j).join(",\n")
    + '\n],\n"edge_fields":["src","dst","kind"],\n"edges":[\n' + edges.sort().map(j).join(",\n")
    + '\n],\n"broken_fields":["src","target","kind"],\n"broken":[\n' + broken.sort().map(j).join(",\n") + "\n]}\n";
}
