// What harold_today adds to the brief, alerts and daily notes: the critical lessons (as bin/harold boot
// prints them), the housekeeping notes waiting under "## New", and the morning brief's Step 0
// (playbook/core/morning-brief.md) for a chat that starts the day. Each part has its own size budget.

import { parseJsonl } from "./learnings.js";

export const LESSONS_BUDGET = 14_000;
export const HOUSEKEEPING_BUDGET = 6_000;
const LESSON_MAX = 500;

/** Every severity "critical" entry of harold/learnings.jsonl, one line each, within the budget. */
export function criticalLessons(jsonl: string, budget = LESSONS_BUDGET): string {
  const rows = parseJsonl(jsonl).filter(r => String(r.severity || "").toLowerCase() === "critical");
  if (!rows.length) return "No critical lessons in harold/learnings.jsonl.";
  const lines: string[] = [];
  let used = 0, shown = 0;
  for (const r of rows) {
    let lesson = String(r.lesson || "").replace(/\s+/g, " ").trim();
    if (lesson.length > LESSON_MAX) lesson = `${lesson.slice(0, LESSON_MAX - 1)}…`;
    const tag = [r.category, r.project && r.project !== "global" ? r.project : ""].filter(Boolean).join(", ");
    const line = `- ${r.id || "L?"}${tag ? ` (${tag})` : ""}: ${lesson}`;
    if (used + line.length + 1 > budget) break;
    lines.push(line); used += line.length + 1; shown++;
  }
  const rest = rows.length - shown;
  return [`${rows.length} critical lesson${rows.length === 1 ? "" : "s"}; they are binding:`, ...lines,
    ...(rest > 0 ? [`… ${rest} more not shown here; read them with harold_read("harold/learnings.jsonl").`] : [])].join("\n");
}

/** The lines under "## New" in harold/briefs/housekeeping-notes.md ("" when there are none). */
export function housekeepingNew(md: string, budget = HOUSEKEEPING_BUDGET): string {
  const m = md.match(/^##\s*New\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/im);
  if (!m) return "";
  const body = m[1].split("\n").filter(l => l.trim() && !/^\s*<!--.*-->\s*$/.test(l)).join("\n").trim();
  if (!body) return "";
  return body.length > budget ? `${body.slice(0, budget)}\n[… truncated; read the rest with harold_read("harold/briefs/housekeeping-notes.md")]` : body;
}

/** Step 0 of playbook/core/morning-brief.md, for a chat: draft first, then the overnight question. */
export function morningStep0(hasDraft: boolean): string {
  return hasDraft
    ? [
      "When this is the start of the owner's day (\"good morning\", \"what's on today\"), follow Step 0 of playbook/core/morning-brief.md:",
      "1. Show the draft above as written (Steps 1 and 2), headed by one line saying when the job fired and finished (its frontmatter `fired` and `generated`) and the age of any data it states. Do not redo its searches or rebuild the alerts.",
      "2. If there are housekeeping notes above, add one short **Housekeeping** line at the end with them.",
      "3. Ask: \"You got anything? What came in overnight?\" and stop. The scheduled job could not ask it.",
      "4. Fold in what the owner says, adjust the TOP 3 PRIORITIES if it changes them (say what changed and why), ask \"Does this look right?\", then continue to the day's priorities and Step 3 of the playbook.",
    ].join("\n")
    : [
      "When this is the start of the owner's day, there is no draft to show: run the brief live as playbook/core/morning-brief.md describes (read it with harold_read).",
      "Still ask \"You got anything? What came in overnight?\" before proposing priorities, then build the day's priorities from the alerts, the critical lessons and the recent daily notes, and ask \"Does this look right?\".",
    ].join("\n");
}
