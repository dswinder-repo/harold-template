// The CRM (Supabase), ported from tools/harold-mcp/server.js against the starter schema
// (tools/harold-mcp/schema.sql): same tables, same contact matching, same pipeline rules (one
// pipeline, every entry bound to a stated purpose, nobody placed automatically), and the same
// optional HAROLD_NO_LOG_TYPES setting: an interaction is never logged for a contact whose type
// (contacts.category) is listed there. Empty by default, so nothing is refused unless the owner opts in.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isNoLogType, tz } from "./config.js";

export type Sb = SupabaseClient;
export interface CrmResult { text: string; isError?: boolean; person?: { name: string; noLog: boolean } }

let _sb: Sb | null = null;
export function supabaseFromEnv(): Sb | null {
  const url = (process.env.SUPABASE_URL || "").trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) return null;
  if (!_sb) _sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return _sb;
}

export const NOT_CONFIGURED: CrmResult = { text: "The CRM is not configured on this connector (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set).", isError: true };
const err = (text: string): CrmResult => ({ text, isError: true });
const day = (d?: string | null) => (d ? new Date(d).toLocaleDateString("en-US", { timeZone: tz() }) : "—");
// Task due dates are calendar days. The starter schema stores them as timestamptz (midnight UTC), so
// they are shown by their date part, never shifted into the owner's zone (which could move them a day).
const dueDay = (d?: string | null) => {
  if (!d) return "no due date";
  const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${Number(m[2])}/${Number(m[3])}/${m[1]}` : day(d);
};
const STAGES = ["Identified", "Reached Out", "In Conversation", "Advancing", "Committed", "Active", "Dormant"] as const;
export { STAGES };

// Escape PostgREST ilike wildcards in user text so "a_b" does not match "axb".
const likeEsc = (s: string) => s.replace(/[\\%_]/g, m => `\\${m}`);

// ───────────── contact resolution (same algorithm as server.js resolveContact) ─────────────

type Resolved = { id: string; name: string } | { error: CrmResult };

export async function resolveContact(sb: Sb, contactName: string, org?: string): Promise<Resolved> {
  const { data: exact } = await sb.from("contacts").select("id, name, org, warmth, status").ilike("name", likeEsc(contactName));
  let matches = (exact || []) as { id: string; name: string; org?: string; warmth?: string }[];
  if (!matches.length) {
    const { data: partial } = await sb.from("contacts").select("id, name, org, warmth, status").ilike("name", `%${likeEsc(contactName)}%`);
    matches = (partial || []) as typeof matches;
  }
  if (!matches.length) return { error: err(`No contact found matching "${contactName}"${org ? ` at ${org}` : ""}. Use crm_upsert_contact to create them first.`) };
  if (matches.length > 1 && org) {
    const f = matches.filter(m => m.org && m.org.toLowerCase().includes(org.toLowerCase()));
    if (f.length >= 1) matches = f;
  }
  if (matches.length > 1) {
    const list = matches.slice(0, 5).map(m => `  - ${m.name} (${m.org || "no org"}) [${m.warmth || "no warmth"}] — id: ${m.id}`).join("\n");
    return { error: { text: `Multiple contacts match "${contactName}". Please specify:\n${list}\n\nUse contact_id for exact targeting.` } };
  }
  return { id: matches[0].id, name: matches[0].name };
}

/** The contact's name and type, and whether HAROLD_NO_LOG_TYPES lists that type. */
export async function noLogContact(sb: Sb, contactId: string): Promise<{ noLog: boolean; name: string; type: string }> {
  const { data: c } = await sb.from("contacts").select("id, name, category").eq("id", contactId).maybeSingle();
  const row = c as { name?: string; category?: string } | null;
  if (!row) return { noLog: false, name: "", type: "" };
  const type = String(row.category || "").trim().toLowerCase();
  return { noLog: isNoLogType(type), name: row.name || "", type };
}

export const NO_LOG_MESSAGE = (name: string, type: string) =>
  `Not logged: ${name || "this contact"} is type "${type}", and HAROLD_NO_LOG_TYPES says conversations with that type are never logged. Keep their record current with crm_upsert_contact instead; if something from the conversation matters, capture it with harold_capture.`;

// ───────────── log interaction ─────────────

export interface LogInteractionArgs { contact_id?: string; contact_name?: string; org?: string; type: string; subject: string; body?: string; occurred_at?: string }

export async function logInteraction(sb: Sb, a: LogInteractionArgs): Promise<CrmResult> {
  let id = a.contact_id, name = a.contact_name || "";
  if (!id) {
    if (!a.contact_name) return err("Provide either contact_id or contact_name");
    const r = await resolveContact(sb, a.contact_name, a.org);
    if ("error" in r) return r.error;
    id = r.id; name = r.name;
  }
  const gate = await noLogContact(sb, id);
  if (gate.noLog) return { text: NO_LOG_MESSAGE(gate.name || name, gate.type), isError: true, person: { name: gate.name || name, noLog: true } };
  if (gate.name) name = gate.name;
  const { data, error } = await sb.from("interactions").insert({
    contact_id: id, type: a.type, subject: a.subject || "", body: a.body || "", occurred_at: a.occurred_at || new Date().toISOString(),
  }).select("id, occurred_at").single();
  if (error) return err(`Error logging interaction: ${error.message}`);
  const row = data as { id: string; occurred_at: string };
  return { text: `Logged ${a.type} for ${name}: "${a.subject}"\n   Contact: ${id}\n   Interaction: ${row.id}\n   Time: ${row.occurred_at}`, person: { name, noLog: false } };
}

// ───────────── upsert contact ─────────────

export interface UpsertArgs {
  contact_id?: string; name: string; org?: string; category?: string; categories?: string[]; warmth?: string; status?: string; priority?: string;
  email?: string; phone?: string; location?: string; website?: string; notes?: string; region?: string; investor_type?: string;
}

export async function upsertContact(sb: Sb, a: UpsertArgs): Promise<CrmResult> {
  let isUpdate = false;
  let existingId = a.contact_id;
  if (!existingId && a.name) {
    const { data: existing } = await sb.from("contacts").select("id, name, org").ilike("name", likeEsc(a.name));
    const ex = (existing || []) as { id: string; org?: string }[];
    if (ex.length > 0) {
      if (a.org) {
        const m = ex.find(e => e.org && e.org.toLowerCase().includes(a.org!.toLowerCase()));
        if (m) { existingId = m.id; isUpdate = true; }
      } else if (ex.length === 1) { existingId = ex[0].id; isUpdate = true; }
      // several matches and no org: a new record, as in server.js
    }
  } else if (existingId) isUpdate = true;

  const record: Record<string, unknown> = {};
  for (const k of ["name", "org", "category", "warmth", "status", "priority", "email", "phone", "location", "website", "notes", "region", "investor_type"] as const) {
    if (a[k] !== undefined) record[k] = a[k];
  }
  let contact: { id: string; name: string; org?: string; warmth?: string; status?: string; category?: string };
  if (isUpdate && existingId) {
    record.updated_at = new Date().toISOString();
    const { data, error } = await sb.from("contacts").update(record).eq("id", existingId).select("id, name, org, warmth, status, category").single();
    if (error) return err(`Error upserting contact: ${error.message}`);
    contact = data as typeof contact;
  } else {
    // Pipeline placement is deliberate and purpose-bound: nothing is auto-placed here.
    if (!record.status) record.status = "pending";
    if (!record.priority) record.priority = "medium";
    if (!record.category || !String(record.category).trim()) record.category = "other";
    const { data, error } = await sb.from("contacts").insert(record).select("id, name, org, warmth, status, category").single();
    if (error) return err(`Error upserting contact: ${error.message}`);
    contact = data as typeof contact;
  }

  // Labels: the `categories` parameter writes contact_categories, never contacts.category.
  if (Array.isArray(a.categories) && a.categories.length) {
    const rows = a.categories.map(c => String(c).trim().toLowerCase()).filter(Boolean).map(category_name => ({ contact_id: contact.id, category_name }));
    if (rows.length) await sb.from("contact_categories").upsert(rows, { onConflict: "contact_id,category_name" });
  }
  const { data: catRows } = await sb.from("contact_categories").select("category_name").eq("contact_id", contact.id);
  const labels = ((catRows || []) as { category_name: string }[]).map(r => r.category_name);
  const { data: pipes } = await sb.from("contact_pipelines").select("stage, purpose, project").eq("contact_id", contact.id);
  const pipeStr = ((pipes || []) as { stage: string; purpose?: string; project?: string }[])
    .map(cp => `\n   Pipeline: ${cp.stage}${cp.purpose ? ` — ${cp.purpose}` : ""}${cp.project ? ` [${cp.project}]` : ""}`).join("");
  return {
    text: `${isUpdate ? "Updated" : "Created"} contact: ${contact.name} (${contact.org || "no org"}) [type: ${contact.category}${labels.length ? `; labels: ${labels.join(", ")}` : ""}]${contact.warmth ? ` | ${contact.warmth}` : ""}\n   ID: ${contact.id}\n   Status: ${contact.status}${pipeStr}`,
    person: { name: contact.name, noLog: isNoLogType(contact.category) },
  };
}

// ───────────── search / get ─────────────

export interface SearchArgs {
  name?: string; org?: string; category?: string; purpose?: string; project?: string; pipeline_stage?: string; warmth?: string; status?: string;
  priority?: string; region?: string; investor_type?: string; keyword?: string; has_email?: boolean; has_phone?: boolean;
  limit?: number; order_by?: "name" | "updated_at" | "created_at" | "warmth" | "org";
}

export async function searchContacts(sb: Sb, a: SearchArgs): Promise<CrmResult> {
  const lim = Math.min(Math.max(a.limit || 25, 1), 100);
  let q = sb.from("contacts").select("id, name, org, category, warmth, status, priority, email, phone, location, region, investor_type, notes, updated_at");
  let pipelineIds: string[] | null = null;
  if (a.purpose || a.project || a.pipeline_stage) {
    let pq = sb.from("contact_pipelines").select("contact_id");
    if (a.pipeline_stage) pq = pq.eq("stage", a.pipeline_stage);
    if (a.purpose) pq = pq.ilike("purpose", `%${likeEsc(a.purpose)}%`);
    if (a.project) pq = pq.eq("project", a.project);
    const { data } = await pq;
    pipelineIds = [...new Set(((data || []) as { contact_id: string }[]).map(m => m.contact_id))];
  }
  if (a.name) q = q.ilike("name", `%${likeEsc(a.name)}%`);
  if (a.org) q = q.ilike("org", `%${likeEsc(a.org)}%`);
  if (a.category) q = q.eq("category", a.category);
  if (pipelineIds !== null) q = pipelineIds.length ? q.in("id", pipelineIds) : q.eq("id", "00000000-0000-0000-0000-000000000000");
  if (a.warmth) q = q.eq("warmth", a.warmth);
  if (a.status) q = q.eq("status", a.status);
  if (a.priority) q = q.eq("priority", a.priority);
  if (a.region) q = q.ilike("region", `%${likeEsc(a.region)}%`);
  if (a.investor_type) q = q.ilike("investor_type", `%${likeEsc(a.investor_type)}%`);
  if (a.has_email) q = q.not("email", "is", null).neq("email", "");
  if (a.has_phone) q = q.not("phone", "is", null).neq("phone", "");
  if (a.keyword) {
    // PostgREST or() syntax: strip characters that would break the filter grammar.
    const k = a.keyword.replace(/[,()*%\\]/g, " ").trim();
    if (k) q = q.or(["name", "org", "notes", "region", "location"].map(f => `${f}.ilike.*${k}*`).join(","));
  }
  const sortField = a.order_by || "updated_at";
  q = q.order(sortField, { ascending: sortField === "name" || sortField === "org" }).limit(lim);
  const { data: contacts, error } = await q;
  if (error) return err(`Search error: ${error.message}`);
  const filters = Object.entries({ name: a.name, org: a.org, category: a.category, purpose: a.purpose, project: a.project, stage: a.pipeline_stage, warmth: a.warmth, status: a.status, keyword: a.keyword, region: a.region })
    .filter(([, v]) => v).map(([k, v]) => `${k}~"${v}"`);
  if (a.has_email) filters.push("has_email");
  if (a.has_phone) filters.push("has_phone");
  const rows = (contacts || []) as Record<string, string>[];
  if (!rows.length) return { text: `No contacts found matching: ${filters.join(", ") || "no filters"}` };
  const { data: pipes } = await sb.from("contact_pipelines").select("contact_id, stage, purpose, project, entered_at").in("contact_id", rows.map(c => c.id));
  const pm: Record<string, string[]> = {};
  for (const cp of (pipes || []) as Record<string, string>[]) (pm[cp.contact_id] ||= []).push(`${cp.stage}${cp.purpose ? " — " + cp.purpose : ""}`);
  const lines = rows.map((c, i) => {
    const notes = c.notes ? ` — ${c.notes.substring(0, 80)}${c.notes.length > 80 ? "…" : ""}` : "";
    const tags = [c.warmth, (pm[c.id] || []).join(", ")].filter(Boolean).join(" | ");
    const extra = [c.email, c.phone, c.region, c.investor_type].filter(Boolean).map(x => ` | ${x}`).join("");
    return `${i + 1}. **${c.name}** (${c.org || "no org"}) [${c.category}${tags ? ` | ${tags}` : ""}] ${c.status}${extra}${notes}\n   id: ${c.id}`;
  });
  return { text: `Found ${rows.length} contact${rows.length === 1 ? "" : "s"}${filters.length ? ` matching: ${filters.join(", ")}` : ""}\n\n${lines.join("\n\n")}` };
}

export interface GetArgs { contact_id?: string; contact_name?: string; org?: string; include_interactions?: boolean; interaction_limit?: number }

export async function getContact(sb: Sb, a: GetArgs): Promise<CrmResult> {
  let id = a.contact_id;
  if (!id) {
    if (!a.contact_name) return err("Provide either contact_id or contact_name");
    const r = await resolveContact(sb, a.contact_name, a.org);
    if ("error" in r) return r.error;
    id = r.id;
  }
  const { data: contact, error } = await sb.from("contacts").select("*").eq("id", id).single();
  if (error) return err(`Error fetching contact: ${error.message}`);
  if (!contact) return err(`Contact not found: ${id}`);
  const c = contact as Record<string, string>;
  const { data: cats } = await sb.from("contact_categories").select("category_name").eq("contact_id", id);
  const labels = ((cats || []) as { category_name: string }[]).map(x => x.category_name);
  const L: string[] = [`# ${c.name}`, `**Organization:** ${c.org || "—"}`, `**Type:** ${c.category || "—"}${labels.length ? ` | **Labels:** ${labels.join(", ")}` : ""}`,
    `**Warmth:** ${c.warmth || "—"} | **Status:** ${c.status || "—"} | **Priority:** ${c.priority || "—"}`];
  const { data: pipes } = await sb.from("contact_pipelines").select("stage, purpose, project, entered_at, closed_at, outcome").eq("contact_id", id);
  for (const cp of (pipes || []) as Record<string, string>[]) {
    L.push(`**Pipeline:** **${cp.stage}**${cp.purpose ? ` — ${cp.purpose}` : ""}${cp.project ? ` [${cp.project}]` : ""} (since ${day(cp.entered_at)})${cp.closed_at ? ` — closed ${day(cp.closed_at)}${cp.outcome ? `: ${cp.outcome}` : ""}` : ""}`);
  }
  for (const [k, label] of [["email", "Email"], ["phone", "Phone"], ["location", "Location"], ["region", "Region"], ["investor_type", "Investor Type"], ["website", "Website"], ["notes", "Notes"]] as const) {
    if (c[k]) L.push(`**${label}:** ${c[k]}`);
  }
  L.push(`**Created:** ${day(c.created_at)}`, `**Updated:** ${day(c.updated_at)}`, `**ID:** ${c.id}`);
  if (a.include_interactions !== false) {
    const { data: ints } = await sb.from("interactions").select("id, type, subject, body, occurred_at").eq("contact_id", id).order("occurred_at", { ascending: false }).limit(Math.min(a.interaction_limit || 10, 50));
    const rows = (ints || []) as Record<string, string>[];
    if (rows.length) {
      L.push(`\n## Interaction History (${rows.length} most recent)`);
      rows.forEach(i => L.push(`- **${day(i.occurred_at)}** [${i.type}] ${i.subject}${i.body ? ` — ${i.body.substring(0, 120)}${i.body.length > 120 ? "…" : ""}` : ""}`));
    } else L.push("\n## Interaction History\nNo interactions logged yet.");
  }
  const { data: tasks } = await sb.from("tasks").select("id, title, status, priority, due_date").eq("contact_id", id).in("status", ["pending", "in_progress"]).order("due_date", { ascending: true }).limit(5);
  const trows = (tasks || []) as Record<string, string>[];
  if (trows.length) { L.push("\n## Open Tasks"); trows.forEach(t => L.push(`- [${t.status}] ${t.title} (${t.priority}, ${dueDay(t.due_date)}) — id: ${t.id}`)); }
  const { data: sc } = await sb.from("stage_changes").select("from_stage, to_stage, notes, changed_at").eq("contact_id", id).order("changed_at", { ascending: false }).limit(10);
  const srows = (sc || []) as Record<string, string>[];
  if (srows.length) { L.push("\n## Stage History"); srows.forEach(s => L.push(`- **${day(s.changed_at)}**: ${s.from_stage || "—"} → ${s.to_stage}${s.notes ? ` — ${s.notes}` : ""}`)); }
  return { text: L.join("\n"), person: { name: c.name, noLog: isNoLogType(c.category) } };
}

