import { beforeEach, describe, expect, it } from "vitest";
import { HaroldRepo } from "../../src/github.js";
import * as kb from "../../src/kb.js";
import { criticalLessons, housekeepingNew, LESSONS_BUDGET, morningStep0 } from "../../src/morning.js";
import { FakeGithub } from "./fakes.js";
import { OWNER, setTestEnv } from "./env.js";

beforeEach(() => setTestEnv());

const NOON = new Date("2026-10-07T16:05:00Z"); // a Wednesday, midday in the Americas and Europe
const L = (id: string, severity: string, lesson: string, extra: Record<string, string> = {}) => JSON.stringify({ id, date: "2026-10-01", severity, project: "global", category: "process", lesson, ...extra });
const LEARNINGS = [L("L001", "critical", "Get the date from the system."), L("L002", "warning", "A warning, not shown."), "not json",
  L("L003", "critical", "Never invent a meeting.", { project: "acme", category: "facts" }), L("L004", "info", "A preference.")].join("\n") + "\n";
const HK = "# Housekeeping notes\n\n*How this file works.*\n\n## New\n\n- 2026-10-06 weekly scan: two cards disagree on a title.\n\n## Shown\n\n- 2026-09-30 month-end review: an old note.\n";

function repoWith(files: Record<string, string>) {
  const gh = new FakeGithub();
  gh.users.set("tok", OWNER);
  for (const [p, t] of Object.entries(files)) gh.files.set(p, t);
  return new HaroldRepo("tok", "owner/harold", "main", gh.fetch);
}

describe("critical lessons", () => {
  it("lists only severity critical, one line each, with category and project", () => {
    const t = criticalLessons(LEARNINGS);
    expect(t).toBe("2 critical lessons; they are binding:\n- L001 (process): Get the date from the system.\n- L003 (facts, acme): Never invent a meeting.");
    expect(criticalLessons(L("L9", "warning", "w"))).toBe("No critical lessons in harold/learnings.jsonl.");
  });
  it("stays inside its budget and says how many it left out", () => {
    const many = Array.from({ length: 200 }, (_, i) => L(`L${i}`, "critical", "x".repeat(900))).join("\n");
    const t = criticalLessons(many);
    expect(t.length).toBeLessThan(LESSONS_BUDGET + 400);
    expect(t).toMatch(/… \d+ more not shown here; read them with harold_read\("harold\/learnings.jsonl"\)/);
    expect(t).toContain(`${"x".repeat(499)}…`);   // each lesson is capped
  });
});

describe("housekeeping notes", () => {
  it("returns the lines under ## New only, or nothing", () => {
    expect(housekeepingNew(HK)).toBe("- 2026-10-06 weekly scan: two cards disagree on a title.");
    expect(housekeepingNew("# H\n\n## New\n\n## Shown\n\n- old\n")).toBe("");
    expect(housekeepingNew("# no sections")).toBe("");
    expect(housekeepingNew("## New\n- last section, no Shown\n")).toBe("- last section, no Shown");
  });
});

describe("harold_today", () => {
  it("adds the critical lessons, the housekeeping notes and Step 0 with a draft", async () => {
    const repo = repoWith({
      "harold/briefs/2026-10-07.md": "---\nfired: 2026-10-07 06:30\ngenerated: 2026-10-07T10:33:00Z\n---\n# Morning Brief\nTop 3.",
      "harold/alerts.md": "## Current Alerts\n- one\n",
      "harold/learnings.jsonl": LEARNINGS,
      "harold/briefs/housekeeping-notes.md": HK,
      "vault/daily/2026-10-06-a.md": "# Sixth\n",
    });
    const t = (await kb.today(repo, NOON)).text;
    expect(t).toContain("## Critical lessons\n2 critical lessons; they are binding:\n- L001 (process): Get the date from the system.");
    expect(t).not.toContain("A warning, not shown.");
    expect(t).toContain('## Housekeeping notes\nFrom harold/briefs/housekeeping-notes.md (under "## New"):\n- 2026-10-06 weekly scan: two cards disagree on a title.');
    expect(t).not.toContain("an old note");
    expect(t).toContain("## Starting the day\n" + morningStep0(true));
    expect(t).toMatch(/Show the draft above as written/);
    expect(t).toMatch(/"You got anything\? What came in overnight\?" and stop/);
    expect(t).toMatch(/then continue to the day's priorities/);
    expect(t.indexOf("## Today's morning brief draft")).toBeLessThan(t.indexOf("## Critical lessons"));
  });

  it("without a draft, notes or lessons file it still answers, with the live instruction", async () => {
    const repo = repoWith({ "harold/alerts.md": "## Current Alerts\n- one\n", "vault/daily/2026-10-06-a.md": "# Sixth\n" });
    const t = (await kb.today(repo, NOON)).text;
    expect(t).toContain("## Critical lessons\nharold/learnings.jsonl could not be read.");
    expect(t).toContain("## Housekeeping notes\nNone waiting.");
    expect(t).toContain("## Starting the day\n" + morningStep0(false));
    expect(t).toMatch(/run the brief live as playbook\/core\/morning-brief.md describes/);
  });

  it("stays well under the result limit with a huge brief, alerts and lessons", async () => {
    const repo = repoWith({
      "harold/briefs/2026-10-07.md": "B".repeat(200_000),
      "harold/alerts.md": "## Current Alerts\n" + "A".repeat(200_000),
      "harold/learnings.jsonl": Array.from({ length: 500 }, (_, i) => L(`L${i}`, "critical", "y".repeat(600))).join("\n"),
      "harold/briefs/housekeeping-notes.md": "## New\n" + "- h\n".repeat(20_000),
    });
    const t = (await kb.today(repo, NOON)).text;
    expect(t.length).toBeLessThan(95_000);
    expect(t).toContain("## Starting the day");
  });
});
