// harold_pulse and the project counts in harold_today. pulse-fixture.json is shared with the workspace's
// tests/test_harold_index.py: the same files and commits must give bin/harold pulse and harold_pulse the same text.
// Fictional data only.

import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { HaroldRepo } from "../../src/github.js";
import * as kb from "../../src/kb.js";
import { parseGraph } from "../../src/graph.js";
import { parseProjects } from "../../src/projects.js";
import { activity, bodyNextStep, commitCounts, lastCommit, cleanStep, dateIn, findCard, fmNextStep, normFolder, pulseBoot, pulseData, pulseDays, pulseText, pulseTodaySection, pulseTool, setStatus } from "../../src/pulse.js";
import { formatWhere } from "../../src/projects.js";
import { FakeGithub } from "./fakes.js";
import { OWNER, setTestEnv } from "./env.js";

interface Fixture {
  today: string; tz: string; initial_commit: string; files: Record<string, string>;
  commits: { date: string; message: string; files: Record<string, string | null> }[];
  graph_json: string; expected: { text: string; text_all: string; boot: string };
}
const FX: Fixture = JSON.parse(readFileSync(new URL("./pulse-fixture.json", import.meta.url), "utf8"));

beforeEach(() => setTestEnv({ HAROLD_PULSE_DAYS: "" }));

function fixtureRepo(over: { files?: Record<string, string | null>; commits?: boolean } = {}) {
  const gh = new FakeGithub();
  gh.users.set("tok", OWNER);
  for (const [p, t] of Object.entries(FX.files)) gh.files.set(p, t);
  gh.files.set("harold/graph.json", FX.graph_json);
  for (const [p, t] of Object.entries(over.files || {})) { if (t === null) gh.files.delete(p); else gh.files.set(p, t); }
  if (over.commits !== false) {
    const seen = new Set(Object.keys(FX.files));   // a file the fixture's commits add is "added" the first time, "modified" after; null deletes it
    gh.commitLog.push({ date: FX.initial_commit, message: "init", paths: [...seen], files: [...seen].map(filename => ({ filename, status: "added" })) });
    for (const c of FX.commits) {
      const files = Object.entries(c.files).map(([filename, t]) => {
        const status = t === null ? "removed" : seen.has(filename) ? "modified" : "added";
        if (t === null) seen.delete(filename); else seen.add(filename);
        return { filename, status };
      });
      gh.commitLog.push({ date: c.date, message: c.message, paths: files.map(f => f.filename), files });
    }
  }
  return { gh, repo: new HaroldRepo("tok", "owner/harold", "main", gh.fetch) };
}

describe("the same answer as bin/harold pulse (shared fixture)", () => {
  it("default text: the active projects with their next step, the quiet ones on one line", async () => {
    const { repo } = fixtureRepo();
    expect(pulseText(await pulseData(repo, FX.today, FX.tz))).toBe(FX.expected.text);
  });
  it("all: each quiet project with its last activity, and the archived and autonomous ones", async () => {
    const { repo } = fixtureRepo();
    expect(pulseText(await pulseData(repo, FX.today, FX.tz, { all: true }), true)).toBe(FX.expected.text_all);
  });
  it("boot: the counts only", async () => {
    const { repo } = fixtureRepo();
    expect(pulseBoot(await pulseData(repo, FX.today, FX.tz))).toBe(FX.expected.boot);
  });
  it("harold_today's section carries the same counts and never lists the quiet projects", async () => {
    const { repo } = fixtureRepo();
    const section = pulseTodaySection(await pulseData(repo, FX.today, FX.tz));
    expect(section).toBe("3 active, 3 quiet; active means activity within 14 days (harold_pulse lists them). Quiet projects are not raised.");
    expect(section).not.toMatch(/Delta|Old Thing|Pilot/);
  });
  it("the derived statuses, reasons and order", async () => {
    const { repo } = fixtureRepo();
    const d = await pulseData(repo, FX.today, FX.tz, { all: true });
    expect(d.projects.map(p => [p.name, p.status])).toEqual([
      ["Gamma Research", "active"], ["Beta Launch", "active"], ["Echo", "active"],
      ["Delta", "quiet"], ["Old Thing", "quiet"], ["Pilot Program", "quiet"],
      ["Foxtrot", "archived"], ["Sentinel", "autonomous"]]);
    expect([d.active, d.quiet]).toEqual([3, 3]);
    expect(d.projects.find(p => p.name === "Echo")?.last).toMatchObject({ label: "task due", date: "2026-10-12", via: "plan" });   // its only activity is coming up
    expect(d.projects.find(p => p.name === "Old Thing")?.set_status).toBe("paused");
    expect(d.projects.find(p => p.name === "Pilot Program")?.set_status).toBe("active");   // a legacy hand value, ignored
  });
});

