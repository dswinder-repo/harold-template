// harold/learnings.jsonl: next free id, computed exactly as `bin/harold file learning` does
// (max numeric part of every id + 1, zero-padded to 3). The connector recomputes it on every
// commit attempt, so a concurrent write that lands first simply moves this one to the next number.

export const SEVERITIES = ["critical", "warning", "info"] as const;
export const CATEGORIES = ["names", "titles", "tools", "process", "scope", "filing", "facts", "context"] as const;

export function parseJsonl(text: string): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try { rows.push(JSON.parse(t)); } catch { /* bin/harold reports these; the id scan skips them */ }
  }
  return rows;
}

export function nextLearningId(text: string): string {
  const rows = parseJsonl(text);
  const max = Math.max(0, ...rows.map(r => parseInt(String(r.id ?? "").replace(/\D/g, ""), 10) || 0));
  return `L${String(max + 1).padStart(3, "0")}`;
}

export interface LearningInput { lesson: string; severity: string; category: string; project?: string }

export function appendLearning(current: string, input: LearningInput, dateIso: string): { text: string; entry: Record<string, string> } {
  const entry = {
    id: nextLearningId(current),
    date: dateIso,
    severity: input.severity,
    project: (input.project || "global").trim() || "global",
    category: input.category,
    lesson: input.lesson.trim(),
    source: "connector",
  };
  const base = current.length && !current.endsWith("\n") ? current + "\n" : current;
  return { text: base + JSON.stringify(entry) + "\n", entry };
}