// ───────────── pipeline ─────────────

export interface PipelineArgs {
  action: "add" | "move" | "close" | "list"; contact_name?: string; org?: string; entry_id?: string; purpose?: string; project?: string;
  stage?: (typeof STAGES)[number]; outcome?: string; notes?: string; filter_stage?: string; filter_project?: string;
}

export async function pipeline(sb: Sb, a: PipelineArgs): Promise<CrmResult> {
  if (a.action === "list") {
    let q = sb.from("contact_pipelines").select("id, stage, purpose, project, entered_at, outcome, closed_at, contacts ( name, org, category, warmth )").is("closed_at", null);
    if (a.filter_stage) q = q.eq("stage", a.filter_stage);
    if (a.filter_project) q = q.eq("project", a.filter_project);
    const { data, error } = await q;
    if (error) return err(`Error: ${error.message}`);
    const rows = (data || []) as unknown as { stage: string; purpose?: string; project?: string; entered_at?: string; contacts?: { name?: string; org?: string } }[];
    if (!rows.length) return { text: "The pipeline has no open entries matching that. Nobody is ever auto-placed: an entry exists only when a conversation put someone there for a reason." };
    const by: Record<string, typeof rows> = {};
    for (const e of rows) (by[e.stage] ||= []).push(e);
    const L = [`# Pipeline — ${rows.length} open entr${rows.length === 1 ? "y" : "ies"}`, ""];
    for (const st of STAGES) {
      if (!by[st]) continue;
      L.push(`## ${st} (${by[st].length})`);
      for (const e of by[st]) { const c = e.contacts || {}; L.push(`- **${c.name || "?"}**${c.org ? ` (${c.org})` : ""} — ${e.purpose || "no purpose recorded"}${e.project ? ` [${e.project}]` : ""} · since ${day(e.entered_at)}`); }
      L.push("");
    }
    return { text: L.join("\n") };
  }
  if (!a.contact_name && !a.entry_id) return err("Need contact_name (or entry_id).");
  let contact: { id: string; name: string } | null = null;
  if (a.contact_name) {
    const r = await resolveContact(sb, a.contact_name, a.org);
    if ("error" in r) return r.error;
    contact = { id: r.id, name: r.name };
  }
  if (a.action === "add") {
    if (!contact) return err("add needs contact_name.");
    if (!a.purpose || !a.purpose.trim()) return err("Need a purpose: why is this person in the pipeline? (e.g. 'seed round', 'pilot customer for the new product', 'advisor role')");
    const { data, error } = await sb.from("contact_pipelines").insert({ contact_id: contact.id, stage: a.stage || "Identified", purpose: a.purpose.trim(), project: a.project || null }).select("id, stage, purpose, project").single();
    if (error) return err(`Error: ${error.message}`);
    const e = data as { id: string; stage: string; purpose: string; project?: string };
    await sb.from("stage_changes").insert({ contact_id: contact.id, entry_id: e.id, from_stage: null, to_stage: e.stage, notes: a.notes || "" });
    return { text: `${contact.name} is in the pipeline at **${e.stage}** — ${e.purpose}${e.project ? ` [${e.project}]` : ""}`, person: { name: contact.name, noLog: false } };
  }
  type Entry = { id: string; stage: string; purpose?: string; project?: string; contact_id: string };
  let entry: Entry | null = null;
  if (a.entry_id) {
    const { data } = await sb.from("contact_pipelines").select("id, stage, purpose, project, contact_id").eq("id", a.entry_id).maybeSingle();
    entry = data as Entry | null;
    if (!entry) return err(`No pipeline entry ${a.entry_id}.`);
  } else if (contact) {
    const { data } = await sb.from("contact_pipelines").select("id, stage, purpose, project, contact_id").eq("contact_id", contact.id).is("closed_at", null);
    const rows = (data || []) as Entry[];
    if (!rows.length) return err(`${contact.name} is not in the pipeline. Use action "add" with a purpose.`);
    if (rows.length > 1 && !a.purpose) return err(`${contact.name} has ${rows.length} open entries. Say which by passing purpose or entry_id:\n` + rows.map(e => `- ${e.stage}: ${e.purpose} (${e.id})`).join("\n"));
    entry = rows.length === 1 ? rows[0] : rows.find(e => (e.purpose || "").toLowerCase().includes((a.purpose || "").toLowerCase())) || null;
    if (!entry) return err(`No entry for ${contact.name} matching that purpose.`);
  }
  if (!entry) return err("No pipeline entry found.");
  const who = contact ? contact.name : "Entry";
  if (a.action === "move") {
    if (!a.stage) return err("Need a stage to move to.");
    const from = entry.stage;
    const { error } = await sb.from("contact_pipelines").update({ stage: a.stage, entered_at: new Date().toISOString() }).eq("id", entry.id);
    if (error) return err(`Error: ${error.message}`);
    await sb.from("stage_changes").insert({ contact_id: entry.contact_id, entry_id: entry.id, from_stage: from, to_stage: a.stage, notes: a.notes || "" });
    return { text: `${who}: **${from} → ${a.stage}** (${entry.purpose})${a.notes ? `\n   ${a.notes}` : ""}`, person: contact ? { name: contact.name, noLog: false } : undefined };
  }
  if (a.action === "close") {
    const { error } = await sb.from("contact_pipelines").update({ closed_at: new Date().toISOString(), outcome: a.outcome || "", stage: a.stage || entry.stage }).eq("id", entry.id);
    if (error) return err(`Error: ${error.message}`);
    return { text: `Closed: ${entry.purpose}${a.outcome ? ` — ${a.outcome}` : ""}. The record stays; it is out of the open pipeline.`, person: contact ? { name: contact.name, noLog: false } : undefined };
  }
  return err(`Unknown action: ${a.action}`);
}