describe("which commits count as activity", () => {
  const folders = { A: "a", B: "b", C: "c", D: "d", A2: "a/sub" };
  it("the fixture: delete-only and 4-project commits do not count, a single-project commit does", async () => {
    const { repo } = fixtureRepo();
    const d = await pulseData(repo, FX.today, FX.tz, { all: true });
    expect(d.projects.find(p => p.name === "Delta")?.last).toBeNull();                              // 4-project commit, then a delete-only one
    expect(d.projects.find(p => p.name === "Beta Launch")?.last).toMatchObject({ kind: "commit", date: "2026-10-03" });
  });
  it("commitCounts: add or change in the folder, at most 3 projects' folders", () => {
    expect(commitCounts([["A", "a/x"]], "a", folders)).toBe(true);
    expect(commitCounts([["M", "a/x"], ["M", "vault/y"], ["M", "bin/z"]], "a", folders)).toBe(true);   // files outside every folder are not counted
    expect(commitCounts([["R", "a/new"], ["D", "b/old"]], "a", folders)).toBe(true);                    // renamed into the folder
    expect(commitCounts([["D", "a/x"], ["D", "a/y"]], "a", folders)).toBe(false);                       // delete-only
    expect(commitCounts([["A", "a/x"], ["A", "b/x"], ["M", "c/x"]], "a", folders)).toBe(true);          // 3 projects
    expect(commitCounts([["A", "a/x"], ["A", "b/x"], ["M", "c/x"], ["M", "d/x"]], "a", folders)).toBe(false);   // 4 projects
    expect(commitCounts([["A", "a/sub/x"], ["A", "b/x"]], "a/sub", folders)).toBe(true);                // a/sub/x is in A and A2, plus B = 3
    expect(commitCounts([["A", "a/sub/x"], ["A", "b/x"], ["A", "c/x"]], "a", folders)).toBe(false);     // nested counts separately: A, A2, B, C = 4
  });
  it("lastCommit walks back past housekeeping, skips merges, and stops at the window and at 20 commits", async () => {
    const { gh, repo } = fixtureRepo({ commits: false });
    const mk = (date: string, message: string, files: { filename: string; status: string }[], merge = false) =>
      gh.commitLog.push({ date, message, paths: files.map(f => f.filename), files, merge });
    mk("2026-10-01T00:00:00Z", "real work", [{ filename: "projects/beta/x.txt", status: "modified" }]);
    mk("2026-10-02T00:00:00Z", "merge", [{ filename: "projects/beta/y.txt", status: "modified" }], true);
    mk("2026-10-03T00:00:00Z", "tidy", [{ filename: "projects/beta/x.txt", status: "removed" }]);
    mk("2026-10-04T00:00:00Z", "bulk", ["beta", "gamma", "echo", "delta"].map(n => ({ filename: `projects/${n}/z.txt`, status: "modified" })));
    const f = { Beta: "projects/beta", Gamma: "projects/gamma", Echo: "projects/echo", Delta: "projects/delta" };
    expect(await lastCommit(repo, "projects/beta", f, "2026-09-01", "UTC")).toEqual({ date: "2026-10-01", subject: "real work" });
    expect(await lastCommit(repo, "projects/beta", f, "2026-10-03", "UTC")).toBeNull();               // the walk stops once past the window
    const calls = gh.calls.length;
    await lastCommit(repo, "projects/beta", f, "2026-09-01", "UTC");
    expect(gh.calls.slice(calls).filter(c => c.startsWith("COMMIT")).length).toBe(0);                  // commit details are kept
  });
  it("lastCommit looks at no more than 20 commits", async () => {
    const { gh, repo } = fixtureRepo({ commits: false });
    for (let i = 0; i < 25; i++) gh.commitLog.push({ date: `2026-10-0${1 + (i % 6)}T0${i % 10}:00:00Z`, message: `m${i}`, paths: ["projects/beta/x.txt"], files: [{ filename: "projects/beta/x.txt", status: "removed" }] });
    gh.commitLog.push({ date: "2026-09-30T00:00:00Z", message: "old real", paths: ["projects/beta/x.txt"], files: [{ filename: "projects/beta/x.txt", status: "modified" }] });
    expect(await lastCommit(repo, "projects/beta", { Beta: "projects/beta" }, "2026-01-01", "UTC")).toBeNull();
  });
  it("commitFiles reads every page of a big commit", async () => {
    const { gh, repo } = fixtureRepo({ commits: false });
    const files = Array.from({ length: 150 }, (_, i) => ({ filename: `vault/n${i}.md`, status: "modified" }));
    gh.commitLog.push({ date: "2026-10-01T00:00:00Z", message: "big", paths: files.map(f => f.filename), files });
    const [c] = await repo.commitsTouching("vault", 20);
    expect((await repo.commitFiles(c.sha))?.length).toBe(150);
  });
});

