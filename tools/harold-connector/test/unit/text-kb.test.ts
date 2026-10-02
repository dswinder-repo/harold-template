import { beforeEach, describe, expect, it } from "vitest";
import { appendUnderHeading, frontmatter, localParts, secretScan, slugify, updateFrontmatter } from "../../src/text.js";
import { tzInfo } from "../../src/config.js";
import { HaroldRepo } from "../../src/github.js";
import * as kb from "../../src/kb.js";
import { FakeGithub } from "./fakes.js";
import { OWNER, REPO, setTestEnv } from "./env.js";

beforeEach(() => setTestEnv());

function repoWith(files: Record<string, string>) {
  const gh = new FakeGithub();
  gh.users.set("tok", OWNER);
  for (const [p, t] of Object.entries(files)) gh.files.set(p, t);
  return { gh, repo: new HaroldRepo("tok", REPO, "test-branch", gh.fetch) };
}
const NOON = new Date("2026-09-30T16:05:00Z"); // 16:05 UTC (the default zone); 12:05 in New York (EDT)

describe("secret scan", () => {
  const samples = {
    github: "token ghp_" + "a".repeat(36),
    githubOauth: "gho_" + "B".repeat(36),
    anthropic: "sk-ant-" + "x".repeat(30),
    supabase: "sb_secret_" + "y".repeat(20),
    jwt: ["eyJhbGciOi" + "J".repeat(25), "e".repeat(20), "s".repeat(16)].join("."),  // synthetic, built at runtime
    aws: "AKIA" + "ABCDEFGHIJKLMNOP",
    pem: "-----BEGIN OPENSSH PRIVATE KEY-----",
    slack: "xoxb-" + "1".repeat(24),
    linear: "lin_api_" + "z".repeat(24),
    password: "The wifi password is Hunter22",
    passwd: "passwd: s3cr3tvalue",
    pwd: "pwd=abcd1234",
  };
  for (const [k, v] of Object.entries(samples)) it(`flags ${k}`, () => expect(secretScan(v)).not.toBeNull());
  it("does not flag ordinary notes", () => {
    expect(secretScan("Met Jane Doe; she will reset her password next week. Warmth: Warm.")).toBeNull();
    expect(secretScan("Discussed the password policy for the Acme portal")).toBeNull();
  });

  it("refuses to commit content with a secret and makes no write", async () => {
    const { gh, repo } = repoWith({});
    const r = await kb.capture(repo, "the deploy password: ExamplePass2026", undefined, NOON);
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/secret/);
    expect(gh.puts.length).toBe(0);
    const n = await kb.note(repo, "intel", "Keys", "Here is the key ghp_" + "q".repeat(36), NOON);
    expect(n.isError).toBe(true);
    expect(gh.puts.length).toBe(0);
  });
});

