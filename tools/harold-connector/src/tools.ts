// MCP tool surface. Read tools are readOnlyHint: true. Write tools are readOnlyHint: false,
// destructiveHint: false. There are no delete tools.

import type { McpServer, ServerContext, CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";
import { MAX_RESULT_CHARS, noLogTypes, repoConfig } from "./config.js";
import * as crm from "./crm.js";
import { HaroldRepo } from "./github.js";
import * as graph from "./graph.js";
import * as kb from "./kb.js";
import { CATEGORIES, SEVERITIES } from "./learnings.js";
import * as stale from "./stale.js";
import { localParts, truncate } from "./text.js";

export interface ToolDeps {
  repoFor: (ctx: ServerContext) => HaroldRepo;
  supabase: () => crm.Sb | null;
  now?: () => Date;
}

export function githubTokenFrom(ctx: ServerContext): string {
  const gh = (ctx.http?.authInfo?.extra as { gh?: unknown } | undefined)?.gh;
  if (typeof gh !== "string" || !gh) throw new Error("Not authenticated: no GitHub authorization on this request");
  return gh;
}

export const defaultDeps: ToolDeps = {
  repoFor: ctx => { const c = repoConfig(); return new HaroldRepo(githubTokenFrom(ctx), c.repo, c.branch); },
  supabase: crm.supabaseFromEnv,
};

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;

const out = (text: string, isError = false): CallToolResult => ({ content: [{ type: "text", text: truncate(text, MAX_RESULT_CHARS - 500, "result truncated") }], ...(isError ? { isError: true } : {}) });

async function guard(fn: () => Promise<{ text: string; isError?: boolean }>): Promise<CallToolResult> {
  try { const r = await fn(); return out(r.text, !!r.isError); }
  catch (e) { return out(`Error: ${e instanceof Error ? e.message : String(e)}`, true); }
}

export function registerTools(server: McpServer, deps: ToolDeps = defaultDeps) {
  const now = () => (deps.now ? deps.now() : new Date());
  const withSb = async (fn: (sb: crm.Sb) => Promise<crm.CrmResult>) => { const sb = deps.supabase(); return sb ? fn(sb) : crm.NOT_CONFIGURED; };

  // After a CRM write about a person: freshen their vault card (Harold's filing rule, CRM + vault together).
  const vaultFollowUp = async (ctx: ServerContext, r: crm.CrmResult): Promise<crm.CrmResult> => {
    if (r.isError || !r.person || !r.person.name) return r;
    if (r.person.noLog) return { ...r, text: `${r.text}\n\nVault: the contact's type is in HAROLD_NO_LOG_TYPES; card not touched.` };
    const note = await kb.touchPersonCard(deps.repoFor(ctx), r.person.name, now()).catch(e => `Vault card not updated: ${e instanceof Error ? e.message : e}`);
    return { ...r, text: `${r.text}\n\n${note}` };
  };

  // ───────────── read ─────────────

  server.registerTool("harold_today", {
    title: "Harold: today",
    description: "Start here when the conversation is about the owner's work day. Returns today's date in the owner's time zone (HAROLD_TZ; UTC if unset), today's morning brief draft if one exists (harold/briefs/<date>.md), the Current Alerts section of harold/alerts.md, the critical lessons from harold/learnings.jsonl, the housekeeping notes waiting in harold/briefs/housekeeping-notes.md, the five most recent daily notes with their first lines, and how to start the day (show the draft, ask what came in overnight, then the day's priorities).",
    inputSchema: z.object({}),
    annotations: READ,
  }, async (_args, ctx) => guard(() => kb.today(deps.repoFor(ctx), now())));

  server.registerTool("harold_search", {
    title: "Harold: search",
    description: "Search the whole Harold knowledge base (vault notes, playbooks, project folders, harold/ files) and return matching file paths with snippets. Uses GitHub code search, which reflects the repository's default branch and can lag a few minutes behind recent writes; falls back to matching file names. Open a result with harold_read.",
    inputSchema: z.object({
      query: z.string().min(1).max(200).describe("Words to look for, e.g. 'Acme term sheet' or 'NDA'"),
      limit: z.number().int().min(1).max(30).optional().describe("Maximum results (default 10)"),
    }),
    annotations: READ,
  }, async ({ query, limit }, ctx) => guard(() => kb.search(deps.repoFor(ctx), query, limit ?? 10)));

  server.registerTool("harold_read", {
    title: "Harold: read a file",
    description: "Read one text file from the Harold repository by its path relative to the repo root, e.g. 'vault/people/Jane Doe.md', 'harold/blockers.md', 'memory/CLAUDE.md'. Binary files are refused; very long files are truncated with a note.",
    inputSchema: z.object({ path: z.string().min(1).max(400).describe("Repo-relative path") }),
    annotations: READ,
  }, async ({ path }, ctx) => guard(() => kb.read(deps.repoFor(ctx), path)));

  server.registerTool("harold_list", {
    title: "Harold: list a folder",
    description: "List the files and subfolders of one folder in the Harold repository, e.g. 'vault/meetings' or 'vault/daily'. Pass an empty string for the repository root.",
    inputSchema: z.object({ folder: z.string().max(400).describe("Repo-relative folder path; '' for the root") }),
    annotations: READ,
  }, async ({ folder }, ctx) => guard(() => kb.list(deps.repoFor(ctx), folder)));

  server.registerTool("harold_where", {
    title: "Harold: which project",
    description: "Resolve a topic, alias or keyword to one of the owner's projects using the project map (harold/projects.md), exactly like `bin/harold where`: returns the project's name, status, folder, routes, vault card, people and notes, plus close alternatives. Use it to decide where something belongs, and to keep separate projects apart.",
    inputSchema: z.object({ topic: z.string().min(1).max(200).describe("What the owner called it, e.g. 'the example', 'the raise', a client's name") }),
    annotations: READ,
  }, async ({ topic }, ctx) => guard(() => kb.where(deps.repoFor(ctx), topic)));

  server.registerTool("harold_related", {
    title: "Harold: related notes",
    description: "Follow the links from a note: give a note path, a title or a topic (a topic is resolved with the same search as harold_search). Returns the notes linked to it, 1 hop out (and 2 hops through shared links; depth 2 follows every second hop), each with how it is linked (wikilink, md link or a frontmatter field) and its last_updated date, then a gaps line: stale (not updated in 30+ days), broken links, orphans, no meeting notes. Reads harold/graph.json, which bin/harold close writes. Use it before answering about a person, company, project or decision, and say the staleness and gaps in the answer.",
    inputSchema: z.object({
      query: z.string().min(1).max(300).describe("A note path (vault/people/Jane Doe.md), an exact title or file name, or a topic"),
      depth: z.number().int().min(1).max(2).optional().describe("1 (default): direct links plus notes sharing 2+ links; 2: every note 2 hops out"),
      limit: z.number().int().min(1).max(50).optional().describe("Maximum notes listed (default 15)"),
      all: z.boolean().optional().describe("true: list every daily note instead of the latest 3"),
    }),
    annotations: READ,
  }, async ({ query, depth, limit, all }, ctx) => guard(() => graph.relatedText(deps.repoFor(ctx), query, localParts(now()).iso, { depth, limit, all })));

  server.registerTool("harold_person", {
    title: "Harold: look up a person",
    description: "Look up a person: their vault card (vault/people/<Full Name>.md, fuzzy-matched on the name) and, when the CRM is configured, their CRM record with recent interactions, open tasks and pipeline entries. Use before answering anything about someone.",
    inputSchema: z.object({ name: z.string().min(1).max(120).describe("The person's name, full or partial") }),
    annotations: READ,
  }, async ({ name }, ctx) => guard(async () => {
    const repo = deps.repoFor(ctx);
    const cards = await kb.findPersonCards(repo, name);
    const L: string[] = [];
    let cardName = "";
    if (!cards.length) L.push(`No vault card matches "${name}" in vault/people.`);
    else {
      const best = cards[0];
      const f = await repo.getText(best.path);
      cardName = best.path.slice("vault/people/".length, -3);
      L.push(`## Vault card: ${best.path}${best.score < 80 ? " (closest match, not certain)" : ""}`, "", f ? truncate(f.text, 60_000) : "(could not read)");
      const others = cards.slice(1, 6).map(c => c.path.slice("vault/people/".length, -3));
      if (others.length) L.push("", `Other possible matches: ${others.join(", ")}`);
    }
    const sb = deps.supabase();
    if (!sb) L.push("", "## CRM", "The CRM is not configured on this connector.");
    else {
      let r = await crm.getContact(sb, { contact_name: cardName && cards[0].score >= 80 ? cardName : name, interaction_limit: 5 });
      if (r.isError && cardName && cardName.toLowerCase() !== name.toLowerCase()) r = await crm.getContact(sb, { contact_name: name, interaction_limit: 5 });
      L.push("", "## CRM", r.text.replace(/^# /, "### "));
    }
    return { text: L.join("\n") };
  }));

  server.registerTool("crm_search_contacts", {
    title: "CRM: search contacts",
    description: "Search the owner's CRM contacts by any combination of filters (all combine with AND; text filters are fuzzy). Examples: hot investors, partners in a region, everyone at a firm, who is at the Advancing stage, everyone in the pipeline for a purpose or project. Returns up to 25 results by default.",
    inputSchema: z.object({
      name: z.string().optional().describe("Name (fuzzy)"),
      org: z.string().optional().describe("Organization (fuzzy)"),
      category: z.string().optional().describe("The contact's type, from the owner's own list (e.g. investor, partner, founder, team, other)"),
      purpose: z.string().optional().describe("Why they are in the pipeline (fuzzy), e.g. 'seed round', 'pilot'"),
      project: z.string().optional().describe("Project slug from harold/projects.md"),
      pipeline_stage: z.enum(crm.STAGES).optional().describe("Pipeline stage"),
      warmth: z.enum(["Cold", "Lukewarm", "Warm", "Hot"]).optional(),
      status: z.enum(["active", "pending", "cold", "archived"]).optional(),
      priority: z.enum(["high", "medium", "low"]).optional(),
      region: z.string().optional().describe("Region (fuzzy)"),
      investor_type: z.string().optional().describe("VC, Angel, PE, Family Office, ..."),
      keyword: z.string().optional().describe("Keyword across name, org, notes, region, location"),
      has_email: z.boolean().optional(),
      has_phone: z.boolean().optional(),
      limit: z.number().int().min(1).max(100).optional().describe("Default 25"),
      order_by: z.enum(["name", "updated_at", "created_at", "warmth", "org"]).optional().describe("Default updated_at"),
    }),
    annotations: READ,
  }, async (args) => guard(() => withSb(sb => crm.searchContacts(sb, args))));

  server.registerTool("crm_get_contact", {
    title: "CRM: get contact",
    description: "Full CRM record for one contact: type and labels, warmth, status, pipeline entries, contact details, notes, interaction history, open tasks and stage history. Look up by contact_id, or by contact_name (+ org to disambiguate).",
    inputSchema: z.object({
      contact_id: z.string().optional().describe("CRM contact UUID"),
      contact_name: z.string().optional().describe("Name (fuzzy)"),
      org: z.string().optional().describe("Organization, to disambiguate"),
      include_interactions: z.boolean().optional().describe("Default true"),
      interaction_limit: z.number().int().min(1).max(50).optional().describe("Default 10"),
    }),
    annotations: READ,
  }, async (args) => guard(() => withSb(sb => crm.getContact(sb, args))));

  server.registerTool("crm_stale", {
    title: "CRM: who has gone quiet",
    description: "Contacts whose last logged interaction is older than their cadence, most overdue first. Same rule as harold_cadence_check: active or pending contacts with warmth Lukewarm, Warm or Hot; the cadence is the tightest stage cadence among their open pipeline entries, else Hot 7 days, Warm 14, Lukewarm 28; Hot or Warm with nothing logged is flagged too. Types in HAROLD_NO_CADENCE_TYPES (default other) and HAROLD_NO_LOG_TYPES are never checked. Read-only.",
    inputSchema: z.object({
      type: z.string().max(60).optional().describe("Only this contact type, e.g. investor or partner"),
      stale_days: z.number().int().min(1).max(365).optional().describe("Warm threshold in days (default 14; Lukewarm is twice this)"),
      hot_days: z.number().int().min(1).max(365).optional().describe("Hot threshold in days (default 7)"),
      limit: z.number().int().min(1).max(200).optional().describe("Maximum contacts listed (default 50)"),
    }),
    annotations: READ,
  }, async ({ type, stale_days, hot_days, limit }) => guard(() => withSb(sb => stale.staleText(sb, {
    skipTypes: stale.cadenceSkipTypes(noLogTypes()), type, staleDays: stale_days, hotDays: hot_days, limit, now: now(),
  }))));

  // ───────────── write ─────────────

  server.registerTool("harold_capture", {
    title: "Harold: remember this",
    description: "The default way to file something the owner says: appends a timestamped bullet to today's chat log, vault/daily/<date>-chat.md (created if needed; the date is in HAROLD_TZ). Use for facts, updates, decisions in passing, reminders. Say what you captured.",
    inputSchema: z.object({
      text: z.string().min(1).max(20_000).describe("What to remember, in plain words, with names and dates spelled out"),
      topic: z.string().max(80).optional().describe("Optional short tag, e.g. a project or person"),
    }),
    annotations: WRITE,
  }, async ({ text, topic }, ctx) => guard(() => kb.capture(deps.repoFor(ctx), text, topic, now())));

  server.registerTool("harold_note", {
    title: "Harold: new note",
    description: "Create a new durable note in the right vault folder: intel (vault/intel), decision (vault/decisions), meeting (vault/meetings), company (vault/companies) or project (vault/projects), with frontmatter (tags, date, last_updated). Refuses to overwrite an existing note; use harold_update to add to one.",
    inputSchema: z.object({
      kind: z.enum(kb.NOTE_KINDS).describe("intel | decision | meeting | company | project"),
      title: z.string().min(1).max(150).describe("Title; also becomes the file name"),
      body: z.string().min(1).max(60_000).describe("Markdown body"),
    }),
    annotations: WRITE,
  }, async ({ kind, title, body }, ctx) => guard(() => kb.note(deps.repoFor(ctx), kind, title, body, now())));

  server.registerTool("harold_update", {
    title: "Harold: update a note",
    description: "Add to an existing markdown file under vault/ or harold/ (append text under a named heading, or at the end) and/or change simple frontmatter fields such as warmth, status or last_updated. last_updated is refreshed automatically when the file has one. Refuses .jsonl files, AGENTS.md, bin/, tools/ and .github/.",
    inputSchema: z.object({
      path: z.string().min(1).max(400).describe("Repo-relative path, e.g. 'vault/people/Jane Doe.md'"),
      append_text: z.string().max(40_000).optional().describe("Markdown to append"),
      heading: z.string().max(120).optional().describe("Append under this heading (e.g. 'Timeline'); created at the end if missing"),
      frontmatter_updates: z.record(z.string(), z.string()).optional().describe("Simple key: value frontmatter changes, e.g. {\"warmth\": \"Warm\"}"),
    }),
    annotations: WRITE,
  }, async ({ path, append_text, heading, frontmatter_updates }, ctx) => guard(() => kb.update(deps.repoFor(ctx), path, { append_text, heading, frontmatter_updates }, now())));

  server.registerTool("harold_learning", {
    title: "Harold: record a lesson",
    description: "Record a lesson in harold/learnings.jsonl with the next free id (Lnnn, as `bin/harold file learning` assigns it), whenever the owner corrects a mistake or states a lasting preference, so future sessions inherit it. severity: critical for a factual or identity error or any repeat, warning for a process or scope error, info for a preference.",
    inputSchema: z.object({
      lesson: z.string().min(10).max(3000).describe("The lesson, stated so a future session can act on it"),
      severity: z.enum(SEVERITIES),
      category: z.enum(CATEGORIES),
      project: z.string().max(60).optional().describe("Project slug, or 'global' (default)"),
    }),
    annotations: WRITE,
  }, async (args, ctx) => guard(() => kb.learning(deps.repoFor(ctx), args, now())));

  server.registerTool("crm_log_interaction", {
    title: "CRM: log interaction",
    description: "Log a touchpoint (call, email, meeting, note, linkedin, other) with a contact. Refused for contact types listed in the optional HAROLD_NO_LOG_TYPES setting (empty by default, so nothing is refused unless the owner opted in). Also freshens the person's vault card.",
    inputSchema: z.object({
      contact_id: z.string().optional().describe("CRM contact UUID"),
      contact_name: z.string().optional().describe("Name (fuzzy), used when contact_id is not given"),
      org: z.string().optional().describe("Organization, to disambiguate"),
      type: z.enum(["call", "email", "meeting", "note", "linkedin", "other"]),
      subject: z.string().min(1).max(300).describe("Short subject"),
      body: z.string().max(20_000).optional().describe("Notes"),
      occurred_at: z.string().optional().describe("ISO datetime; default now"),
    }),
    annotations: WRITE,
  }, async (args, ctx) => guard(async () => {
    // HAROLD_NO_LOG_TYPES (optional): the vault card's type counts as well as the CRM type, as in
    // bin/harold, so a card typed as a no-log type blocks the log even if the CRM record is typed otherwise.
    if (args.contact_name && noLogTypes().length) {
      const card = await kb.personCard(deps.repoFor(ctx), args.contact_name).catch(() => null);
      if (card && kb.isNoLogCard(card.fm)) return { text: crm.NO_LOG_MESSAGE(card.path.slice("vault/people/".length, -3), kb.cardType(card.fm)), isError: true };
    }
    return withSb(async sb => vaultFollowUp(ctx, await crm.logInteraction(sb, args)));
  }));

  server.registerTool("crm_upsert_contact", {
    title: "CRM: create or update contact",
    description: "Create a contact or update one (by contact_id, or name + org). Type (category) is exactly one per contact, from the owner's own list (e.g. investor, partner, founder, team, other; default other); labels (categories) are any number of extra tags such as 'board' or 'advisor'. Warmth: Cold, Lukewarm, Warm, Hot, or empty (not rated). Status: active, pending, cold, archived. Never places anyone in the pipeline. Records may be kept current for every type, including types in HAROLD_NO_LOG_TYPES. Also freshens the person's vault card (not for types in HAROLD_NO_LOG_TYPES).",
    inputSchema: z.object({
      contact_id: z.string().optional(),
      name: z.string().min(1).max(120),
      org: z.string().max(200).optional(),
      category: z.string().trim().min(1).max(60).optional().describe("The one type, from the owner's own list (e.g. investor, partner, founder, team, other)"),
      categories: z.array(z.string().max(40)).max(10).optional().describe("Labels, e.g. ['board', 'advisor']"),
      warmth: z.enum(["", "Cold", "Lukewarm", "Warm", "Hot"]).optional(),
      status: z.enum(["active", "pending", "cold", "archived"]).optional(),
      priority: z.enum(["high", "medium", "low"]).optional(),
      email: z.string().max(200).optional(),
      phone: z.string().max(60).optional(),
      location: z.string().max(200).optional(),
      website: z.string().max(300).optional(),
      notes: z.string().max(10_000).optional(),
      region: z.string().max(100).optional(),
      investor_type: z.string().max(60).optional(),
      freshen_vault: z.boolean().optional().describe("Default true. false = do not touch the vault card (for a job that edits the card itself, e.g. the monthly audit)"),
    }),
    annotations: WRITE,
  }, async ({ freshen_vault, ...args }, ctx) => guard(() => withSb(async sb => {
    const r = await crm.upsertContact(sb, args);
    return freshen_vault === false ? r : vaultFollowUp(ctx, r);
  })));

  server.registerTool("crm_pipeline", {
    title: "CRM: pipeline",
    description: "The owner's ONE pipeline. add = put a contact in it for a stated purpose (required: why, e.g. 'seed round', 'pilot customer', 'advisor role'); move = change stage; close = done or gone (the record stays); list = who is where. Stages: Identified, Reached Out, In Conversation, Advancing, Committed, Active, Dormant. Never auto-place anyone: set a stage only when the conversation establishes it.",
    inputSchema: z.object({
      action: z.enum(["add", "move", "close", "list"]),
      contact_name: z.string().optional().describe("Required for add/move/close unless entry_id is given"),
      org: z.string().optional(),
      entry_id: z.string().optional().describe("Pipeline entry UUID, when a contact has more than one"),
      purpose: z.string().max(300).optional().describe("Why they are in the pipeline. Required for add."),
      project: z.string().max(80).optional().describe("Project slug from harold/projects.md"),
      stage: z.enum(crm.STAGES).optional(),
      outcome: z.string().max(500).optional().describe("How it ended (close)"),
      notes: z.string().max(2000).optional().describe("Why the stage changed"),
      filter_stage: z.enum(crm.STAGES).optional(),
      filter_project: z.string().optional(),
    }),
    annotations: WRITE,
  }, async (args, ctx) => guard(() => withSb(async sb => {
    const r = await crm.pipeline(sb, args);
    return args.action === "list" ? r : vaultFollowUp(ctx, r);
  })));

  server.registerTool("crm_task", {
    title: "CRM: follow-up task",
    description: "Create, update, complete, cancel or list contact-specific follow-up tasks (e.g. 'Send the deck to Jane Doe'). Project work that lives in a separate task manager belongs there instead.",
    inputSchema: z.object({
      action: z.enum(["create", "update", "complete", "cancel", "list"]),
      task_id: z.string().optional().describe("Required for update/complete/cancel"),
      contact_name: z.string().optional(),
      contact_id: z.string().optional(),
      org: z.string().optional(),
      title: z.string().max(300).optional().describe("Required for create"),
      description: z.string().max(5000).optional(),
      priority: z.enum(["high", "medium", "low"]).optional(),
      due_date: z.string().optional().describe("YYYY-MM-DD"),
      status: z.enum(["pending", "in_progress", "completed", "cancelled"]).optional(),
    }),
    annotations: WRITE,
  }, async (args, ctx) => guard(() => withSb(async sb => {
    const r = await crm.crmTask(sb, args);
    return args.action === "create" ? vaultFollowUp(ctx, r) : r;
  })));
}

export const TOOL_NAMES = [
  "harold_today", "harold_search", "harold_read", "harold_list", "harold_where", "harold_related", "harold_person", "crm_search_contacts", "crm_get_contact", "crm_stale",
  "harold_capture", "harold_note", "harold_update", "harold_learning", "crm_log_interaction", "crm_upsert_contact", "crm_pipeline", "crm_task",
];
