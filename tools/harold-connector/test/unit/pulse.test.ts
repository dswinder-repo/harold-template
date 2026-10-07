// harold_pulse and the quiet projects in harold_today. pulse-fixture.json is shared with the workspace's
// tests/test_harold_index.py: the same files and commits must give bin/harold pulse and harold_pulse the same text.
// Fictional data only.

import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { HaroldRepo } from "../../src/github.js";
import * as kb from "../../src/kb.js";
import { parseGraph } from "../../src/graph.js";
import { parseProjects } from "../../src/projects.js";
import { activity, bodyNextStep, cleanStep, dateIn, findCard, fmNextStep, normFolder, pulseData, pulseDays, pulseText, pulseTodaySection, pulseTool } from "../../src/pulse.js";
import { FakeGithub } from "./fakes.js";
import { OWNER, setTestEnv } from "./env.js";

interface Fixture {
  today: string; tz: string; initial_commit: string; files: Record<string, string>;
  commits: { date: string; message: string; files: Record<string, string> }[];
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
    gh.commitLog.push({ date: FX.initial_commit, message: "init", paths: Object.keys(FX.files) });
    for (const c of FX.commits) gh.commitLog.push({ date: c.date, message: c.message, paths: Object.keys(c.files) });
  }
  return { gh, repo: new HaroldRepo("tok", "owner/harold", "main", gh.fetch) };
}

describe("the same answer as bin/harold pulse (shared fixture)", () => {
  it("default text: quiet projects first with their next step, the rest briefly", async () => {
    const { repo } = fixtureRepo();
    expect(pulseText(await pulseData(repo, FX.today, FX.tz))).toBe(FX.expected.text);
  });
  it("all: every next step, and the projects that are not active", async () => {
    const { repo } = fixtureRepo();
    expect(pulseText(await pulseData(repo, FX.today, FX.tz, { all: true }), true)).toBe(FX.expected.text_all);
  });
  it("the quiet lines in harold_today are the boot lines", async () => {
    const { repo } = fixtureRepo();
    const section = pulseTodaySection(await pulseData(repo, FX.today, FX.tz));
    const bootLines = FX.expected.boot.split("\n").slice(1);
    expect(section.split("\n").slice(1)).toEqual(bootLines);
    expect(section.split("\n")[0]).toBe("3 of 5 active projects quiet, no activity in more than 14 days (harold_pulse for all). List them under WATCH, with their next step:");
  });
  it("matches the example line from the design", () => {
    expect(FX.expected.text).toContain("- Pilot Program — quiet 19 days (last: meeting note 2026-09-18, \"Acme kickoff\"); next step: waiting on a reply from Jane");
  });
});

describe("activity", () => {
  const g = parseGraph(FX.graph_json, FX.today);
  const projects = parseProjects(FX.files["harold/projects.md"]);
  const P = (name: string) => projects.find(p => p.name === name)!;

  it("ignores dates after today (a planned meeting is not activity)", () => {
    const last = activity(P("Pilot Program"), g, "vault/projects/pilot.md", "projects/pilot", FX.today, null);
    expect(last?.path).toBe("vault/meetings/2026-09-18-acme-kickoff.md");
    expect(last?.via).toBe("link");
  });
  it("a daily note that names the project counts (mentions in graph.json)", () => {
    const card = findCard(P("Gamma Research"), g);
    expect(card).toBe("vault/projects/gamma-research.md");   // found by title: no card: field
    const last = activity(P("Gamma Research"), g, card, "projects/gamma", FX.today, null);
    expect(last).toMatchObject({ kind: "note", date: "2026-10-06", label: "daily note", via: "mention" });
  });
  it("a commit newer than every note wins; an older or future one does not", () => {
    const p = P("Beta Launch");
    expect(activity(p, g, "vault/projects/beta.md", "projects/beta", FX.today, { date: "2026-10-03", subject: "x" })?.kind).toBe("commit");
    expect(activity(p, g, "vault/projects/beta.md", "projects/beta", FX.today, { date: "2026-07-01", subject: "x" })?.label).toBe("project card");
    expect(activity(p, g, "vault/projects/beta.md", "projects/beta", FX.today, { date: "2026-10-09", subject: "x" })?.label).toBe("project card");
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

describe("settings and failures", () => {
  it("HAROLD_PULSE_DAYS on the connector, else graph.json's pulse_days, else 14", async () => {
    expect(pulseDays(parseGraph(FX.graph_json, FX.today))).toBe(14);
    expect(pulseDays(parseGraph(FX.graph_json.replace('"pulse_days":14', '"pulse_days":30'), FX.today))).toBe(30);
    expect(pulseDays()).toBe(14);
    process.env.HAROLD_PULSE_DAYS = "40";
    const { repo } = fixtureRepo();
    const d = await pulseData(repo, FX.today, FX.tz);
    expect(d.pulse_days).toBe(40);
    expect(d.quiet).toBe(1);   // only Delta (nothing dated); Echo at 36 days and Pilot at 19 are within 40
    expect(d.projects.filter(p => p.quiet).map(p => p.name)).toEqual(["Delta"]);
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
    expect(t).toContain("- Beta Launch — quiet 67 days (last: project card 2026-08-01); next step: Book the venue");   // its commit could not be read
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
  it("lists the quiet projects, or says the pulse is unavailable", async () => {
    const { repo } = fixtureRepo();
    const t = (await kb.today(repo, new Date("2026-10-07T16:00:00Z"))).text;
    expect(t).toContain("## Quiet projects\n3 of 5 active projects quiet, no activity in more than 14 days");
    expect(t).toContain("- Delta — quiet, no dated activity found; next step: no next step recorded");
    const bare = fixtureRepo({ files: { "harold/graph.json": null } }).repo;
    expect((await kb.today(bare, new Date("2026-10-07T16:00:00Z"))).text).toMatch(/## Quiet projects\nProject pulse unavailable: harold\/graph.json is not in/);
  });
});