describe("frontmatter and markdown edits", () => {
  const card = "---\ntags: [person, example]\ntype: partner\nwarmth: Lukewarm\nlast_updated: 2026-02-26\n---\n# Jane Doe\n\n## Timeline\n- **Feb 25:** Call.\n\n## Related\n- x\n";
  it("updates scalar keys in place and adds new ones", () => {
    const r = updateFrontmatter(card, { warmth: "Warm", last_updated: "2026-09-30", status: "active" });
    expect(r.error).toBeUndefined();
    const fm = frontmatter(r.text);
    expect(fm).toMatchObject({ warmth: "Warm", last_updated: "2026-09-30", status: "active", type: "partner", tags: "[person, example]" });
    expect(r.text.endsWith("## Related\n- x\n")).toBe(true);
  });
  it("refuses list values, multi-line values and odd keys", () => {
    expect(updateFrontmatter(card, { tags: "person" }).error).toBeTruthy();
    expect(updateFrontmatter(card, { warmth: "Warm\nx: y" }).error).toBeTruthy();
    expect(updateFrontmatter(card, { "bad key": "v" }).error).toBeTruthy();
  });
  it("quotes values that YAML would misread", () => {
    const r = updateFrontmatter(card, { notes: "role: CFO" });
    expect(r.text).toContain('notes: "role: CFO"');
  });
  it("appends under a heading, at the end of that section", () => {
    const out = appendUnderHeading(card, "- **Sep 30:** Follow-up.", "Timeline");
    expect(out).toContain("- **Feb 25:** Call.\n- **Sep 30:** Follow-up.\n\n## Related");
  });
  it("creates a missing heading at the end, or appends at the end with no heading", () => {
    expect(appendUnderHeading(card, "text", "Notes")).toMatch(/## Related\n- x\n\n## Notes\n\ntext\n$/);
    expect(appendUnderHeading(card, "tail")).toMatch(/- x\n\ntail\n$/);
  });
  it("slugs", () => {
    expect(slugify("Ácme: Term-Sheet Review (v2)!")).toBe("acme-term-sheet-review-v2");
  });
});

describe("time zone (HAROLD_TZ)", () => {
  const LATE = new Date("2026-10-01T02:30:00Z");
  it("defaults to UTC when HAROLD_TZ is not set", () => {
    expect(tzInfo()).toMatchObject({ tz: "UTC", source: "default" });
    expect(localParts(LATE)).toEqual({ iso: "2026-10-01", weekday: "Thursday", hm: "02:30" });
  });
  it("uses an explicit IANA zone", () => {
    setTestEnv({ HAROLD_TZ: "America/New_York" });
    expect(tzInfo()).toEqual({ tz: "America/New_York", source: "HAROLD_TZ" });
    expect(localParts(LATE)).toEqual({ iso: "2026-09-30", weekday: "Wednesday", hm: "22:30" }); // 22:30 EDT the previous day
    setTestEnv({ HAROLD_TZ: "Asia/Tokyo" });
    expect(localParts(LATE).iso).toBe("2026-10-01");
  });
  it("falls back to UTC on an invalid zone, with a warning", () => {
    setTestEnv({ HAROLD_TZ: "Mars/Olympus_Mons" });
    const z = tzInfo();
    expect(z.tz).toBe("UTC");
    expect(z.warning).toMatch(/not an IANA time zone name/);
    expect(localParts(LATE).iso).toBe("2026-10-01");
  });
  it("harold_today shows the zone, and a note when HAROLD_TZ is unset or invalid", async () => {
    const { repo } = repoWith({ "harold/alerts.md": "## Current Alerts\n- a\n" });
    expect((await kb.today(repo, LATE)).text).toMatch(/^# Harold — Thursday, 2026-10-01 \(02:30 UTC\)\n[^\n]*\nNote: HAROLD_TZ is not set/);
    setTestEnv({ HAROLD_TZ: "America/New_York" });
    const t = (await kb.today(repo, LATE)).text;
    expect(t).toMatch(/^# Harold — Wednesday, 2026-09-30 \(22:30 America\/New_York\)/);
    expect(t).not.toMatch(/Note: HAROLD_TZ/);
  });
  it("capture files under the local date of HAROLD_TZ", async () => {
    setTestEnv({ HAROLD_TZ: "America/New_York" });
    const { gh, repo } = repoWith({});
    await kb.capture(repo, "late note", undefined, LATE);
    expect(gh.files.has("vault/daily/2026-09-30-chat.md")).toBe(true);
  });
});

describe("knowledge-base writes (fake GitHub)", () => {
  it("capture creates today's chat log with frontmatter, then appends", async () => {
    const { gh, repo } = repoWith({});
    await kb.capture(repo, "Acme wants the model by Friday", "acme", NOON);
    await kb.capture(repo, "Second thing\nwith two lines", undefined, NOON);
    const t = gh.files.get("vault/daily/2026-09-30-chat.md")!;
    expect(frontmatter(t)).toEqual({ date: "2026-09-30", session: "chat" });
    expect(t).toContain("- **16:05** [acme] Acme wants the model by Friday\n- **16:05** Second thing\n  with two lines\n");
    expect(gh.puts.map(p => p.message)).toEqual(["chore(connector): capture to 2026-09-30 chat log", "chore(connector): capture to 2026-09-30 chat log"]);
    expect(gh.puts[0].author).toEqual({ name: "Harold (connector)", email: "harold-connector@users.noreply.github.com" });
    expect(gh.puts[0].branch).toBe("test-branch");
  });

  it("commits as a neutral author unless HAROLD_COMMIT_EMAIL says otherwise", async () => {
    setTestEnv({ HAROLD_COMMIT_EMAIL: "owner@example.com" });
    const { gh, repo } = repoWith({});
    await kb.capture(repo, "one", undefined, NOON);
    expect(gh.puts[0].author).toEqual({ name: "Harold (connector)", email: "owner@example.com" });
    setTestEnv({ HAROLD_COMMIT_EMAIL: "not an email" });
    await expect(kb.capture(repo, "two", undefined, NOON)).rejects.toThrow(/HAROLD_COMMIT_EMAIL/);
    expect(gh.puts.length).toBe(1);
  });

  it("note picks the folder and filename per kind and refuses to overwrite", async () => {
    const { gh, repo } = repoWith({});
    for (const [kind, title, expected] of [
      ["intel", "Example Port Volumes", "vault/intel/example-port-volumes.md"],
      ["decision", "Pause the raise", "vault/decisions/2026-09-30-pause-the-raise.md"],
      ["meeting", "Call with Jane Doe", "vault/meetings/2026-09-30-call-with-jane-doe.md"],
      ["company", "Acme Holdings Ltd", "vault/companies/Acme Holdings Ltd.md"],
      ["project", "Harold Connector", "vault/projects/harold-connector.md"],
    ] as const) {
      const r = await kb.note(repo, kind, title, "Body text.", NOON);
      expect(r.isError, r.text).toBeFalsy();
      const t = gh.files.get(expected)!;
      expect(frontmatter(t)).toMatchObject({ date: "2026-09-30", last_updated: "2026-09-30" });
      expect(t).toContain(`# ${title}\n\nBody text.`);
    }
    const again = await kb.note(repo, "intel", "Example Port Volumes", "Other", NOON);
    expect(again.isError).toBe(true);
    expect(again.text).toMatch(/harold_update/);
  });

  it("update edits only allowed markdown files and freshens last_updated", async () => {
    const { gh, repo } = repoWith({ "vault/people/Jane Doe.md": "---\nwarmth: Lukewarm\nlast_updated: 2026-02-26\n---\n# Jane\n\n## Timeline\n- old\n", "harold/learnings.jsonl": "", "AGENTS.md": "x" });
    const r = await kb.update(repo, "vault/people/Jane Doe.md", { append_text: "- **Sep 30:** new", heading: "Timeline", frontmatter_updates: { warmth: "Warm" } }, NOON);
    expect(r.isError, r.text).toBeFalsy();
    const t = gh.files.get("vault/people/Jane Doe.md")!;
    expect(frontmatter(t)).toMatchObject({ warmth: "Warm", last_updated: "2026-09-30" });
    expect(t).toContain("- old\n- **Sep 30:** new\n");
    for (const p of ["harold/learnings.jsonl", "AGENTS.md", "bin/harold", "tools/x/README.md", ".github/workflows/a.md", "memory/CLAUDE.md", "vault/../AGENTS.md", "vault/people/Nobody.md"]) {
      const bad = await kb.update(repo, p, { append_text: "x" }, NOON);
      expect(bad.isError, p).toBe(true);
    }
    expect(gh.puts.length).toBe(1);
  });

  it("learning takes the next free id and re-computes it after a conflicting write", async () => {
    const { gh, repo } = repoWith({ "harold/learnings.jsonl": '{"id":"L131"}\n{"id":"L133"}\n' });
    gh.conflictsToInject = 1;
    gh.concurrentWrite = (_p, cur) => (cur || "") + '{"id":"L134","lesson":"written by another session"}\n';
    const r = await kb.learning(repo, { lesson: "Check the thing before saying it works.", severity: "critical", category: "process" }, NOON);
    expect(r.isError, r.text).toBeFalsy();
    const lines = gh.files.get("harold/learnings.jsonl")!.trim().split("\n").map(l => JSON.parse(l));
    expect(lines.map(l => l.id)).toEqual(["L131", "L133", "L134", "L135"]);
    expect(lines[3]).toMatchObject({ severity: "critical", category: "process", project: "global", source: "connector", date: "2026-09-30" });
    expect(r.text).toMatch(/after 1 retry/);
  });

  it("gives up after 3 retries of conflicts", async () => {
    const { gh, repo } = repoWith({ "harold/learnings.jsonl": "" });
    gh.conflictsToInject = 4;
    await expect(kb.learning(repo, { lesson: "A lesson that keeps colliding.", severity: "info", category: "process" }, NOON)).rejects.toThrow(/409/);
    expect(gh.puts.length).toBe(0);
  });

  it("where, today and person against fake files", async () => {
    const { repo } = repoWith({
      "harold/projects.md": "# Map\n\n## Seed Fundraise\n- folder: projects/seed-fundraise\n- status: paused\n- aliases: the raise, fundraise\n- keywords: investor\n",
      "harold/alerts.md": "# Alerts\n\n## Current Alerts: September 30, 2026\n- one\n\n## History\n- old\n",
      "harold/briefs/2026-09-30.md": "---\ngenerated: x\n---\n# Brief\nWeather.",
      "vault/daily/2026-09-29-a.md": "---\ndate: 2026-09-29\n---\n# Twenty-ninth\n",
      "vault/daily/2026-09-30-b.md": "# Thirtieth\n",
      "vault/people/Jane Doe.md": "---\ntype: partner\n---\n# Jane Doe\n",
      "vault/people/Janet Doering.md": "# Janet\n",
    });
    expect((await kb.where(repo, "the raise")).text).toMatch(/^Seed Fundraise \[paused\]\nfolder: projects\/seed-fundraise/);
    const t = await kb.today(repo, NOON);
    expect(t.text).toContain("Wednesday, 2026-09-30");
    expect(t.text).toContain("# Brief\nWeather.");
    expect(t.text).toContain("## Current Alerts: September 30, 2026\n- one");
    expect(t.text).not.toContain("- old");
    expect(t.text).toContain("- vault/daily/2026-09-30-b.md — # Thirtieth\n- vault/daily/2026-09-29-a.md — # Twenty-ninth");
    const cards = await kb.findPersonCards(repo, "jane doe");
    expect(cards[0].path).toBe("vault/people/Jane Doe.md");
    expect((await kb.personCard(repo, "Doe"))?.path).toBe("vault/people/Jane Doe.md");
  });
});