describe("activity", () => {
  const g = parseGraph(FX.graph_json, FX.today);
  const projects = parseProjects(FX.files["harold/projects.md"]);
  const P = (name: string) => projects.find(p => p.name === name)!;

  it("a meeting note dated beyond the window is not activity", () => {
    const last = activity(P("Pilot Program"), g, "vault/projects/pilot.md", "projects/pilot", FX.today, null);
    expect(last?.path).toBe("vault/meetings/2026-09-18-acme-kickoff.md");
    expect(last?.via).toBe("link");
  });
  it("a meeting note that names the project counts, a daily note that only names it does not (mentions in graph.json)", () => {
    const card = findCard(P("Gamma Research"), g);
    expect(card).toBe("vault/projects/gamma-research.md");   // found by title: no card: field
    const last = activity(P("Gamma Research"), g, card, "projects/gamma", FX.today, null);
    expect(last).toMatchObject({ kind: "note", date: "2026-10-05", label: "meeting note", via: "mention" });   // not the 2026-10-06 daily note
  });
  // The shared graph plus extra notes and links, for what does and does not count as activity.
  const gWith = (nodes: string[][], edges: string[][] = []) => {
    const j = JSON.parse(FX.graph_json);
    j.nodes.push(...nodes); j.edges.push(...edges.map(e => [...e, "wikilink"]));
    return parseGraph(JSON.stringify(j), FX.today);
  };
  const DELTA = "vault/projects/delta.md";
  const card = ["vault/projects/delta.md", "Delta", "project", FX.today];
  it("a card edited today with no other work is quiet", () => {
    const g2 = gWith([card]);
    expect(findCard(P("Delta"), g2)).toBe(DELTA);
    expect(activity(P("Delta"), g2, DELTA, "projects/delta", FX.today, null)).toBeNull();
  });
  it("a person or intel card linking to the project card does not make it active", () => {
    const g2 = gWith([card, ["vault/people/Jane.md", "Jane", "person", FX.today], ["vault/intel/delta.md", "Delta intel", "intel", FX.today]],
      [["vault/people/Jane.md", DELTA], ["vault/intel/delta.md", DELTA]]);
    expect(activity(P("Delta"), g2, DELTA, "projects/delta", FX.today, null)).toBeNull();
  });
  it("a daily note that only names the project does not count, but one that links the card does", () => {
    const daily = ["vault/daily/2026-10-07-work.md", "Work log", "daily", FX.today];
    const named = gWith([card, daily]);
    named.mentions.set("Delta", new Set(["vault/daily/2026-10-07-work.md"]));
    expect(activity(P("Delta"), named, DELTA, "projects/delta", FX.today, null)).toBeNull();
    const linked = gWith([card, daily], [["vault/daily/2026-10-07-work.md", DELTA]]);
    expect(activity(P("Delta"), linked, DELTA, "projects/delta", FX.today, null)).toMatchObject({ date: FX.today, label: "daily note", via: "link" });
  });
  it("a commit newer than every note wins; an older or future one does not", () => {
    const p = P("Beta Launch");
    expect(activity(p, g, "vault/projects/beta.md", "projects/beta", FX.today, { date: "2026-10-03", subject: "x" })?.kind).toBe("commit");
    expect(activity(p, g, "vault/projects/beta.md", "projects/beta", FX.today, { date: "2026-07-01", subject: "x" })?.kind).toBe("commit");   // the card's own date does not count
    expect(activity(p, g, "vault/projects/beta.md", "projects/beta", FX.today, { date: "2026-10-09", subject: "x" })).toBeNull();   // a future commit is ignored
  });
  it("a project with nothing dated has no activity", () => {
    expect(activity(P("Delta"), g, findCard(P("Delta"), g), "projects/delta", FX.today, null)).toBeNull();
  });
});