// ───────────── tasks ─────────────

export interface TaskArgs {
  action: "create" | "update" | "complete" | "cancel" | "list"; task_id?: string; contact_name?: string; contact_id?: string; org?: string;
  title?: string; description?: string; priority?: "high" | "medium" | "low"; due_date?: string; status?: "pending" | "in_progress" | "completed" | "cancelled";
}

export async function crmTask(sb: Sb, a: TaskArgs): Promise<CrmResult> {
  const now = () => new Date().toISOString();
  if (a.action === "list") {
    let q = sb.from("tasks").select("id, title, description, status, priority, due_date, completed_at, contact_id").in("status", ["pending", "in_progress"]).order("due_date", { ascending: true, nullsFirst: false });
    if (a.contact_id) q = q.eq("contact_id", a.contact_id);
    else if (a.contact_name) {
      const r = await resolveContact(sb, a.contact_name, a.org);
      if ("error" in r) return r.error;
      q = q.eq("contact_id", r.id);
    }
    const { data, error } = await q.limit(20);
    if (error) return err(`CRM task error: ${error.message}`);
    const tasks = (data || []) as Record<string, string>[];
    if (!tasks.length) return { text: `No open CRM tasks found${a.contact_name ? ` for "${a.contact_name}"` : ""}.` };
    const ids = [...new Set(tasks.filter(t => t.contact_id).map(t => t.contact_id))];
    const { data: cs } = ids.length ? await sb.from("contacts").select("id, name, org").in("id", ids) : { data: [] };
    const cm = Object.fromEntries(((cs || []) as Record<string, string>[]).map(c => [c.id, `${c.name} (${c.org || "no org"})`]));
    return { text: `Open CRM tasks (${tasks.length}):\n\n` + tasks.map((t, i) => `${i + 1}. [${t.status}] **${t.title}** — ${t.contact_id ? cm[t.contact_id] || t.contact_id : "unlinked"} (${t.priority}, ${dueDay(t.due_date)})\n   id: ${t.id}`).join("\n\n") };
  }
  if (a.action === "complete" || a.action === "cancel") {
    if (!a.task_id) return err(`task_id required for ${a.action}`);
    const upd = a.action === "complete" ? { status: "completed", completed_at: now(), updated_at: now() } : { status: "cancelled", updated_at: now() };
    const { data, error } = await sb.from("tasks").update(upd).eq("id", a.task_id).select("id, title, status, completed_at, contact_id").single();
    if (error) return err(`CRM task error: ${error.message}`);
    const d = data as Record<string, string>;
    return { text: `${a.action === "complete" ? "Completed" : "Cancelled"}: "${d.title}"\n   ID: ${d.id}` };
  }
  if (a.action === "update") {
    if (!a.task_id) return err("task_id required for update");
    const upd: Record<string, unknown> = { updated_at: now() };
    for (const k of ["title", "description", "priority", "due_date"] as const) if (a[k] !== undefined) upd[k] = a[k];
    if (a.status !== undefined) { upd.status = a.status; if (a.status === "completed") upd.completed_at = now(); }
    const { data, error } = await sb.from("tasks").update(upd).eq("id", a.task_id).select("id, title, status, priority, due_date").single();
    if (error) return err(`CRM task error: ${error.message}`);
    const d = data as Record<string, string>;
    return { text: `Updated: "${d.title}" [${d.status}] (${d.priority}, ${dueDay(d.due_date)})\n   ID: ${d.id}` };
  }
  if (a.action === "create") {
    if (!a.title) return err("title required for create");
    let cid = a.contact_id, cname = "";
    if (!cid && a.contact_name) {
      const r = await resolveContact(sb, a.contact_name, a.org);
      if ("error" in r) return r.error;
      cid = r.id; cname = r.name;
    }
    const rec: Record<string, unknown> = { title: a.title, description: a.description || "", status: "pending", priority: a.priority || "medium" };
    if (cid) rec.contact_id = cid;
    if (a.due_date) rec.due_date = a.due_date;
    const { data, error } = await sb.from("tasks").insert(rec).select("id, title, status, priority, due_date, contact_id").single();
    if (error) return err(`CRM task error: ${error.message}`);
    const d = data as Record<string, string>;
    return { text: `Created CRM task: "${d.title}"${cname ? ` → ${cname}` : d.contact_id ? ` → ${d.contact_id}` : ""}\n   Priority: ${d.priority} | Due: ${dueDay(d.due_date)}\n   ID: ${d.id}`, person: cname ? { name: cname, noLog: false } : undefined };
  }
  return err(`Unknown action: ${a.action}`);
}
