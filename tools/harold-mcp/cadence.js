/**
 * Who has gone quiet: the staleness rule behind harold_cadence_check and harold_alerts_sync.
 *
 * The same rule as the hosted connector's crm_stale (tools/harold-connector/src/stale.ts), so a terminal
 * session and a chat flag the same people:
 *   - only contacts whose status is active or pending (the caller's query);
 *   - only contacts with a relationship: warmth Lukewarm, Warm or Hot (Cold or unset get no nudge);
 *   - never the skip types (HAROLD_NO_CADENCE_TYPES, default "other", plus HAROLD_NO_LOG_TYPES), matched
 *     against the contact's ONE type only, never its labels;
 *   - the threshold is the tightest stage cadence (pipeline_stages.default_cadence) among the contact's
 *     OPEN pipeline entries (closed_at is null); otherwise warmth: Hot hotDays (7), Warm staleDays (14),
 *     Lukewarm twice staleDays (28);
 *   - stale when the last interaction is at least that many days ago; a Hot or Warm contact with no
 *     interaction logged at all is flagged too (a relationship with nothing on record is a data gap).
 * Pure: no database, no clock of its own, so it can be tested without either.
 */

export const CADENCE_DAYS = { weekly: 7, biweekly: 14, monthly: 30, quarterly: 90 };
const DAY_MS = 86_400_000;

export const typeList = v => [...new Set((v || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean))];

/** HAROLD_NO_CADENCE_TYPES (default "other"; set it empty to track every type) plus the no-log types. */
export function cadenceSkipTypes(noCadence, noLog) {
  return [...new Set([...typeList(noCadence ?? "other"), ...(noLog || []).map(t => String(t).trim().toLowerCase()).filter(Boolean)])];
}

/**
 * @param contacts rows of contacts with contact_pipelines (stage, purpose, project, closed_at) and
 *                 interactions (occurred_at, type, subject) embedded
 * @param stages   rows of pipeline_stages (stage_name, default_cadence)
 * @param o        { staleDays = 14, hotDays = 7, skipTypes = [], type, now = new Date() }
 */
export function staleFromRows(contacts, stages, o = {}) {
  const staleDays = o.staleDays ?? 14, hotDays = o.hotDays ?? 7, now = o.now ?? new Date();
  const skip = new Set((o.skipTypes || []).map(t => String(t).toLowerCase()));
  const only = o.type ? String(o.type).trim().toLowerCase() : "";
  const cadence = {};
  for (const s of stages || []) {
    const d = CADENCE_DAYS[String(s.default_cadence || "")];
    if (d) cadence[s.stage_name] = { days: d, name: String(s.default_cadence) };
  }
  const out = [];
  for (const c of contacts || []) {
    const type = String(c.category || "").trim().toLowerCase();
    if (skip.has(type)) continue;
    if (only && type !== only) continue;
    const warmth = String(c.warmth || "").trim().toLowerCase();
    if (!["hot", "warm", "lukewarm"].includes(warmth)) continue;

    const ints = (c.interactions || []).filter(i => i && i.occurred_at && !Number.isNaN(Date.parse(i.occurred_at)))
      .sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at));
    const last = ints[0] || null;
    const daysSince = last ? Math.ceil((now.getTime() - Date.parse(last.occurred_at)) / DAY_MS) : null;

    const open = (c.contact_pipelines || []).filter(p => p && !p.closed_at);
    const tight = open.filter(p => p.stage && cadence[p.stage]).sort((a, b) => cadence[a.stage].days - cadence[b.stage].days)[0];
    let threshold, basis;
    if (tight) { threshold = cadence[tight.stage].days; basis = `stage ${tight.stage}, ${cadence[tight.stage].name}`; }
    else if (warmth === "hot") { threshold = hotDays; basis = "Hot"; }
    else if (warmth === "warm") { threshold = staleDays; basis = "Warm"; }
    else { threshold = staleDays * 2; basis = "Lukewarm"; }

    const stale = daysSince === null ? warmth === "hot" || warmth === "warm" : daysSince >= threshold;
    if (!stale) continue;
    out.push({
      id: c.id, name: c.name, org: c.org || "", type: type || "other", warmth: c.warmth || "", priority: c.priority || "medium", status: c.status,
      daysSinceContact: daysSince, threshold, basis,
      lastInteractionType: last ? last.type || null : null, lastInteractionSubject: last ? last.subject || null : null,
      pipelines: open.map(p => ({ stage: p.stage || "", purpose: p.purpose || "", project: p.project || "" })),
    });
  }
  // Most overdue first; never-contacted Hot/Warm contacts at the top (no record is the biggest gap).
  const over = s => (s.daysSinceContact === null ? Infinity : s.daysSinceContact - s.threshold);
  out.sort((a, b) => over(b) - over(a) || String(a.name).localeCompare(String(b.name)));
  return out;
}