describe("next step", () => {
  it("reads frontmatter, 'Next step:' lines and a 'Next steps' heading; ignores comments and placeholders", () => {
    expect(fmNextStep("---\nnext_step: \"call Jane\"\n---\n# X\n")).toBe("call Jane");
    expect(fmNextStep("---\nnext_step:   # one line\n---\n")).toBe("");
    expect(bodyNextStep("# X\n\n**Next step:** send the deck\n")).toBe("send the deck");
    expect(bodyNextStep("# X\n- Next steps: book it\n")).toBe("book it");
    expect(bodyNextStep("# X\n\n## Next step\n\n1. [x] sign the NDA\n")).toBe("sign the NDA");
    expect(bodyNextStep("# X\n<!-- Next step: hidden -->\n```\nNext step: code\n```\n")).toBe("");
    expect(bodyNextStep("# X\nNext steps need an API key.\n")).toBe("");
    expect(cleanStep("{{what happens next}}")).toBe("");
    expect(cleanStep("x".repeat(250))).toHaveLength(200);
  });
  it("the map entry's next_step comes first", async () => {
    const { repo } = fixtureRepo();
    const d = await pulseData(repo, FX.today, FX.tz, { all: true });
    expect(d.projects.find(p => p.name === "Gamma Research")).toMatchObject({ next_step: "draft the summary", next_step_source: "harold/projects.md" });
    expect(d.projects.find(p => p.name === "Pilot Program")).toMatchObject({ next_step_source: "vault/projects/pilot.md (frontmatter)" });
    expect(d.projects.find(p => p.name === "Beta Launch")).toMatchObject({ next_step: "Book the venue", next_step_source: "projects/beta/README.md" });
  });
});

describe("heartbeats", () => {
  const hb = (date: string, done = "Finished the thing") => JSON.stringify({ date, time: "10:00", project: "Pilot Program", done, source: "connector" }) + "\n";
  it("a project with a heartbeat is judged by it alone: a recent unrelated note does not make it active", async () => {
    const base = fixtureRepo();
    const before = await pulseData(base.repo, FX.today, FX.tz);
    const pilot = before.projects.find(p => p.name === "Pilot Program")!;
    expect(pilot.quiet).toBe(true);
    const old = fixtureRepo({ files: { "projects/pilot/heartbeats.jsonl": hb("2026-07-01") } });
    const d = await pulseData(old.repo, FX.today, FX.tz);
    const p = d.projects.find(x => x.name === "Pilot Program")!;
    expect(p.last).toMatchObject({ kind: "heartbeat", date: "2026-07-01", label: "heartbeat" });
    expect(p.quiet).toBe(true);
    expect(pulseText(d, true)).toContain('- Pilot Program — last activity 98 days ago (heartbeat 2026-07-01, "Finished the thing")');
  });
  it("a fresh heartbeat makes a quiet project active; the newest line wins; future dates are ignored", async () => {
    const { repo } = fixtureRepo({ files: { "projects/pilot/heartbeats.jsonl": hb("2026-09-01") + hb(FX.today, "Latest") + hb("2999-01-01", "Future") + "not json\n" } });
    const d = await pulseData(repo, FX.today, FX.tz);
    const p = d.projects.find(x => x.name === "Pilot Program")!;
    expect(p).toMatchObject({ quiet: false, days: 0 });
    expect(p.last?.title).toBe("Latest");
  });
  it("without heartbeats nothing changes", async () => {
    const { repo } = fixtureRepo();
    expect(pulseText(await pulseData(repo, FX.today, FX.tz))).toBe(FX.expected.text);
  });
});

