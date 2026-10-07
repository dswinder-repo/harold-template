// crm_stale: who has gone quiet. The same rule as harold_cadence_check (queryStaleCrmContacts in
// tools/harold-mcp/server.js), so a chat and a terminal session flag the same people:
//   - only contacts whose status is active or pending;
//   - only contacts with a relationship: warmth Lukewarm, Warm or Hot (Cold or unset get no nudge);
//   - never the types the caller passes in `skipTypes` (HAROLD_NO_CADENCE_TYPES, default "other", plus
//     HAROLD_NO_LOG_TYPES), matched against the contact's ONE type only, never its labels;
//   - the threshold is the tightest stage cadence (pipeline_stages.default_cadence) among the contact's
//     OPEN pipeline entries (closed_at is null); otherwise warmth: Hot hot_days (7), Warm stale_days (14),
//     Lukewarm twice stale_days (28);
//   - stale when the last interaction is at least that many days ago; a Hot or Warm contact with no
//     interaction logged at all is flagged too (a relationship with nothing on record is a data gap).
// Read-only.

import type { SupabaseClient } from "@supabase/supabase-js";

const CADENCE_DAYS: Record<string, number> = { weekly: 7, biweekly: 14, monthly: 30, quarterly: 90 };
const DAY_MS = 86_400_000;
const PAGE = 1000;

export const typeList = (v: string | undefined) => [...new Set((v || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean))];

/** HAROLD_NO_CADENCE_TYPES (default "other"; set it empty to track every type) plus the given no-log types. */
export function cadenceSkipTypes(noLog: string[]): string[] {
  return [...new Set([...typeList(process.env.HAROLD_NO_CADENCE_TYPES ?? "other"), ...noLog.map(t => t.trim().toLowerCase()).filter(Boolean)])];
}

export interface StaleOpts { staleDays?: number; hotDays?: number; skipTypes: string[]; type?: string; now?: Date; limit?: number }
export interface StaleContact {
  id: string; name: string; org: string; type: string; warmth: string; daysSince: number | null; threshold: number; basis: string;
  last?: { type: string; subject: string; occurred_at: string }; pipelines: { stage: string; purpose: string; project: string }[];
}

type Row = {
  id: string; name: string; org?: string; category?: string; warmth?: string; status?: string;
  contact_pipelines?: { stage?: string; purpose?: string; project?: string; closed_at?: string | null }[] | null;
  interactions?: { occurred_at?: string; type?: string; subject?: string }[] | null;
};

