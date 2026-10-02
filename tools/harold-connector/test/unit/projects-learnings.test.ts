import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { formatWhere, parseProjects, rankProjects } from "../../src/projects.js";
import { appendLearning, nextLearningId } from "../../src/learnings.js";

// The connector lives at <workspace>/tools/harold-connector; the workspace's own files are read in place
// (read-only) and `bin/harold where` is run against them, so the connector and the CLI must agree.
const HAROLD = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const PROJECTS = path.join(HAROLD, "harold/projects.md");
const LEARNINGS = path.join(HAROLD, "harold/learnings.jsonl");
const HAVE = existsSync(PROJECTS) && existsSync(path.join(HAROLD, "bin/harold"));

describe.skipIf(!HAVE)("projects.md parsing and where scoring (this workspace's harold/projects.md)", () => {
  const text = HAVE ? readFileSync(PROJECTS, "utf8") : "";
  const projects = parseProjects(text);

  it("parses every ## entry with its fields", () => {
    const headings = text.split("\n").filter(l => /^##\s+/.test(l)).length;
    expect(projects.length).toBe(headings);
    expect(projects.length).toBeGreaterThan(0);
    for (const p of projects) expect(p.name.length).toBeGreaterThan(0);
  });

  // The project names, their aliases and keywords, and a miss, through the real CLI: same pick, same alternatives.
  const topics = HAVE ? [...new Set([
    ...projects.flatMap(p => [p.name, ...p.aliasList.slice(0, 2), ...p.keywordList.slice(0, 1)]),
    "zzqx-nothing",
  ])].slice(0, 15) : [];
  for (const topic of topics) {
    it(`matches \`bin/harold where ${topic}\``, () => {
      let cli = "";
      try {
        cli = execFileSync(path.join(HAROLD, "bin/harold"), ["where", topic], {
          cwd: HAROLD, encoding: "utf8", env: { ...process.env, HAROLD_ROOT: HAROLD, HAROLD_ENV_FILE: path.join(HAROLD, ".no-such-env-file") },
        });
      } catch (e) { cli = String((e as { stdout?: string }).stdout || ""); }
      const ours = formatWhere(projects, topic).text;
      const firstLine = (s: string) => s.split("\n")[0].trim();
      const also = (s: string) => (s.split("\n").find(l => l.startsWith("also:")) || "").trim();
      expect(firstLine(ours)).toBe(firstLine(cli));
      expect(also(ours)).toBe(also(cli));
    });
  }

  it("scores like cmdWhere (an exact alias scores at least 100)", () => {
    const withAlias = projects.find(p => p.aliasList.length);
    if (!withAlias) return;
    const r = rankProjects(projects, withAlias.aliasList[0]);
    expect(r[0].s).toBeGreaterThanOrEqual(100);
  });
});

describe("learnings next-ID computation", () => {
  it("is max numeric id + 1, zero-padded, ignoring bad lines and gaps", () => {
    const t = [
      '{"id":"L001","lesson":"a"}', "", '{"id":"L010","lesson":"b"}', "not json", '{"id":"L007","lesson":"c"}', '{"lesson":"no id"}',
    ].join("\n");
    expect(nextLearningId(t)).toBe("L011");
    expect(nextLearningId("")).toBe("L001");
    expect(nextLearningId('{"id":"L999"}\n')).toBe("L1000");
  });

  it("appends a well-formed entry with source connector and fixes a missing final newline", () => {
    const { text, entry } = appendLearning('{"id":"L004"}', { lesson: " Do the thing. ", severity: "warning", category: "process" }, "2026-09-30");
    expect(entry).toEqual({ id: "L005", date: "2026-09-30", severity: "warning", project: "global", category: "process", lesson: "Do the thing.", source: "connector" });
    expect(text).toBe('{"id":"L004"}\n' + JSON.stringify(entry) + "\n");
  });

  it.skipIf(!existsSync(LEARNINGS))("agrees with the real harold/learnings.jsonl", () => {
    const t = readFileSync(LEARNINGS, "utf8");
    const ids = t.split("\n").filter(Boolean).map(l => { try { return JSON.parse(l).id as string; } catch { return ""; } }).filter(Boolean);
    const max = Math.max(...ids.map(i => Number(i.replace(/\D/g, ""))));
    expect(nextLearningId(t)).toBe(`L${String(max + 1).padStart(3, "0")}`);
  });
});