describe("forward-looking work: open tasks and meeting notes dated ahead", () => {
  const snapshot = (...rows: [string, string, string][]) => "# Tasks snapshot\n\n## Open\n\n" + rows.map(([t, p, d], i) => `- **H-${40 + i}** · ${t} · ${p} · due ${d} · medium\n`).join("");
  const delta = async (files: Record<string, string | null>) => (await pulseData(fixtureRepo({ files }).repo, FX.today, FX.tz, { all: true })).projects.find(p => p.name === "Delta")!;
  it("an open task due in 7 days makes a quiet project active", async () => {
    const d = await delta({ "harold/tasks-snapshot.md": snapshot(["Plan the retro", "delta", "2026-10-14"]) });
    expect(d).toMatchObject({ status: "active", days: -7 });
    expect(d.last).toMatchObject({ label: "task due", title: "Plan the retro" });
    const { repo } = fixtureRepo({ files: { "harold/tasks-snapshot.md": snapshot(["Plan the retro", "delta", "2026-10-14"]) } });
    expect(pulseText(await pulseData(repo, FX.today, FX.tz))).toContain('- Delta — upcoming: task due in 7 days (2026-10-14, "Plan the retro")');
  });
  it("an overdue open task inside the window counts, outside it does not", async () => {
    expect(await delta({ "harold/tasks-snapshot.md": snapshot(["Late thing", "Delta", "2026-10-01"]) })).toMatchObject({ status: "active", days: 6 });
    expect((await delta({ "harold/tasks-snapshot.md": snapshot(["Very late", "Delta", "2026-09-01"]) })).status).toBe("quiet");
  });
  it("a task due in 30 days, or for another project, does not make it active", async () => {
    const d = await delta({ "harold/tasks-snapshot.md": snapshot(["Plan the retro", "Delta", "2026-11-06"], ["Elsewhere", "Delta Force", "2026-10-09"]) });
    expect(d).toMatchObject({ status: "quiet", last: null });
  });
  it("a meeting note dated ahead counts inside the window only", () => {
    const j = JSON.parse(FX.graph_json);
    j.nodes.push(["vault/projects/delta.md", "Delta", "project", "2026-10-01"], ["vault/meetings/2026-10-12-delta-planning.md", "Delta planning", "meeting", "2026-10-12"], ["vault/meetings/2026-11-12-delta-later.md", "Delta later", "meeting", "2026-11-12"]);
    j.edges.push(["vault/meetings/2026-10-12-delta-planning.md", "vault/projects/delta.md", "wikilink"], ["vault/meetings/2026-11-12-delta-later.md", "vault/projects/delta.md", "wikilink"]);
    const g2 = parseGraph(JSON.stringify(j), FX.today);
    const last = activity(parseProjects(FX.files["harold/projects.md"]).find(p => p.name === "Delta")!, g2, "vault/projects/delta.md", "projects/delta", FX.today, null);
    expect(last).toMatchObject({ label: "upcoming meeting", date: "2026-10-12" });
  });
  it("a task line without a priority still counts", async () => {
    const d = await delta({ "harold/tasks-snapshot.md": "# Tasks snapshot\n\n- **H-1** · Plan the retro · Delta · due 2026-10-10\n" });
    expect(d).toMatchObject({ status: "active", days: -3 });
  });
  it("past activity inside the window beats a future item", async () => {
    const b = (await pulseData(fixtureRepo({ files: { "harold/tasks-snapshot.md": snapshot(["Soon", "Beta Launch", "2026-10-09"]) } }).repo, FX.today, FX.tz)).projects.find(p => p.name === "Beta Launch")!;
    expect(b).toMatchObject({ days: 4 });
    expect(b.last?.kind).toBe("commit");
  });
});

describe("settings and failures", () => {
  it("HAROLD_PULSE_DAYS on the connector, else graph.json's pulse_days, else 14", async () => {
    expect(pulseDays(parseGraph(FX.graph_json, FX.today))).toBe(14);
    expect(pulseDays(parseGraph(FX.graph_json.replace('"pulse_days":14', '"pulse_days":30'), FX.today))).toBe(30);
    expect(pulseDays()).toBe(14);
    process.env.HAROLD_PULSE_DAYS = "40";
    const { repo } = fixtureRepo();
    const d = await pulseData(repo, FX.today, FX.tz);
    expect(d.pulse_days).toBe(40);
    expect(d.quiet).toBe(1);   // Old Thing (nothing dated); Delta's task due in 30 days and Pilot's meeting 19 days ago are inside 40
    expect(d.projects.filter(p => p.quiet).map(p => p.name)).toEqual(["Old Thing"]);
  });
  it("without graph.json it says how to produce it", async () => {
    const { repo } = fixtureRepo({ files: { "harold/graph.json": null } });
    const r = await pulseTool(repo, FX.today, FX.tz);
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/harold\/graph.json is not in .*bin\/harold close/);
  });
  it("a commit history it cannot read is said, not hidden", async () => {
    const { gh } = fixtureRepo();
    const orig = gh.fetch;
    const failing = new HaroldRepo("tok", "owner/harold", "main", async (u, init) => (String(u).includes("/commits") ? new Response('{"message":"boom"}', { status: 500 }) : orig(u, init)));
    const t = pulseText(await pulseData(failing, FX.today, FX.tz));
    expect(t).toMatch(/Git history not used here \(GitHub commits API: list commits for projects\/.*: GitHub 500 boom\): commits were not counted\./);
    expect(t).toContain("Quiet (not nagged; work there makes them active again): Beta Launch, Delta, Old Thing, Pilot Program");   // its commit could not be read
  });
  it("helpers: folders and dates", () => {
    expect(normFolder(" `projects/x/` ")).toBe("projects/x");
    expect(normFolder("../etc")).toBe("");
    expect(normFolder(".")).toBe("");
    expect(dateIn("2026-10-03T02:00:00Z", "America/Chicago")).toBe("2026-10-02");
    expect(dateIn("2026-10-03T02:00:00Z", "UTC")).toBe("2026-10-03");
  });
});