export async function staleContacts(sb: SupabaseClient, o: StaleOpts): Promise<{ contacts: StaleContact[]; checked: number }> {
  const staleDays = o.staleDays ?? 14, hotDays = o.hotDays ?? 7, now = o.now ?? new Date();
  const skip = new Set(o.skipTypes.map(t => t.toLowerCase()));

  const cadence: Record<string, { days: number; name: string }> = {};
  const { data: stages, error: stErr } = await sb.from("pipeline_stages").select("stage_name, default_cadence");
  if (stErr) throw new Error(`reading pipeline_stages: ${stErr.message}`);
  for (const s of (stages || []) as { stage_name: string; default_cadence?: string }[]) {
    const d = CADENCE_DAYS[String(s.default_cadence || "")];
    if (d) cadence[s.stage_name] = { days: d, name: String(s.default_cadence) };
  }

  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from("contacts")
      .select("id, name, org, category, warmth, status, contact_pipelines ( stage, purpose, project, closed_at ), interactions ( occurred_at, type, subject )")
      .in("status", ["active", "pending"]).order("name").range(from, from + PAGE - 1);
    if (error) throw new Error(`reading contacts: ${error.message}`);
    const page = (data || []) as unknown as Row[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }

  const out: StaleContact[] = [];
  for (const c of rows) {
    const type = String(c.category || "").trim().toLowerCase();
    if (skip.has(type)) continue;
    if (o.type && type !== o.type.trim().toLowerCase()) continue;
    const warmth = String(c.warmth || "").trim().toLowerCase();
    if (!["hot", "warm", "lukewarm"].includes(warmth)) continue;

    const ints = (c.interactions || []).filter(i => i.occurred_at && !Number.isNaN(Date.parse(i.occurred_at)))
      .sort((a, b) => Date.parse(b.occurred_at!) - Date.parse(a.occurred_at!));
    const last = ints[0];
    const daysSince = last ? Math.ceil((now.getTime() - Date.parse(last.occurred_at!)) / DAY_MS) : null;

    const open = (c.contact_pipelines || []).filter(p => !p.closed_at);
    let threshold: number, basis: string;
    const tight = open.filter(p => p.stage && cadence[p.stage]).sort((a, b) => cadence[a.stage!].days - cadence[b.stage!].days)[0];
    if (tight) { threshold = cadence[tight.stage!].days; basis = `stage ${tight.stage}, ${cadence[tight.stage!].name}`; }
    else if (warmth === "hot") { threshold = hotDays; basis = "Hot"; }
    else if (warmth === "warm") { threshold = staleDays; basis = "Warm"; }
    else { threshold = staleDays * 2; basis = "Lukewarm"; }

    const stale = daysSince === null ? warmth === "hot" || warmth === "warm" : daysSince >= threshold;
    if (!stale) continue;
    out.push({
      id: c.id, name: c.name, org: c.org || "", type: type || "other", warmth: c.warmth || "", daysSince, threshold, basis,
      last: last ? { type: last.type || "", subject: last.subject || "", occurred_at: last.occurred_at! } : undefined,
      pipelines: open.map(p => ({ stage: p.stage || "", purpose: p.purpose || "", project: p.project || "" })),
    });
  }
  // Most overdue first; never-contacted Hot/Warm contacts at the top (no record is the biggest gap).
  const over = (s: StaleContact) => (s.daysSince === null ? Infinity : s.daysSince - s.threshold);
  out.sort((a, b) => over(b) - over(a) || a.name.localeCompare(b.name));
  return { contacts: out, checked: rows.length };
}

export async function staleText(sb: SupabaseClient, o: StaleOpts): Promise<{ text: string; isError?: boolean }> {
  const { contacts, checked } = await staleContacts(sb, o);
  const limit = Math.min(Math.max(o.limit ?? 50, 1), 200);
  const skipped = o.skipTypes.length ? ` Types never checked: ${o.skipTypes.join(", ")}.` : "";
  const rule = `Rule: active or pending contacts with warmth Lukewarm, Warm or Hot; threshold = the tightest stage cadence among open pipeline entries, else Hot ${o.hotDays ?? 7}d, Warm ${o.staleDays ?? 14}d, Lukewarm ${(o.staleDays ?? 14) * 2}d.${skipped}`;
  if (!contacts.length) return { text: `Nobody has gone quiet${o.type ? ` among type "${o.type}"` : ""}: ${checked} active or pending contact${checked === 1 ? "" : "s"} checked, all within their cadence.\n\n${rule}` };
  const by = new Map<string, StaleContact[]>();
  for (const c of contacts.slice(0, limit)) { if (!by.has(c.type)) by.set(c.type, []); by.get(c.type)!.push(c); }
  const L = [`# Gone quiet: ${contacts.length} contact${contacts.length === 1 ? "" : "s"} past their cadence${contacts.length > limit ? ` (showing ${limit})` : ""}`, ""];
  for (const [type, group] of by) {
    L.push(`## ${type} (${group.length})`);
    for (const c of group) {
      const when = c.daysSince === null ? "no interaction logged" : `last ${c.daysSince}d ago${c.last ? ` (${c.last.occurred_at.slice(0, 10)}, ${c.last.type}${c.last.subject ? `: ${c.last.subject.slice(0, 80)}` : ""})` : ""}`;
      const due = c.daysSince === null ? "" : `, ${c.daysSince - c.threshold}d over`;
      const pipe = c.pipelines.length ? ` · pipeline: ${c.pipelines.map(p => `${p.stage}${p.purpose ? ` (${p.purpose})` : ""}`).join("; ")}` : "";
      L.push(`- **${c.name}**${c.org ? ` (${c.org})` : ""}${c.warmth ? ` [${c.warmth}]` : ""}: ${when}; cadence ${c.threshold}d (${c.basis})${due}${pipe}`);
    }
    L.push("");
  }
  L.push(rule, "Read-only: nothing was changed. Log a touchpoint with crm_log_interaction once it happens.");
  return { text: L.join("\n") };
}