describe("harold_today", () => {
  it("gives the project counts, never the quiet projects, or says the pulse is unavailable", async () => {
    const { repo } = fixtureRepo();
    const t = (await kb.today(repo, new Date("2026-10-07T16:00:00Z"))).text;
    expect(t).toContain("## Projects\n3 active, 3 quiet; active means activity within 14 days");
    expect(t).not.toMatch(/Delta|no next step recorded/);
    const bare = fixtureRepo({ files: { "harold/graph.json": null } }).repo;
    expect((await kb.today(bare, new Date("2026-10-07T16:00:00Z"))).text).toMatch(/## Projects\nProject pulse unavailable: harold\/graph.json is not in/);
  });
});

describe("derived status: activity within HAROLD_PULSE_DAYS, back or ahead", () => {
  const derive = async (files: Record<string, string | null>) => {
    const d = await pulseData(fixtureRepo({ files }).repo, FX.today, FX.tz, { all: true });
    return { d, by: Object.fromEntries(d.projects.map(p => [p.name, p])) };
  };
  it("archived and autonomous are never judged", async () => {
    const { by } = await derive({});
    for (const [n, st] of [["Foxtrot", "archived"], ["Sentinel", "autonomous"]]) expect(by[n]).toMatchObject({ status: st, quiet: null, days: null, last: null });
    const d = await pulseData(fixtureRepo().repo, FX.today, FX.tz);
    expect(d.projects.map(p => p.name)).not.toContain("Foxtrot");
    expect(pulseText(d)).not.toContain("Sentinel");
  });
  it("a legacy status: active or paused is ignored", async () => {
    const pm = FX.files["harold/projects.md"];
    const bare = (await derive({ "harold/projects.md": pm.replace(/- status: (active|paused)\n/g, "") })).d.projects.map(p => [p.name, p.status]);
    const flipped = (await derive({ "harold/projects.md": pm.replace("## Delta\n", "## Delta\n- status: active\n").replace("- status: active\n- aliases: the pilot", "- status: paused\n- aliases: the pilot") })).d.projects.map(p => [p.name, p.status]);
    expect(flipped).toEqual(bare);
    expect(bare).toContainEqual(["Delta", "quiet"]);
  });
  it("a quiet project's next step is neither shown nor demanded", async () => {
    const t = pulseText(await pulseData(fixtureRepo().repo, FX.today, FX.tz));
    expect(t).not.toContain("waiting on a reply from Jane");   // Pilot Program is quiet
    expect(t.split("Quiet (")[0]).not.toMatch(/Old Thing|Delta/);
  });
  it("setStatus reads the first word", () => {
    expect(setStatus({ name: "x", status: "Autonomous (side project; never surfaced)", aliasList: [], keywordList: [], aliasesTodo: false })).toBe("autonomous");
  });
  it("harold_where shows a status only when it is archived or autonomous", async () => {
    const { parseProjects: pp } = await import("../../src/projects.js");
    const ps = pp(FX.files["harold/projects.md"]);
    expect(formatWhere(ps, "foxtrot").text.split("\n")[0]).toBe("Foxtrot [archived]");
    expect(formatWhere(ps, "echo").text.split("\n")[0]).toBe("Echo");
  });
});
