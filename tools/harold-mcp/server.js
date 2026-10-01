#!/usr/bin/env node

/**
 * Harold Memory Sync — MCP Server
 *
 * Provides atomic write tools for the Harold knowledge base.
 * Any Claude session (Code or Cowork) can call these to persist
 * information without relying on the AI to "remember" to update markdown.
 *
 * Tools:
 *   harold_log              — Append an entry to context-log.md
 *   harold_fact             — Add or update a fact in facts.md
 *   harold_alert            — Add or update an alert in alerts.md
 *   harold_blocker          — Add or update a blocker in blockers.md
 *   harold_event            — Add or update an event in events.md
 *   harold_read             — Read any Harold file (for verification)
 *   harold_alerts_sync      — Compute derived alerts (events + blockers + CRM tasks)
 *   harold_cadence_check    — Quick cadence review from CRM
 *   harold_log_interaction  — Log a CRM interaction (call, email, meeting, etc.)
 *   harold_upsert_contact   — Create or update a CRM contact
 *   harold_search_contacts  — Search/filter CRM contacts by any field combination
 *   harold_get_contact      — Full contact profile + interaction history + tasks
 *   harold_pipeline         — One generic pipeline: add/move/close/list, purpose-bound
 *   harold_crm_task         — Create/update/complete/cancel/list CRM tasks
 *
 * Configuration (environment only; bin/harold-mcp loads ~/.harold/env for you):
 *   SUPABASE_URL                https://<project-ref>.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY   the service_role key (never commit it)
 *   HAROLD_ROOT / HAROLD_BASE   workspace root (default: two levels above this file)
 *   HAROLD_NO_LOG_TYPES         optional: contact types whose conversations are never logged
 *                               (harold_log_interaction refuses them). Empty by default.
 *   HAROLD_NO_CADENCE_TYPES     contact types that never get staleness alerts (default: other).
 *                               Types in HAROLD_NO_LOG_TYPES are skipped too.
 * Database: tools/harold-mcp/schema.sql creates exactly the tables and columns this file uses.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

// Harold workspace root — env, else the workspace this server lives in (tools/harold-mcp/ → ../..)
const HAROLD_BASE = process.env.HAROLD_ROOT || process.env.HAROLD_BASE || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const HAROLD_DIR = path.join(HAROLD_BASE, "harold");

// ── CRM (Supabase) Connection ───────────────────────────────────
// No fallback values: a wrong URL fails silently, a missing one says so, loudly.
const SUPABASE_URL = (process.env.SUPABASE_URL || "").trim();
const SUPABASE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const CRM_MISSING = [!SUPABASE_URL && "SUPABASE_URL", !SUPABASE_KEY && "SUPABASE_SERVICE_ROLE_KEY"].filter(Boolean);
const CRM_NOT_CONFIGURED = `Error: CRM not configured — ${CRM_MISSING.join(" and ")} ${CRM_MISSING.length > 1 ? "are" : "is"} not set. ` +
  "Put them in ~/.harold/env (run bin/harold-setup-crm) and launch this server through bin/harold-mcp, then restart the session. " +
  "Until then, queue CRM work with: bin/harold file crm '<json>'. The markdown tools (harold_log, harold_fact, harold_alert, harold_blocker, harold_event, harold_read) still work.";
if (CRM_MISSING.length) {
  console.error("\n" + "!".repeat(78) + "\n!! harold-mcp: CRM DISABLED. Missing: " + CRM_MISSING.join(", ") + "\n!! Set them in ~/.harold/env (bin/harold-setup-crm) and start the server via bin/harold-mcp.\n" + "!".repeat(78) + "\n");
}
// Optional, off by default: contact types whose conversations are never logged as interactions
// (for example, some people choose never to log conversations with their own team). Their records
// are still kept current; harold_log_interaction refuses them.
const typeList = v => (v || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
const NO_LOG_TYPES = typeList(process.env.HAROLD_NO_LOG_TYPES);
// Contact types that never get staleness alerts: HAROLD_NO_CADENCE_TYPES (default: other), plus the
// no-log types, whose last-contact date would otherwise look stale forever.
const NO_CADENCE_TYPES = [...new Set([...typeList(process.env.HAROLD_NO_CADENCE_TYPES ?? "other"), ...NO_LOG_TYPES])];

let _supabase = null;
function getSupabase() {
  if (!_supabase && !CRM_MISSING.length) {
    _supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  }
  return _supabase;
}

/**
 * Query CRM for contacts whose relationship is going stale — contacts
 * we HAVE a relationship with but haven't engaged recently.
 * This is the universal "freshness" detector: works for ANY contact type.
 *
 * IMPORTANT — Warmth vs Freshness:
 *   Warmth = relationship closeness (cold/lukewarm/warm/hot). A STATE label.
 *     - Cold = no connection, don't know them
 *     - Lukewarm = some connection, kind of know them
 *     - Warm = established relationship, know them well
 *     - Hot = actively engaged, things moving forward
 *   Freshness = recency of last contact. A TIME metric.
 *
 * Staleness alerts only make sense for contacts we actually have a
 * relationship with (lukewarm+). Cold contacts need an outreach strategy,
 * not a "you haven't talked to them" nudge. And the warmer the relationship,
 * the MORE urgent it is to maintain freshness — hot contacts going quiet
 * is a bigger problem than lukewarm ones.
 *
 * @param {number} staleDays - Base threshold for freshness (default 14)
 * @param {number} hotDays   - Threshold for hot contacts (default 7, tighter)
 * @returns {Object} Stale contacts with category, warmth, last interaction info
 */
async function queryStaleCrmContacts(staleDays = 14, hotDays = 7) {
  const supabase = getSupabase();
  if (!supabase) return { contacts: [], source: "crm_unavailable" };

  try {
    // Load pipeline stage cadence thresholds (pipeline-aware freshness)
    const cadenceMap = {}; // { "Reached Out": 7, "Committed": 14, ... } — keyed by stage name
    const cadenceToDays = { weekly: 7, biweekly: 14, monthly: 30, quarterly: 90 };
    const { data: stages } = await supabase
      .from("pipeline_stages")
      .select("stage_name, default_cadence");
    if (stages) {
      for (const s of stages) {
        if (s.default_cadence && cadenceToDays[s.default_cadence]) {
          cadenceMap[s.stage_name] = cadenceToDays[s.default_cadence];
        }
      }
    }

    // Get active contacts with their categories and latest interaction
    const { data: contacts, error: contactsErr } = await supabase
      .from("contacts")
      .select(`
        id, name, org, category, warmth, status, priority,
        contact_categories ( category_name ),
        contact_pipelines ( stage, purpose, project ),
        interactions ( occurred_at, type, subject )
      `)
      .in("status", ["active", "pending"])
      .order("name");

    if (contactsErr) throw contactsErr;
    if (!contacts || !contacts.length) return { contacts: [], source: "crm_empty" };

    const now = new Date();
    const staleContacts = [];

    for (const contact of contacts) {
      // Determine categories (from junction table + legacy field)
      const categories = (contact.contact_categories || []).map(cc => cc.category_name);
      if (contact.category && !categories.includes(contact.category)) {
        categories.push(contact.category);
      }

      // Skip non-outreach types (HAROLD_NO_CADENCE_TYPES, default other, plus HAROLD_NO_LOG_TYPES)
      if (categories.every(c => NO_CADENCE_TYPES.includes(String(c).toLowerCase()))) continue;

      const warmth = (contact.warmth || "").toLowerCase();

      // COLD contacts don't get freshness alerts — they need outreach strategy, not nudges.
      // We only track freshness for contacts we have some relationship with (lukewarm+).
      if (warmth === "cold" || warmth === "") continue;

      // Find most recent interaction
      const interactions = contact.interactions || [];
      let lastInteraction = null;
      let lastInteractionDate = null;
      if (interactions.length > 0) {
        interactions.sort((a, b) => new Date(b.occurred_at) - new Date(a.occurred_at));
        lastInteraction = interactions[0];
        lastInteractionDate = new Date(lastInteraction.occurred_at);
      }

      // Calculate days since last interaction
      const daysSince = lastInteractionDate
        ? Math.ceil((now - lastInteractionDate) / (1000 * 60 * 60 * 24))
        : null; // null = never contacted (in CRM)

      // Freshness thresholds — pipeline cadence takes priority, then warmth-based:
      //   1. If contact has pipeline stages with default_cadence → use the tightest one
      //   2. Otherwise fall back to warmth-based thresholds:
      //      Hot → hotDays (default 7)
      //      Warm → staleDays (default 14)
      //      Lukewarm → staleDays * 2 (default 28)
      let threshold;

      // Check junction table pipelines first, then legacy column
      const pipelines = (contact.contact_pipelines || []);
      let tightestCadence = null;
      for (const cp of pipelines) {
        const key = cp.stage;
        if (cadenceMap[key] && (tightestCadence === null || cadenceMap[key] < tightestCadence)) {
          tightestCadence = cadenceMap[key];
        }
      }

      if (tightestCadence !== null) {
        threshold = tightestCadence;
      } else if (warmth === "hot") {
        threshold = hotDays;
      } else if (warmth === "warm") {
        threshold = staleDays;
      } else {
        threshold = staleDays * 2; // lukewarm
      }

      // Is this contact going stale?
      // If daysSince is null (never contacted in CRM), flag hot/warm contacts
      // because we have a relationship but no recorded interactions — likely a data gap.
      const isStale = daysSince === null
        ? (warmth === "hot" || warmth === "warm")
        : daysSince >= threshold;

      if (isStale) {
        const pipelineEntries = pipelines.length > 0
          ? pipelines.map(cp => ({ stage: cp.stage, purpose: cp.purpose, project: cp.project }))
          : [];

        staleContacts.push({
          id: contact.id,
          name: contact.name,
          org: contact.org || "",
          categories,
          warmth: contact.warmth || "",
          pipelines: pipelineEntries,
          pipelineEntries: pipelines.map(cp => ({ stage: cp.stage, purpose: cp.purpose, project: cp.project })),
          priority: contact.priority || "medium",
          status: contact.status,
          daysSinceContact: daysSince,
          lastInteractionType: lastInteraction?.type || null,
          lastInteractionSubject: lastInteraction?.subject || null,
          threshold,
        });
      }
    }

    return { contacts: staleContacts, source: "crm" };
  } catch (err) {
    console.error("CRM query error:", err.message);
    return { contacts: [], source: "crm_error", error: err.message };
  }
}

/**
 * Query CRM for overdue and upcoming tasks.
 * Tasks are optional in the CRM — Linear is the primary task system.
 * CRM tasks capture contact-specific follow-ups that don't warrant a Linear ticket.
 */
async function queryCrmTasks(daysAhead = 7) {
  const supabase = getSupabase();
  if (!supabase) return { overdue: [], upcoming: [], source: "crm_unavailable" };

  try {
    const now = new Date();
    const futureDate = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);

    const { data: tasks, error } = await supabase
      .from("tasks")
      .select(`
        id, title, description, status, priority, due_date,
        contacts ( id, name, org, category, warmth )
      `)
      .in("status", ["pending", "in_progress"])
      .not("due_date", "is", null)
      .lte("due_date", futureDate.toISOString())
      .order("due_date");

    if (error) throw error;
    if (!tasks || !tasks.length) return { overdue: [], upcoming: [], source: "crm_no_tasks" };

    const overdue = [];
    const upcoming = [];

    // Compare calendar days only, avoiding timezone shifts.
    // due_date is stored as "YYYY-MM-DD" — parse the string directly
    // instead of using new Date() which interprets it as UTC midnight
    // and shifts backward in US timezones (e.g., Feb 20 UTC = Feb 19 EST).
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

    for (const task of tasks) {
      const dueStr = (task.due_date || "").slice(0, 10);  // "YYYY-MM-DD"
      // Parse both as local-midnight dates from their string components
      const [tY, tM, tD] = todayStr.split("-").map(Number);
      const [dY, dM, dD] = dueStr.split("-").map(Number);
      const todayLocal = new Date(tY, tM - 1, tD);
      const dueLocal = new Date(dY, dM - 1, dD);
      const diff = Math.round((dueLocal - todayLocal) / (1000 * 60 * 60 * 24));
      const contact = task.contacts || {};
      const item = {
        id: task.id,
        title: task.title,
        priority: task.priority,
        dueDate: task.due_date,
        daysDiff: diff,
        contactName: contact.name || "",
        contactOrg: contact.org || "",
        contactCategory: contact.category || "",
        contactWarmth: contact.warmth || "",
      };
      if (diff < 0) overdue.push(item);
      else upcoming.push(item);
    }

    return { overdue, upcoming, source: "crm" };
  } catch (err) {
    console.error("CRM tasks query error:", err.message);
    return { overdue: [], upcoming: [], source: "crm_error", error: err.message };
  }
}

// Helpers
function readFile(filePath) {
  const full = filePath.startsWith("/") ? filePath : path.join(HAROLD_BASE, filePath);
  if (!fs.existsSync(full)) return null;
  return fs.readFileSync(full, "utf-8");
}

function appendToFile(filePath, content) {
  const full = filePath.startsWith("/") ? filePath : path.join(HAROLD_BASE, filePath);
  fs.appendFileSync(full, content, "utf-8");
  return true;
}

function writeFile(filePath, content) {
  const full = filePath.startsWith("/") ? filePath : path.join(HAROLD_BASE, filePath);
  fs.writeFileSync(full, content, "utf-8");
  return true;
}

function today() {
  return new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD
}

function now() {
  return new Date().toISOString();
}

/**
 * Find the section for today's date in context-log.md.
 * If it exists, append under it. If not, create a new date header.
 */
function appendContextLog(title, body) {
  const logPath = path.join(HAROLD_DIR, "context-log.md");
  const content = readFile(logPath) || "# Harold Context Log\n\n";

  const dateStr = new Date().toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric"
  });
  const dateHeader = `## ${dateStr}`;

  const entry = `\n### ${title}\n\n**Logged:** ${now()}\n\n${body}\n`;

  // Check if today's date section exists
  if (content.includes(dateHeader)) {
    // Find the date header and insert after it (before the next ## or end)
    const headerIdx = content.indexOf(dateHeader);
    const afterHeader = content.indexOf("\n", headerIdx) + 1;

    // Find the next date section (## followed by a month name)
    const nextSection = content.indexOf("\n## ", afterHeader);

    if (nextSection === -1) {
      // No next section — append to end
      writeFile(logPath, content + entry);
    } else {
      // Insert before next section
      const before = content.slice(0, nextSection);
      const after = content.slice(nextSection);
      writeFile(logPath, before + entry + after);
    }
  } else {
    // Create new date section at the top (after the main header and first ---)
    const firstDivider = content.indexOf("---");
    if (firstDivider !== -1) {
      const insertPoint = content.indexOf("\n", firstDivider) + 1;
      const before = content.slice(0, insertPoint);
      const after = content.slice(insertPoint);
      writeFile(logPath, before + `\n${dateHeader}\n` + entry + "\n---\n" + after);
    } else {
      // No divider — just append
      writeFile(logPath, content + `\n${dateHeader}\n` + entry);
    }
  }

  return `Logged to context-log.md under ${dateStr}: "${title}"`;
}

/**
 * Update or insert a row in a markdown table within a file.
 * Uses a key column to find existing rows for update.
 */
function upsertTableRow(filePath, sectionPattern, columns, keyColumn, keyValue) {
  const full = path.join(HAROLD_DIR, filePath);
  let content = readFile(full);
  if (!content) return `Error: ${filePath} not found`;

  // Build the new row
  const row = "| " + columns.join(" | ") + " |";

  // Try to find an existing row with the key value
  const lines = content.split("\n");
  let found = false;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("|") && lines[i].includes(keyValue)) {
      // Parse existing row to check key column matches
      const cells = lines[i].split("|").map(c => c.trim()).filter(c => c);
      if (cells[keyColumn] && cells[keyColumn].includes(keyValue)) {
        lines[i] = row;
        found = true;
        break;
      }
    }
  }

  if (found) {
    writeFile(full, lines.join("\n"));
    return `Updated existing row for "${keyValue}" in ${filePath}`;
  }

  // Insert new row — find the section and append after the table header
  const sectionIdx = content.indexOf(sectionPattern);
  if (sectionIdx === -1) {
    // Section not found — append to end of file
    appendToFile(full, "\n" + row + "\n");
    return `Appended new row for "${keyValue}" to end of ${filePath} (section "${sectionPattern}" not found)`;
  }

  // Find the table in this section: its separator row starts with "|---" (any number of dashes)
  const afterSection = content.indexOf("|---", sectionIdx);
  if (afterSection === -1) {
    appendToFile(full, "\n" + row + "\n");
    return `Appended new row for "${keyValue}" to end of ${filePath} (no table found in section)`;
  }

  // Find end of the header separator line
  const endOfSeparator = content.indexOf("\n", afterSection) + 1;

  // Find the end of the table (next empty line or section header)
  let tableEnd = endOfSeparator;
  const restLines = content.slice(endOfSeparator).split("\n");
  for (const line of restLines) {
    if (line.startsWith("|")) {
      tableEnd += line.length + 1;
    } else {
      break;
    }
  }

  // Insert at end of table
  const before = content.slice(0, tableEnd);
  const after = content.slice(tableEnd);
  writeFile(full, before + row + "\n" + after);
  return `Added new row for "${keyValue}" in ${filePath}`;
}

// Create server
const server = new McpServer({
  name: "harold-memory-sync",
  version: "1.0.0",
});

// ── Tool: harold_log ──────────────────────────────────────────────
server.tool(
  "harold_log",
  "Append an entry to the Harold context log (context-log.md). Use for decisions, confirmations, meeting notes, corrections, or any context worth preserving across sessions.",
  {
    title: z.string().describe("Short title for the log entry (e.g., 'Partner intro emails confirmed sent')"),
    body: z.string().describe("Full content of the log entry. Markdown supported. Include who, what, when, source."),
    tags: z.array(z.string()).optional().describe("Optional tags for searchability (e.g., ['investor', 'outreach', 'acme'])"),
  },
  async ({ title, body, tags }) => {
    try {
      let fullBody = body;
      if (tags && tags.length > 0) {
        fullBody += `\n\n**Tags:** ${tags.join(", ")}`;
      }
      const result = appendContextLog(title, fullBody);
      return { content: [{ type: "text", text: result }] };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
    }
  }
);

// ── Tool: harold_fact ─────────────────────────────────────────────
server.tool(
  "harold_fact",
  "Add or update a fact in the Harold facts repository (facts.md). Use for new contacts, updated preferences, corrected information, new metrics, or any discrete queryable fact.",
  {
    section: z.string().describe("Which section of facts.md to update (e.g., 'Investor Contacts', 'Numbers — Key Metrics', 'Preferences', 'Commitments')"),
    key: z.string().describe("The primary identifier for this fact — usually a person name, company name, or metric name"),
    columns: z.array(z.string()).describe("All column values for the table row, in order. Must match the table's column count."),
    key_column_index: z.number().default(0).describe("Which column (0-indexed) contains the key for matching existing rows. Default 0."),
  },
  async ({ section, key, columns, key_column_index }) => {
    try {
      const result = upsertTableRow("facts.md", section, columns, key_column_index, key);
      // Update the last-updated footer
      const factsPath = path.join(HAROLD_DIR, "facts.md");
      let content = readFile(factsPath);
      const lastUpdatedPattern = /\*Last updated:.*\*/;
      const newTimestamp = `*Last updated: ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })} (via harold-mcp)*`;
      if (lastUpdatedPattern.test(content)) {
        content = content.replace(lastUpdatedPattern, newTimestamp);
        writeFile(factsPath, content);
      }
      return { content: [{ type: "text", text: result }] };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
    }
  }
);

// ── Tool: harold_alert ────────────────────────────────────────────
server.tool(
  "harold_alert",
  "Add, update, or resolve an alert in Harold alerts (alerts.md). Use when a status changes, a new warning needs to surface, or an alert is resolved.",
  {
    action: z.enum(["add", "update", "resolve"]).describe("add = new alert, update = modify existing, resolve = move to history"),
    severity: z.enum(["urgent", "warning", "watch"]).describe("Alert severity: urgent (🔴), warning (🟠), or watch (🟡)"),
    alert_name: z.string().describe("Short name identifying the alert (used for matching on update/resolve)"),
    context: z.string().describe("Full context/description of the alert"),
    suggested_action: z.string().optional().describe("What should be done about this alert"),
    resolution: z.string().optional().describe("For resolve action: what resolved it"),
  },
  async ({ action, severity, alert_name, context, suggested_action, resolution }) => {
    try {
      const alertsPath = path.join(HAROLD_DIR, "alerts.md");
      let content = readFile(alertsPath);
      if (!content) return { content: [{ type: "text", text: "Error: alerts.md not found" }], isError: true };

      const severityEmoji = { urgent: "🔴", warning: "🟠", watch: "🟡" };
      const severityLabel = { urgent: "URGENT", warning: "WARNING", watch: "WATCH" };

      if (action === "resolve") {
        // Remove from current alerts and add to history
        const lines = content.split("\n");
        const filtered = lines.filter(line => !line.includes(alert_name));
        content = filtered.join("\n");

        // Add to Alert History
        const historySection = "## Alert History";
        const historyIdx = content.indexOf(historySection);
        if (historyIdx !== -1) {
          const tableStart = content.indexOf("|---", historyIdx);
          if (tableStart !== -1) {
            const endOfSep = content.indexOf("\n", tableStart) + 1;
            const historyRow = `| ${today()} | ${alert_name} | ${resolution || "Resolved"} |\n`;
            content = content.slice(0, endOfSep) + historyRow + content.slice(endOfSep);
          }
        }

        writeFile(alertsPath, content);
        return { content: [{ type: "text", text: `Resolved alert: "${alert_name}" → moved to history` }] };

      } else if (action === "add") {
        // Find the right severity section and add the row
        const sectionHeader = `### ${severityEmoji[severity]} ${severityLabel[severity]}`;
        const sectionIdx = content.indexOf(sectionHeader);

        if (sectionIdx === -1) {
          return { content: [{ type: "text", text: `Error: Section "${sectionHeader}" not found in alerts.md` }], isError: true };
        }

        // Find the table in this section
        const tableStart = content.indexOf("|---", sectionIdx);
        if (tableStart === -1) {
          return { content: [{ type: "text", text: `Error: No table found under ${sectionHeader}` }], isError: true };
        }

        // Find end of table
        const endOfSep = content.indexOf("\n", tableStart) + 1;
        let tableEnd = endOfSep;
        const rest = content.slice(endOfSep).split("\n");
        for (const line of rest) {
          if (line.startsWith("|")) {
            tableEnd += line.length + 1;
          } else {
            break;
          }
        }

        const newRow = `| **${alert_name}** | ${context} | ${suggested_action || "—"} |\n`;
        content = content.slice(0, tableEnd) + newRow + content.slice(tableEnd);
        writeFile(alertsPath, content);
        return { content: [{ type: "text", text: `Added ${severityEmoji[severity]} ${severityLabel[severity]} alert: "${alert_name}"` }] };

      } else {
        // update — find and replace the row
        const lines = content.split("\n");
        let updated = false;
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes(alert_name) && lines[i].startsWith("|")) {
            lines[i] = `| **${alert_name}** | ${context} | ${suggested_action || "—"} |`;
            updated = true;
            break;
          }
        }
        if (updated) {
          writeFile(alertsPath, lines.join("\n"));
          return { content: [{ type: "text", text: `Updated alert: "${alert_name}"` }] };
        } else {
          return { content: [{ type: "text", text: `Alert "${alert_name}" not found for update. Use action="add" to create it.` }] };
        }
      }
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
    }
  }
);

// ── Tool: harold_blocker ──────────────────────────────────────────
// Rows are written in the format bin/harold boot parses (and parseBlockersTable below):
//   ## Current Blockers
//   | ID | Project | Blocker | Waiting On | Raised | Last Update |
// IDs are plain (B004, not **B004**) and Raised is kept on update, because boot measures a
// blocker's age from it. Resolved rows go under ## Resolved: | ID | Project | Blocker | Resolution | Resolved |
function blockerDate(d = new Date()) {
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }); // "Sep 26, 2026"
}
function findBlockerRow(lines, blockerId) {
  const re = new RegExp("^\\|\\s*\\**" + blockerId.replace(/[^A-Za-z0-9]/g, "") + "\\**\\s*\\|");
  return lines.findIndex(line => re.test(line));
}
server.tool(
  "harold_blocker",
  "Add, update, or resolve a blocker in Harold blockers (blockers.md). Use when something is stuck, waiting on someone, or when a blocker is cleared. Rows are written in the format bin/harold boot reads (ID | Project | Blocker | Waiting On | Raised | Last Update); boot computes each blocker's age from Raised and makes escalation due after 7 days.",
  {
    action: z.enum(["add", "update", "resolve"]).describe("add = new blocker, update = modify, resolve = move to ## Resolved"),
    blocker_id: z.string().describe("Blocker ID (e.g., 'B011'). For new blockers, assign the next sequential ID (one higher than any ID in either table)."),
    description: z.string().describe("What's blocked and why"),
    project: z.string().optional().describe("Project name from harold/projects.md"),
    dependency: z.string().optional().describe("What/who this is waiting on"),
    update: z.string().optional().describe("Latest status note (the Last Update column)"),
    resolution: z.string().optional().describe("For resolve action: how it was resolved"),
  },
  async ({ action, blocker_id, description, project, dependency, update, resolution }) => {
    try {
      const blockerPath = path.join(HAROLD_DIR, "blockers.md");
      let content = readFile(blockerPath);
      if (!content) return { content: [{ type: "text", text: "Error: blockers.md not found" }], isError: true };
      const id = blocker_id.replace(/\*/g, "").trim();
      const lines = content.split("\n");
      const idx = findBlockerRow(lines, id);
      const cellsOf = i => lines[i].split("|").slice(1, -1).map(c => c.trim());

      if (action === "resolve") {
        if (idx === -1) return { content: [{ type: "text", text: `Blocker ${id} not found.` }], isError: true };
        const old = cellsOf(idx);
        lines.splice(idx, 1);
        content = lines.join("\n");
        const resolvedIdx = content.search(/^##\s*Resolved/m);
        if (resolvedIdx !== -1) {
          const tableStart = content.indexOf("|---", resolvedIdx);
          if (tableStart !== -1) {
            const endOfSep = content.indexOf("\n", tableStart) + 1;
            const resolvedRow = `| ${id} | ${project || old[1] || "—"} | ${description || old[2] || "—"} | ${resolution || "Resolved"} | ${blockerDate()} |\n`;
            content = content.slice(0, endOfSep) + resolvedRow + content.slice(endOfSep);
          }
        }
        writeFile(blockerPath, content);
        return { content: [{ type: "text", text: `Resolved blocker ${id}: ${resolution || description}` }] };
      }

      if (action === "add") {
        if (idx !== -1) return { content: [{ type: "text", text: `Blocker ${id} already exists. Use action="update", or pick the next free ID.` }], isError: true };
        const sectionIdx = content.indexOf("## Current Blockers");
        if (sectionIdx === -1) return { content: [{ type: "text", text: "Error: '## Current Blockers' section not found in blockers.md" }], isError: true };
        const tableStart = content.indexOf("|---", sectionIdx);
        if (tableStart === -1) return { content: [{ type: "text", text: "Error: No table found in Current Blockers section" }], isError: true };
        let tableEnd = content.indexOf("\n", tableStart) + 1;
        for (const line of content.slice(tableEnd).split("\n")) {
          if (line.startsWith("|")) tableEnd += line.length + 1; else break;
        }
        const newRow = `| ${id} | ${project || "—"} | ${description} | ${dependency || "—"} | ${blockerDate()} | ${update || "—"} |\n`;
        content = content.slice(0, tableEnd) + newRow + content.slice(tableEnd);
        writeFile(blockerPath, content);
        return { content: [{ type: "text", text: `Added blocker ${id}: "${description}"` }] };
      }

      // update — keep the Raised date (the age is measured from it)
      if (idx === -1) return { content: [{ type: "text", text: `Blocker ${id} not found. Use action="add".` }] };
      const old = cellsOf(idx);
      lines[idx] = `| ${id} | ${project || old[1] || "—"} | ${description || old[2] || "—"} | ${dependency || old[3] || "—"} | ${old[4] || blockerDate()} | ${update || old[5] || "—"} |`;
      writeFile(blockerPath, lines.join("\n"));
      return { content: [{ type: "text", text: `Updated blocker ${id}` }] };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
    }
  }
);

// ── Tool: harold_event ────────────────────────────────────────────
server.tool(
  "harold_event",
  "Add or update an event in Harold events tracker (events.md). Use for new events, date changes, or prep status updates.",
  {
    action: z.enum(["add", "update", "complete"]).describe("add = new event, update = change details, complete = move to archive"),
    event_name: z.string().describe("Event name (used for matching)"),
    dates: z.string().optional().describe("Event date(s)"),
    project: z.string().optional().describe("Associated project"),
    linear_task: z.string().optional().describe("Linear task ID if applicable"),
    prep_status: z.enum(["Not Started", "In Progress", "Complete"]).optional().describe("Prep status"),
    debrief_due: z.string().optional().describe("Debrief due date"),
    notes: z.string().optional().describe("Additional notes"),
  },
  async ({ action, event_name, dates, project, linear_task, prep_status, debrief_due, notes }) => {
    try {
      const eventsPath = path.join(HAROLD_DIR, "events.md");
      let content = readFile(eventsPath);
      if (!content) return { content: [{ type: "text", text: "Error: events.md not found" }], isError: true };

      if (action === "complete") {
        // Remove from upcoming, add to completed
        const lines = content.split("\n");
        let removedLine = "";
        const filtered = lines.filter(line => {
          if (line.includes(event_name) && line.startsWith("|")) {
            removedLine = line;
            return false;
          }
          return true;
        });
        content = filtered.join("\n");

        const completedSection = "## Completed Events";
        const completedIdx = content.indexOf(completedSection);
        if (completedIdx !== -1) {
          const tableStart = content.indexOf("|---", completedIdx);
          if (tableStart !== -1) {
            const endOfSep = content.indexOf("\n", tableStart) + 1;
            const completedRow = `| **${event_name}** | ${dates || "—"} | ${prep_status || "Complete"} | ${notes ? "Complete" : "Not Started"} | ${notes || "—"} |\n`;
            content = content.slice(0, endOfSep) + completedRow + content.slice(endOfSep);
          }
        }

        writeFile(eventsPath, content);
        return { content: [{ type: "text", text: `Completed event: "${event_name}" → moved to archive` }] };

      } else if (action === "add") {
        const upcomingSection = "## Upcoming Events";
        const sectionIdx = content.indexOf(upcomingSection);
        if (sectionIdx === -1) {
          return { content: [{ type: "text", text: "Error: 'Upcoming Events' section not found" }], isError: true };
        }

        const tableStart = content.indexOf("|---", sectionIdx);
        if (tableStart === -1) {
          return { content: [{ type: "text", text: "Error: No table found in Upcoming Events" }], isError: true };
        }

        let tableEnd = content.indexOf("\n", tableStart) + 1;
        const rest = content.slice(tableEnd).split("\n");
        for (const line of rest) {
          if (line.startsWith("|")) {
            tableEnd += line.length + 1;
          } else {
            break;
          }
        }

        const newRow = `| **${event_name}** | ${dates || "TBD"} | ${project || "—"} | ${linear_task || "—"} | ${prep_status || "Not Started"} | ${debrief_due || "—"} | — |\n`;
        content = content.slice(0, tableEnd) + newRow + content.slice(tableEnd);
        writeFile(eventsPath, content);
        return { content: [{ type: "text", text: `Added event: "${event_name}" on ${dates || "TBD"}` }] };

      } else {
        // update
        const lines = content.split("\n");
        let updated = false;
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes(event_name) && lines[i].startsWith("|")) {
            lines[i] = `| **${event_name}** | ${dates || "TBD"} | ${project || "—"} | ${linear_task || "—"} | ${prep_status || "Not Started"} | ${debrief_due || "—"} | — |`;
            updated = true;
            break;
          }
        }
        if (updated) {
          writeFile(eventsPath, lines.join("\n"));
          return { content: [{ type: "text", text: `Updated event: "${event_name}"` }] };
        }
        return { content: [{ type: "text", text: `Event "${event_name}" not found. Use action="add".` }] };
      }
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
    }
  }
);

// ── Tool: harold_read ─────────────────────────────────────────────
server.tool(
  "harold_read",
  "Read a Harold knowledge base file. Use for verification after writes, or quick lookups without parsing markdown manually.",
  {
    file: z.enum([
      "context-log.md", "facts.md", "alerts.md", "blockers.md",
      "events.md", "projects.md", "sync-map.md"
    ]).describe("Which Harold file to read"),
    search: z.string().optional().describe("Optional: search for lines containing this text (case-insensitive)"),
    lines: z.number().default(50).describe("Max lines to return (default 50, from start of file or search results)"),
  },
  async ({ file, search, lines }) => {
    try {
      const content = readFile(path.join(HAROLD_DIR, file));
      if (!content) return { content: [{ type: "text", text: `File not found: harold/${file}` }], isError: true };

      if (search) {
        const searchLower = search.toLowerCase();
        const matchingLines = content.split("\n")
          .filter(line => line.toLowerCase().includes(searchLower))
          .slice(0, lines);

        if (matchingLines.length === 0) {
          return { content: [{ type: "text", text: `No matches for "${search}" in ${file}` }] };
        }
        return { content: [{ type: "text", text: `Found ${matchingLines.length} matches for "${search}" in ${file}:\n\n${matchingLines.join("\n")}` }] };
      }

      const truncated = content.split("\n").slice(0, lines).join("\n");
      return { content: [{ type: "text", text: truncated }] };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
    }
  }
);

// ── Alerts Engine Helpers ─────────────────────────────────────────

/**
 * Parse a date string into a Date object.
 * Handles: "Feb 24-25, 2026", "Mar 4, 2026", "Apr 23, 2026 (FIXED)",
 * "Aug 2026 (TBD)", "TBD", "Jan 26", "Feb 19", and ISO dates.
 * Short dates without year default to current year.
 */
function parseEventDate(dateStr) {
  if (!dateStr || dateStr === "TBD" || dateStr.includes("TBD")) return null;
  let clean = dateStr.replace(/\s*\(.*?\)\s*/g, "").replace(/\*+/g, "").trim();
  // Date ranges: "Feb 24-25, 2026" → use start date
  const rangeMatch = clean.match(/^(\w+) (\d+)-\d+,?\s*(\d{4})/);
  if (rangeMatch) clean = `${rangeMatch[1]} ${rangeMatch[2]}, ${rangeMatch[3]}`;
  clean = clean.replace(/\s*\(pre-summit.*\)/i, "");
  // Short dates without year: "Jan 26" → "Jan 26, 2026"
  const shortDateMatch = clean.match(/^(\w{3,9})\s+(\d{1,2})$/);
  if (shortDateMatch) {
    const year = new Date().getFullYear();
    clean = `${shortDateMatch[1]} ${shortDateMatch[2]}, ${year}`;
  }
  // Month + year only: "Aug 2026" → first of month
  const monthYearMatch = clean.match(/^(\w{3,9})\s+(\d{4})$/);
  if (monthYearMatch) {
    clean = `${monthYearMatch[1]} 1, ${monthYearMatch[2]}`;
  }
  const d = new Date(clean);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Parse the Upcoming Events table from events.md.
 */
function parseEventsTable(content) {
  const events = [];
  const idx = content.indexOf("## Upcoming Events");
  if (idx === -1) return events;
  const sep = content.indexOf("|---", idx);
  if (sep === -1) return events;
  const afterSep = content.indexOf("\n", sep) + 1;
  const lines = content.slice(afterSep).split("\n");
  for (const line of lines) {
    if (!line.startsWith("|")) break;
    const cells = line.split("|").map(c => c.trim()).filter(c => c);
    if (cells.length >= 5) {
      events.push({
        name: cells[0].replace(/\*+/g, ""),
        dateStr: cells[1].replace(/\*+/g, ""),
        date: parseEventDate(cells[1]),
        project: cells[2],
        linearTask: cells[3],
        prepStatus: cells[4].replace(/\*+/g, ""),
        debriefDue: cells[5] || "—",
        debriefStatus: cells[6] || "—",
      });
    }
  }
  return events;
}

/**
 * Parse the Active Blockers table from blockers.md.
 */
function parseBlockersTable(content) {
  const blockers = [];
  const idx = content.indexOf("## Current Blockers");
  if (idx === -1) return blockers;
  const sep = content.indexOf("|---", idx);
  if (sep === -1) return blockers;
  const afterSep = content.indexOf("\n", sep) + 1;
  const lines = content.slice(afterSep).split("\n");
  for (const line of lines) {
    if (!line.startsWith("|")) break;
    const cells = line.split("|").map(c => c.trim()).filter(c => c);
    if (cells.length >= 4) {
      const raisedStr = (cells[4] || "").replace(/\*+/g, "");
      const raisedDate = parseEventDate(raisedStr);
      blockers.push({
        id: cells[0].replace(/\*+/g, ""),
        project: cells[1].replace(/\*+/g, ""),
        description: cells[2].replace(/\*+/g, ""),
        waitingOn: cells[3].replace(/\*+/g, ""),
        raised: raisedDate,
        raisedStr,
        lastUpdate: (cells[5] || "").replace(/\*+/g, ""),
      });
    }
  }
  return blockers;
}

/**
 * Parse an outreach cadence table from alerts.md. Only used as a fallback when the CRM is not
 * configured or unreachable. Optional: add a section to alerts.md like
 *   ### Outreach Cadence
 *   | Contact | Org | Warmth | Day 0 | Next Action | Due | Task |
 */
function parseCadenceTable(content, sectionHeader) {
  const entries = [];
  const idx = content.indexOf(sectionHeader);
  if (idx === -1) return entries;
  const sep = content.indexOf("|---", idx);
  if (sep === -1) return entries;
  const afterSep = content.indexOf("\n", sep) + 1;
  const lines = content.slice(afterSep).split("\n");
  for (const line of lines) {
    if (!line.startsWith("|")) break;
    const cells = line.split("|").map(c => c.trim()).filter(c => c);
    if (cells.length >= 6) {
      const dueDateCell = cells[5] || cells[4] || "";
      const cleanDate = dueDateCell.replace(/\*+/g, "").trim();
      const parsed = parseEventDate(cleanDate);
      entries.push({
        contact: cells[0].replace(/\*+/g, ""),
        org: cells[1].replace(/\*+/g, ""),
        warmth: cells[2] || "",
        day0: cells[3] || "",
        nextAction: cells[4].replace(/\*+/g, ""),
        dueDate: cleanDate,
        dueDateParsed: parsed,
        linear: cells[6] || "",
      });
    }
  }
  return entries;
}

// ── Tool: harold_alerts_sync ─────────────────────────────────────

server.tool(
  "harold_alerts_sync",
  "Run the Alerts Engine — compute derived alerts from events.md, blockers.md, CRM relationship data, and optionally Linear tasks. Returns structured alert summary with severity levels. Use at session start instead of manually reading and computing.\n\nSources:\n- Events (events.md) → prep deadlines, debrief reminders\n- Blockers (blockers.md) → stale blockers\n- CRM (Supabase) → stale relationships across ALL contact types\n- CRM Tasks → contact-specific follow-ups with due dates\n- Linear (optional input) → overdue/upcoming project tasks\n- Outreach cadence table (alerts.md, optional) → fallback when the CRM is not configured or unreachable",
  {
    linear_overdue: z.array(z.object({
      id: z.string(),
      title: z.string(),
      dueDate: z.string().optional(),
      priority: z.string().optional(),
      state: z.string().optional(),
    })).optional().describe("Overdue/urgent Linear tasks (from Linear MCP)"),
    linear_due_soon: z.array(z.object({
      id: z.string(),
      title: z.string(),
      dueDate: z.string().optional(),
      priority: z.string().optional(),
      state: z.string().optional(),
    })).optional().describe("Linear tasks due within 7 days (from Linear MCP)"),
    stale_days: z.number().default(14).describe("Base freshness threshold — days without contact before flagging warm contacts as stale (default 14)"),
    warm_days: z.number().default(7).describe("Freshness threshold for hot/actively-engaged contacts — tighter because silence on active deals is alarming (default 7)"),
    reference_date: z.string().optional().describe("Override today for testing (YYYY-MM-DD)"),
  },
  async ({ linear_overdue, linear_due_soon, stale_days, warm_days, reference_date }) => {
    try {
      const refDate = reference_date ? new Date(reference_date + "T12:00:00") : new Date();
      const todayStr = refDate.toLocaleDateString("en-CA");
      const urgent = [], warning = [], watch = [];
      const dataSources = ["events.md", "blockers.md"];

      // ── 1. Events ──
      const eventsContent = readFile(path.join(HAROLD_DIR, "events.md"));
      if (eventsContent) {
        const events = parseEventsTable(eventsContent);
        for (const evt of events) {
          if (!evt.date) continue;
          const daysUntil = Math.ceil((evt.date - refDate) / (1000 * 60 * 60 * 24));
          if (evt.prepStatus !== "Complete") {
            if (daysUntil >= 0 && daysUntil <= 3)
              urgent.push({ source: "events", alert: `${evt.name} in ${daysUntil}d — prep not complete`, context: `${evt.dateStr} | Prep: ${evt.prepStatus} | ${evt.project}`, action: `Run event-prep. ${evt.linearTask}` });
            else if (daysUntil > 3 && daysUntil <= 7)
              warning.push({ source: "events", alert: `${evt.name} in ${daysUntil}d — final week`, context: `${evt.dateStr} | Prep: ${evt.prepStatus}`, action: `Start prep. ${evt.linearTask}` });
            else if (daysUntil > 7 && daysUntil <= 30)
              watch.push({ source: "events", alert: `${evt.name} in ${daysUntil}d — ${evt.prepStatus}`, context: `${evt.dateStr} | ${evt.project}`, action: `Plan prep. ${evt.linearTask}` });
          }
          if (daysUntil < 0 && Math.abs(daysUntil) <= 3 && (evt.debriefStatus === "—" || evt.debriefStatus === "Not Started"))
            warning.push({ source: "events", alert: `${evt.name} ended ${Math.abs(daysUntil)}d ago — debrief needed`, context: `Debrief due: ${evt.debriefDue}`, action: "Run meeting-debrief playbook" });
        }
      }

      // ── 2. Blockers ──
      const blockersContent = readFile(path.join(HAROLD_DIR, "blockers.md"));
      if (blockersContent) {
        const blockers = parseBlockersTable(blockersContent);
        for (const b of blockers) {
          if (!b.raised) continue;
          const daysSince = Math.ceil((refDate - b.raised) / (1000 * 60 * 60 * 24));
          if (daysSince > 7)
            urgent.push({ source: "blockers", alert: `${b.id}: ${b.description} — ${daysSince}d blocked`, context: `Waiting: ${b.waitingOn} | ${b.project} | Last: ${b.lastUpdate}`, action: "Escalate per blocker-escalation playbook" });
          else if (daysSince >= 3)
            warning.push({ source: "blockers", alert: `${b.id}: ${b.description} — ${daysSince}d blocked`, context: `Waiting: ${b.waitingOn} | ${b.project}`, action: "Monitor. Escalate at day 7." });
        }
      }

      // ── 3. CRM Relationship Cadence (universal — all categories) ──
      const crmResult = await queryStaleCrmContacts(stale_days, warm_days);
      if (crmResult.source === "crm" && crmResult.contacts.length > 0) {
        dataSources.push("CRM");
        // Group stale contacts by category for cleaner output
        const byCategory = {};
        for (const c of crmResult.contacts) {
          const cat = c.categories[0] || "uncategorized";
          if (!byCategory[cat]) byCategory[cat] = [];
          byCategory[cat].push(c);
        }

        for (const [category, contacts] of Object.entries(byCategory)) {
          for (const c of contacts) {
            const daysStr = c.daysSinceContact !== null ? `${c.daysSinceContact}d since last contact` : "no interactions recorded";
            const warmthStr = c.warmth ? ` | ${c.warmth}` : "";
            const lastStr = c.lastInteractionType ? ` (last: ${c.lastInteractionType})` : "";

            if (c.daysSinceContact !== null && c.daysSinceContact >= c.threshold * 2) {
              // Way overdue — relationship actively degrading
              warning.push({
                source: "crm",
                alert: `GOING COLD [${category}]: ${c.name} (${c.org}) — ${daysStr}${lastStr}`,
                context: `Freshness threshold: ${c.threshold}d${warmthStr} | Priority: ${c.priority}`,
                action: `Re-engage or update warmth status. Check Linear for related tasks.`,
              });
            } else if (c.daysSinceContact === null) {
              // Warm+ contact with no recorded interactions — likely a data gap.
              // We have the relationship, just no CRM interaction history yet.
              warning.push({
                source: "crm",
                alert: `NO HISTORY [${category}]: ${c.name} (${c.org}) — ${c.warmth} contact, ${daysStr}`,
                context: `Priority: ${c.priority}`,
                action: `Log recent interaction in CRM, or reach out if genuinely overdue.`,
              });
            } else {
              // Past threshold but not critically overdue — freshness slipping
              watch.push({
                source: "crm",
                alert: `[${category}] ${c.name} (${c.org}) — ${daysStr}${lastStr}`,
                context: `Freshness threshold: ${c.threshold}d${warmthStr}`,
                action: `Check in or log recent interaction.`,
              });
            }
          }
        }
      } else if (crmResult.source === "crm_unavailable" || crmResult.source === "crm_error") {
        // CRM unavailable — fall back to the optional markdown cadence table
        dataSources.push("cadence table (alerts.md fallback)");
        const alertsContent = readFile(path.join(HAROLD_DIR, "alerts.md"));
        if (alertsContent) {
          const investorCadence = parseCadenceTable(alertsContent, "### Outreach Cadence");
          for (const e of investorCadence) {
            if (!e.dueDateParsed) continue;
            const diff = Math.ceil((e.dueDateParsed - refDate) / (1000 * 60 * 60 * 24));
            if (diff < 0) warning.push({ source: "cadence", alert: `OVERDUE: ${e.contact} (${e.org}) — ${e.nextAction}`, context: `Due ${e.dueDate} (${Math.abs(diff)}d ago) | ${e.warmth}`, action: `Execute now. ${e.linear}` });
            else if (diff === 0) urgent.push({ source: "cadence", alert: `DUE TODAY: ${e.contact} (${e.org}) — ${e.nextAction}`, context: `${e.warmth}`, action: `Execute today. ${e.linear}` });
            else if (diff <= 2) warning.push({ source: "cadence", alert: `${e.contact} (${e.org}) — ${e.nextAction} in ${diff}d`, context: `Due ${e.dueDate} | ${e.warmth}`, action: `Prepare. ${e.linear}` });
            else if (diff <= 7) watch.push({ source: "cadence", alert: `${e.contact} (${e.org}) — ${e.nextAction} in ${diff}d`, context: `Due ${e.dueDate} | ${e.warmth}`, action: `Coming up. ${e.linear}` });
          }
        }
      }
      // If CRM returned data but had 0 stale contacts, great — nothing to alert on

      // ── 4. CRM Tasks (supplementary — Linear is primary) ──
      const crmTasks = await queryCrmTasks(7);
      if (crmTasks.source === "crm") {
        if (crmTasks.overdue.length || crmTasks.upcoming.length) dataSources.push("CRM tasks");
        for (const t of crmTasks.overdue) {
          warning.push({
            source: "crm-task",
            alert: `OVERDUE CRM task: ${t.title}`,
            context: `${t.contactName} (${t.contactOrg}) | Due: ${t.dueDate?.slice(0,10)} (${Math.abs(t.daysDiff)}d ago) | ${t.priority}`,
            action: "Complete or reschedule",
          });
        }
        for (const t of crmTasks.upcoming) {
          watch.push({
            source: "crm-task",
            alert: `CRM task due ${t.daysDiff === 0 ? "today" : t.daysDiff === 1 ? "tomorrow" : `in ${t.daysDiff}d`}: ${t.title}`,
            context: `${t.contactName} (${t.contactOrg}) | ${t.priority}`,
            action: "Address before deadline",
          });
        }
      }

      // ── 5. Linear (if provided — this is the primary task system) ──
      if (linear_overdue) {
        if (linear_overdue.length) dataSources.push("Linear");
        for (const t of linear_overdue)
          urgent.push({ source: "linear", alert: `OVERDUE: ${t.id} — ${t.title}`, context: `Due: ${t.dueDate || "?"} | ${t.priority || ""} | ${t.state || ""}`, action: "Address or reschedule" });
      }
      if (linear_due_soon) {
        if (linear_due_soon.length && !dataSources.includes("Linear")) dataSources.push("Linear");
        for (const t of linear_due_soon) {
          const st = (t.state || "").toLowerCase();
          if (st === "backlog" || st === "not started" || st === "triage")
            warning.push({ source: "linear", alert: `${t.id} — ${t.title} (due ${t.dueDate || "soon"}, ${t.state})`, context: `Priority: ${t.priority || "—"}`, action: "Start or reassign" });
        }
      }

      // ── 6. Summary ──
      const fmt = (arr, emoji, label) => {
        if (!arr.length) return `### ${emoji} ${label}\nNone.\n`;
        return `### ${emoji} ${label}\n\n` + arr.map(a => `- **${a.alert}**\n  ${a.context}\n  → ${a.action} *(${a.source})*`).join("\n\n") + "\n";
      };
      const summary = `# Alerts Engine — ${todayStr}\n\n${fmt(urgent,"🔴","URGENT")}\n${fmt(warning,"🟠","WARNING")}\n${fmt(watch,"🟡","WATCH")}\n---\n*Computed ${now()} from ${dataSources.join(", ")}.*`;
      return { content: [{ type: "text", text: summary }] };
    } catch (e) {
      return { content: [{ type: "text", text: `Alerts Engine error: ${e.message}\n${e.stack}` }], isError: true };
    }
  }
);

// ── Tool: harold_cadence_check ───────────────────────────────────

server.tool(
  "harold_cadence_check",
  "Quick cadence review — stale relationships, overdue CRM tasks, and contacts needing attention. Works across ALL contact types. Uses the CRM as primary source, with the optional Outreach Cadence table in alerts.md as a fallback.",
  {
    category: z.string().optional().describe("Filter to one contact type or label from your own list (e.g. 'investor', 'partner', 'founder'). Omit for all."),
    stale_days: z.number().default(14).describe("Base freshness threshold — days without contact before flagging warm contacts as stale (default 14)"),
    warm_days: z.number().default(7).describe("Freshness threshold for hot/actively-engaged contacts (default 7)"),
    reference_date: z.string().optional().describe("Override today (YYYY-MM-DD)"),
  },
  async ({ category, stale_days, warm_days, reference_date }) => {
    try {
      const refDate = reference_date ? new Date(reference_date + "T12:00:00") : new Date();
      let source = "";

      // Try CRM first
      const crmResult = await queryStaleCrmContacts(stale_days, warm_days);

      if (crmResult.source === "crm") {
        source = "CRM";
        let contacts = crmResult.contacts;

        // Filter by category if requested
        if (category) {
          contacts = contacts.filter(c => c.categories.includes(category));
        }

        if (!contacts.length) {
          const catStr = category ? ` in category "${category}"` : "";
          return { content: [{ type: "text", text: `✅ No stale contacts${catStr}. All relationships within cadence thresholds. *(Source: CRM)*` }] };
        }

        // Group by category
        const byCategory = {};
        for (const c of contacts) {
          const cat = c.categories[0] || "uncategorized";
          if (!byCategory[cat]) byCategory[cat] = [];
          byCategory[cat].push(c);
        }

        const sections = [];
        for (const [cat, group] of Object.entries(byCategory)) {
          const items = group.map(c => {
            const daysStr = c.daysSinceContact !== null ? `${c.daysSinceContact}d ago` : "never contacted";
            const warmthStr = c.warmth ? ` [${c.warmth}]` : "";
            const lastStr = c.lastInteractionType ? ` (${c.lastInteractionType})` : "";
            return `- ${c.name} (${c.org}) — last: ${daysStr}${lastStr}${warmthStr}`;
          });
          sections.push(`**${cat.toUpperCase()} (${group.length}):**\n${items.join("\n")}`);
        }

        // Also check CRM tasks
        const crmTasks = await queryCrmTasks(7);
        if (crmTasks.overdue.length) {
          const taskItems = crmTasks.overdue.map(t =>
            `- ${t.title} — ${t.contactName} (${t.contactOrg}) [${Math.abs(t.daysDiff)}d overdue]`
          );
          sections.unshift(`**🔴 OVERDUE CRM TASKS:**\n${taskItems.join("\n")}`);
        }
        if (crmTasks.upcoming.length) {
          const taskItems = crmTasks.upcoming.map(t =>
            `- ${t.title} — ${t.contactName} (${t.contactOrg}) [${t.daysDiff === 0 ? "today" : `in ${t.daysDiff}d`}]`
          );
          sections.push(`**📅 UPCOMING CRM TASKS:**\n${taskItems.join("\n")}`);
        }

        return { content: [{ type: "text", text: `## Cadence Check — ${refDate.toLocaleDateString("en-CA")}\n\n${sections.join("\n\n")}\n\n---\n*Source: CRM (${contacts.length} stale contacts)*` }] };
      }

      // Fallback: the optional markdown cadence table
      source = "alerts.md cadence table";
      const alertsContent = readFile(path.join(HAROLD_DIR, "alerts.md"));
      if (!alertsContent) return { content: [{ type: "text", text: "No CRM connection and alerts.md not found." }], isError: true };

      const overdue = [], dueToday = [], upcoming = [];

      const investorCadence = parseCadenceTable(alertsContent, "### Outreach Cadence");
      for (const e of investorCadence) {
        if (!e.dueDateParsed) continue;
        // (the markdown table has no type column, so a category filter cannot apply here)
        const diff = Math.ceil((e.dueDateParsed - refDate) / (1000 * 60 * 60 * 24));
        const item = `${e.contact} (${e.org}) — ${e.nextAction} [due ${e.dueDate}]`;
        if (diff < 0) overdue.push(item);
        else if (diff === 0) dueToday.push(item);
        else if (diff <= 7) upcoming.push(`${item} (in ${diff}d)`);
      }

      const sections = [];
      if (overdue.length) sections.push(`**🔴 OVERDUE:**\n${overdue.map(x => `- ${x}`).join("\n")}`);
      if (dueToday.length) sections.push(`**📌 DUE TODAY:**\n${dueToday.map(x => `- ${x}`).join("\n")}`);
      if (upcoming.length) sections.push(`**📅 NEXT 7 DAYS:**\n${upcoming.map(x => `- ${x}`).join("\n")}`);

      if (!sections.length) return { content: [{ type: "text", text: `No cadence items found. All clear. *(Source: ${source})*` }] };
      return { content: [{ type: "text", text: `${sections.join("\n\n")}\n\n---\n*Source: ${source} (CRM unavailable)*` }] };
    } catch (e) {
      return { content: [{ type: "text", text: `Cadence check error: ${e.message}` }], isError: true };
    }
  }
);

// ── Tool: harold_log_interaction ──────────────────────────────────

server.tool(
  "harold_log_interaction",
  "Log an interaction with a contact in the CRM. Use whenever a meeting, call, email, or notable touchpoint occurs. This feeds the freshness tracking system — without logged interactions, the alerts engine has no data.\n\nContact lookup: Provide contact_id directly, OR provide contact_name (+ optionally org) for fuzzy matching.\n\nTypes: call, email, meeting, note, linkedin, other",
  {
    contact_id: z.string().optional().describe("Direct CRM contact UUID. If provided, skips name lookup."),
    contact_name: z.string().optional().describe("Contact name for lookup (e.g., 'Jane Doe'). Used if contact_id not provided."),
    org: z.string().optional().describe("Organization name to disambiguate contacts with same name."),
    type: z.enum(["call", "email", "meeting", "note", "linkedin", "other"]).describe("Interaction type"),
    subject: z.string().describe("Brief subject/title (e.g., 'Intro call', 'Follow-up email re: partnership')"),
    body: z.string().optional().describe("Optional longer notes about the interaction"),
    occurred_at: z.string().optional().describe("When the interaction occurred (ISO datetime). Defaults to now."),
  },
  async ({ contact_id, contact_name, org, type, subject, body, occurred_at }) => {
    try {
      const supabase = getSupabase();
      if (!supabase) return { content: [{ type: "text", text: CRM_NOT_CONFIGURED }], isError: true };

      // Resolve contact
      let resolvedId = contact_id;
      let resolvedName = contact_name || "";

      if (!resolvedId) {
        if (!contact_name) {
          return { content: [{ type: "text", text: "Error: Provide either contact_id or contact_name" }], isError: true };
        }
        const resolved = await resolveContact(supabase, contact_name, org);
        if (resolved.error) return resolved.error;
        if (resolved.multiple) return resolved.multiple;
        resolvedId = resolved.id;
        resolvedName = resolved.name;
      }

      // Optional HAROLD_NO_LOG_TYPES: conversations with these contact types are never logged.
      if (NO_LOG_TYPES.length) {
        const { data: who, error: whoErr } = await supabase.from("contacts").select("name, category").eq("id", resolvedId).single();
        if (whoErr) throw whoErr;
        const type = String(who?.category || "").toLowerCase();
        if (NO_LOG_TYPES.includes(type)) {
          return { content: [{ type: "text", text: `Not logged: ${who.name} is type "${type}", and HAROLD_NO_LOG_TYPES says conversations with that type are never logged. Keep their record current with harold_upsert_contact instead.` }], isError: true };
        }
      }

      // Insert the interaction
      const { data: interaction, error } = await supabase
        .from("interactions")
        .insert({
          contact_id: resolvedId,
          type,
          subject: subject || "",
          body: body || "",
          occurred_at: occurred_at || new Date().toISOString(),
        })
        .select("id, occurred_at")
        .single();

      if (error) throw error;

      return {
        content: [{
          type: "text",
          text: `✅ Logged ${type} for ${resolvedName}: "${subject}"\n   Contact: ${resolvedId}\n   Interaction: ${interaction.id}\n   Time: ${interaction.occurred_at}`
        }]
      };
    } catch (e) {
      return { content: [{ type: "text", text: `Error logging interaction: ${e.message}` }], isError: true };
    }
  }
);

// ── Tool: harold_upsert_contact ──────────────────────────────────

server.tool(
  "harold_upsert_contact",
  "Create or update a contact in the CRM. Use when new people are encountered (meetings, intros, research) or when contact details change.\n\nFor NEW contacts: provide name + at minimum org and category (the contact's one type).\nFor UPDATES: provide contact_id to target exact record, OR name+org to find and update.\n\nType (category): exactly one, from your own list (e.g. investor, partner, founder, team, other).\nLabels (categories): any number of extra tags, e.g. board, advisor.\nWarmth: Cold, Lukewarm, Warm, Hot, or empty (not rated)\nStatus: active, pending, cold, archived",
  {
    contact_id: z.string().optional().describe("For updates: exact CRM UUID to update"),
    name: z.string().describe("Contact full name"),
    org: z.string().optional().describe("Organization / company name"),
    category: z.string().optional().describe("The contact's one type, from your own list (e.g. investor, partner, founder, team, other)"),
    categories: z.array(z.string()).optional().describe("Labels to add (any number, e.g. ['board', 'advisor']). Stored in contact_categories, never a copy of the type. Existing labels are kept."),
    warmth: z.enum(["", "Cold", "Lukewarm", "Warm", "Hot"]).optional().describe("Relationship closeness: Cold (no connection) → Lukewarm → Warm → Hot (actively engaged). Empty string = not rated yet. Warmth is a judgment, independent of type."),
    status: z.enum(["active", "pending", "cold", "archived"]).optional().describe("Contact status. Default: pending for new, unchanged for updates."),
    priority: z.enum(["high", "medium", "low"]).optional().describe("Priority level. Default: medium"),
    email: z.string().optional().describe("Email address"),
    phone: z.string().optional().describe("Phone number"),
    location: z.string().optional().describe("City, state, or region"),
    website: z.string().optional().describe("Website URL"),
    notes: z.string().optional().describe("Freeform notes about this contact"),
    region: z.string().optional().describe("Geographic region (e.g., 'Pacific Northwest', 'Western Europe')"),
    focus_area: z.string().optional().describe("Professional focus or sector"),
    investor_type: z.string().optional().describe("For investors: VC, Angel, PE, Family Office, etc."),
  },
  async ({ contact_id, name, org, category, categories: multiCategories, warmth, status, priority, email, phone, location, website, notes, region, focus_area, investor_type }) => {
    try {
      const supabase = getSupabase();
      if (!supabase) return { content: [{ type: "text", text: CRM_NOT_CONFIGURED }], isError: true };

      let isUpdate = false;
      let existingId = contact_id;

      // If no contact_id, check if contact already exists (by name + org)
      if (!existingId && name) {
        const { data: existing } = await supabase
          .from("contacts")
          .select("id, name, org")
          .ilike("name", name);

        if (existing && existing.length > 0) {
          // If org provided, try to match
          if (org) {
            const match = existing.find(e =>
              e.org && e.org.toLowerCase().includes(org.toLowerCase())
            );
            if (match) {
              existingId = match.id;
              isUpdate = true;
            }
          } else if (existing.length === 1) {
            existingId = existing[0].id;
            isUpdate = true;
          }
          // If multiple matches without org, we'll create a new one
        }
      } else if (existingId) {
        isUpdate = true;
      }

      // Build the record — only include fields that were provided
      const record = {};
      if (name !== undefined) record.name = name;
      if (org !== undefined) record.org = org;
      if (category !== undefined) record.category = category;
      if (warmth !== undefined) record.warmth = warmth;
      if (status !== undefined) record.status = status;
      if (priority !== undefined) record.priority = priority;
      if (email !== undefined) record.email = email;
      if (phone !== undefined) record.phone = phone;
      if (location !== undefined) record.location = location;
      if (website !== undefined) record.website = website;
      if (notes !== undefined) record.notes = notes;
      if (region !== undefined) record.region = region;
      if (focus_area !== undefined) record.focus_area = focus_area;
      if (investor_type !== undefined) record.investor_type = investor_type;

      let resultContact;

      if (isUpdate && existingId) {
        // UPDATE existing contact
        record.updated_at = new Date().toISOString();
        const { data, error } = await supabase
          .from("contacts")
          .update(record)
          .eq("id", existingId)
          .select("id, name, org, warmth, status, category")
          .single();

        if (error) throw error;
        resultContact = data;
      } else {
        // CREATE new contact. Pipeline placement is deliberate and purpose-bound:
        // nothing is auto-placed here. Use harold_pipeline to put someone in the pipeline.
        if (!record.status) record.status = "pending";
        if (!record.priority) record.priority = "medium";
        if (!record.category) record.category = category || "other";

        const { data, error } = await supabase
          .from("contacts")
          .insert(record)
          .select("id, name, org, warmth, status, category")
          .single();

        if (error) throw error;
        resultContact = data;
      }

      // Multi-label membership: the `categories` parameter writes here, not to contacts.category.
      // A type is what someone IS (exactly one). A label is an extra tag (any number).
      let allCategories = [];
      if (resultContact) {
        if (Array.isArray(multiCategories) && multiCategories.length) {
          const rows = multiCategories
            .map(c => String(c).trim().toLowerCase())
            .filter(Boolean)
            .map(category_name => ({ contact_id: resultContact.id, category_name }));
          if (rows.length) await supabase.from("contact_categories").upsert(rows, { onConflict: "contact_id,category_name" });
        }
        const { data: catRows } = await supabase
          .from("contact_categories")
          .select("category_name")
          .eq("contact_id", resultContact.id);
        allCategories = (catRows || []).map(r => r.category_name);
      }

      // Fetch all pipeline memberships for display
      const { data: contactPipelines } = await supabase
        .from("contact_pipelines")
        .select("stage, purpose, project")
        .eq("contact_id", resultContact.id);

      const action = isUpdate ? "Updated" : "Created";
      const catStr = allCategories.length ? ` [${allCategories.join(", ")}]` : ` [${resultContact.category}]`;
      const warmthStr = resultContact.warmth ? ` | ${resultContact.warmth}` : "";
      let pipelineStr = "";
      if (contactPipelines && contactPipelines.length > 0) {
        pipelineStr = contactPipelines.map(cp => `\n   Pipeline: ${cp.stage}${cp.purpose ? ` — ${cp.purpose}` : ""}${cp.project ? ` [${cp.project}]` : ""}`).join("");
      }

      return {
        content: [{
          type: "text",
          text: `✅ ${action} contact: ${resultContact.name} (${resultContact.org || "no org"})${catStr}${warmthStr}\n   ID: ${resultContact.id}\n   Status: ${resultContact.status}${pipelineStr}`
        }]
      };
    } catch (e) {
      return { content: [{ type: "text", text: `Error upserting contact: ${e.message}` }], isError: true };
    }
  }
);

// ── Tool: harold_search_contacts ──────────────────────────────────

server.tool(
  "harold_search_contacts",
  "Search CRM contacts by any combination of filters. Use for questions like 'who are our hot investors?', 'find partners in Western Europe', 'show me everyone at Acme Corp', 'which contacts are cold?', 'who is at the Advancing stage?', or 'everyone in the pipeline for the fundraise'.\n\nReturns up to 25 results by default. All filters combine with AND logic. Text filters (name, org, keyword) use fuzzy matching.",
  {
    name: z.string().optional().describe("Search by contact name (fuzzy match)"),
    org: z.string().optional().describe("Search by organization name (fuzzy match)"),
    category: z.string().optional().describe("Filter by type (from your own list, e.g. investor, partner, founder, team, other)"),
    purpose: z.string().optional().describe("Filter by why they are in the pipeline (fuzzy), e.g. 'capital', 'role', 'partner', 'client'"),
    project: z.string().optional().describe("Filter by project slug from harold/projects.md, e.g. 'seed-round'"),
    pipeline_stage: z.string().optional().describe("Filter by pipeline stage: Identified, Reached Out, In Conversation, Advancing, Committed, Active, Dormant"),
    warmth: z.string().optional().describe("Filter by warmth: Cold, Lukewarm, Warm, Hot"),
    status: z.string().optional().describe("Filter by status: active, pending, cold, archived"),
    priority: z.string().optional().describe("Filter by priority: high, medium, low"),
    region: z.string().optional().describe("Filter by geographic region (fuzzy match)"),
    focus_area: z.string().optional().describe("Filter by professional focus/sector (fuzzy match)"),
    investor_type: z.string().optional().describe("Filter by investor type: VC, Angel, PE, Family Office, etc."),
    keyword: z.string().optional().describe("General keyword search across name, org, notes, focus_area, region"),
    has_email: z.boolean().optional().describe("If true, only return contacts with email addresses"),
    has_phone: z.boolean().optional().describe("If true, only return contacts with phone numbers"),
    limit: z.number().optional().describe("Max results to return (default: 25, max: 100)"),
    order_by: z.enum(["name", "updated_at", "created_at", "warmth", "org"]).optional().describe("Sort field (default: updated_at)"),
  },
  async ({ name, org, category, purpose, project, pipeline_stage, warmth, status, priority, region, focus_area, investor_type, keyword, has_email, has_phone, limit: maxResults, order_by }) => {
    try {
      const supabase = getSupabase();
      if (!supabase) return { content: [{ type: "text", text: CRM_NOT_CONFIGURED }], isError: true };

      const resultLimit = Math.min(maxResults || 25, 100);

      let query = supabase
        .from("contacts")
        .select("id, name, org, category, warmth, status, priority, email, phone, location, region, focus_area, investor_type, notes, updated_at, contact_pipelines ( stage, purpose, project )");

      // One pipeline: filter by stage, by why they are in it, or by project.
      let pipelineContactIds = null;
      if (purpose || project || pipeline_stage) {
        let pipelineQuery = supabase.from("contact_pipelines").select("contact_id");
        if (pipeline_stage) pipelineQuery = pipelineQuery.eq("stage", pipeline_stage);
        if (purpose) pipelineQuery = pipelineQuery.ilike("purpose", `%${purpose}%`);
        if (project) pipelineQuery = pipelineQuery.eq("project", project);
        const { data: pipelineMatches } = await pipelineQuery;
        pipelineContactIds = pipelineMatches && pipelineMatches.length
          ? [...new Set(pipelineMatches.map(m => m.contact_id))] : [];
      }

      // Apply filters
      if (name) query = query.ilike("name", `%${name}%`);
      if (org) query = query.ilike("org", `%${org}%`);
      if (category) query = query.eq("category", category);
      if (pipelineContactIds !== null && pipelineContactIds.length > 0) {
        query = query.in("id", pipelineContactIds);
      } else if (pipelineContactIds !== null && pipelineContactIds.length === 0) {
        query = query.eq("id", "00000000-0000-0000-0000-000000000000"); // no pipeline match: return nothing
      }
      if (warmth) query = query.eq("warmth", warmth);
      if (status) query = query.eq("status", status);
      if (priority) query = query.eq("priority", priority);
      if (region) query = query.ilike("region", `%${region}%`);
      if (focus_area) query = query.ilike("focus_area", `%${focus_area}%`);
      if (investor_type) query = query.ilike("investor_type", `%${investor_type}%`);
      if (has_email) query = query.not("email", "is", null).neq("email", "");
      if (has_phone) query = query.not("phone", "is", null).neq("phone", "");

      // Keyword search — use OR across multiple text fields
      if (keyword) {
        query = query.or(
          `name.ilike.%${keyword}%,org.ilike.%${keyword}%,notes.ilike.%${keyword}%,focus_area.ilike.%${keyword}%,region.ilike.%${keyword}%,location.ilike.%${keyword}%`
        );
      }

      // Sort
      const sortField = order_by || "updated_at";
      const ascending = sortField === "name" || sortField === "org";
      query = query.order(sortField, { ascending });

      query = query.limit(resultLimit);

      const { data: contacts, error } = await query;
      if (error) throw error;

      if (!contacts || contacts.length === 0) {
        const filters = [];
        if (name) filters.push(`name~"${name}"`);
        if (org) filters.push(`org~"${org}"`);
        if (category) filters.push(`category=${category}`);
        if (purpose) filters.push(`purpose~${purpose}`);
        if (project) filters.push(`project=${project}`);
        if (pipeline_stage) filters.push(`stage=${pipeline_stage}`);
        if (warmth) filters.push(`warmth=${warmth}`);
        if (status) filters.push(`status=${status}`);
        if (keyword) filters.push(`keyword="${keyword}"`);
        return { content: [{ type: "text", text: `No contacts found matching: ${filters.join(", ") || "no filters"}` }] };
      }

      // Fetch all pipeline memberships for these contacts
      const contactIds = contacts.map(c => c.id);
      const { data: allPipelines } = await supabase
        .from("contact_pipelines")
        .select("contact_id, stage, purpose, project, entered_at")
        .in("contact_id", contactIds);
      const pipelinesMap = {};
      if (allPipelines) {
        for (const cp of allPipelines) {
          if (!pipelinesMap[cp.contact_id]) pipelinesMap[cp.contact_id] = [];
          pipelinesMap[cp.contact_id].push(`${cp.stage}${cp.purpose ? " — " + cp.purpose : ""}`);
        }
      }

      // Format results
      const lines = contacts.map((c, i) => {
        const warmthTag = c.warmth ? ` | ${c.warmth}` : "";
        const pipelines = pipelinesMap[c.id];
        const pipelineTag = pipelines && pipelines.length > 0
          ? ` | ${pipelines.join(", ")}`
          : (c.pipeline_stage ? ` | ${c.pipeline}→${c.pipeline_stage}` : "");
        const emailTag = c.email ? ` | ${c.email}` : "";
        const phoneTag = c.phone ? ` | ${c.phone}` : "";
        const regionTag = c.region ? ` | ${c.region}` : "";
        const investorTag = c.investor_type ? ` | ${c.investor_type}` : "";
        const notesSnip = c.notes ? ` — ${c.notes.substring(0, 80)}${c.notes.length > 80 ? "…" : ""}` : "";
        return `${i + 1}. **${c.name}** (${c.org || "no org"}) [${c.category}${warmthTag}${pipelineTag}] ${c.status}${emailTag}${phoneTag}${regionTag}${investorTag}${notesSnip}\n   id: ${c.id}`;
      });

      const filterDesc = [];
      if (name) filterDesc.push(`name~"${name}"`);
      if (org) filterDesc.push(`org~"${org}"`);
      if (category) filterDesc.push(`category=${category}`);
      if (purpose) filterDesc.push(`purpose~${purpose}`);
      if (project) filterDesc.push(`project=${project}`);
      if (pipeline_stage) filterDesc.push(`stage=${pipeline_stage}`);
      if (warmth) filterDesc.push(`warmth=${warmth}`);
      if (status) filterDesc.push(`status=${status}`);
      if (keyword) filterDesc.push(`keyword="${keyword}"`);
      if (region) filterDesc.push(`region~"${region}"`);
      if (has_email) filterDesc.push("has_email");
      if (has_phone) filterDesc.push("has_phone");

      const header = `Found ${contacts.length} contact${contacts.length === 1 ? "" : "s"}${filterDesc.length ? ` matching: ${filterDesc.join(", ")}` : ""}`;

      return {
        content: [{
          type: "text",
          text: `${header}\n\n${lines.join("\n\n")}`
        }]
      };
    } catch (e) {
      return { content: [{ type: "text", text: `Search error: ${e.message}` }], isError: true };
    }
  }
);

// ── Tool: harold_get_contact ──────────────────────────────────────

server.tool(
  "harold_get_contact",
  "Get full details for a single CRM contact, including interaction history, categories, and all fields. Use when you need the complete picture on someone — e.g., prepping for a meeting, writing outreach, or reviewing a relationship.\n\nLookup: Provide contact_id directly, OR contact_name (+ optionally org) for fuzzy match.",
  {
    contact_id: z.string().optional().describe("Direct CRM contact UUID"),
    contact_name: z.string().optional().describe("Contact name for fuzzy lookup"),
    org: z.string().optional().describe("Organization to disambiguate"),
    include_interactions: z.boolean().optional().describe("Include interaction history (default: true)"),
    interaction_limit: z.number().optional().describe("Max interactions to return (default: 10)"),
  },
  async ({ contact_id, contact_name, org, include_interactions, interaction_limit }) => {
    try {
      const supabase = getSupabase();
      if (!supabase) return { content: [{ type: "text", text: CRM_NOT_CONFIGURED }], isError: true };

      let resolvedId = contact_id;

      if (!resolvedId) {
        if (!contact_name) {
          return { content: [{ type: "text", text: "Error: Provide either contact_id or contact_name" }], isError: true };
        }
        const resolved = await resolveContact(supabase, contact_name, org);
        if (resolved.error) return resolved.error;
        if (resolved.multiple) return resolved.multiple;
        resolvedId = resolved.id;
      }

      // Fetch full contact record
      const { data: contact, error } = await supabase
        .from("contacts")
        .select("*")
        .eq("id", resolvedId)
        .single();

      if (error) throw error;
      if (!contact) return { content: [{ type: "text", text: `Contact not found: ${resolvedId}` }], isError: true };

      // Fetch categories from junction table
      const { data: categories } = await supabase
        .from("contact_categories")
        .select("category_name")
        .eq("contact_id", resolvedId);

      const catList = (categories || []).map(c => c.category_name);

      // Build contact profile
      const lines = [];
      lines.push(`# ${contact.name}`);
      lines.push(`**Organization:** ${contact.org || "—"}`);
      lines.push(`**Categories:** ${catList.length ? catList.join(", ") : contact.category || "—"}`);
      lines.push(`**Warmth:** ${contact.warmth || "—"} | **Status:** ${contact.status || "—"} | **Priority:** ${contact.priority || "—"}`);

      // Pipeline stage info (from junction table, with legacy fallback)
      const { data: contactPipelines } = await supabase
        .from("contact_pipelines")
        .select("stage, purpose, project, entered_at")
        .eq("contact_id", resolvedId);

      if (contactPipelines && contactPipelines.length > 0) {
        for (const cp of contactPipelines) {
          const since = cp.entered_at ? new Date(cp.entered_at).toLocaleDateString() : "—";
          const why = cp.purpose ? ` — ${cp.purpose}` : "";
          const proj = cp.project ? ` [${cp.project}]` : "";
          lines.push(`**Pipeline:** **${cp.stage}**${why}${proj} (since ${since})`);
        }
      }

      if (contact.email) lines.push(`**Email:** ${contact.email}`);
      if (contact.phone) lines.push(`**Phone:** ${contact.phone}`);
      if (contact.location) lines.push(`**Location:** ${contact.location}`);
      if (contact.region) lines.push(`**Region:** ${contact.region}`);
      if (contact.focus_area) lines.push(`**Focus Area:** ${contact.focus_area}`);
      if (contact.investor_type) lines.push(`**Investor Type:** ${contact.investor_type}`);
      if (contact.website) lines.push(`**Website:** ${contact.website}`);
      if (contact.notes) lines.push(`**Notes:** ${contact.notes}`);

      lines.push(`**Created:** ${contact.created_at ? new Date(contact.created_at).toLocaleDateString() : "—"}`);
      lines.push(`**Updated:** ${contact.updated_at ? new Date(contact.updated_at).toLocaleDateString() : "—"}`);
      lines.push(`**ID:** ${contact.id}`);

      // Fetch interactions if requested (default: yes)
      if (include_interactions !== false) {
        const intLimit = Math.min(interaction_limit || 10, 50);

        const { data: interactions } = await supabase
          .from("interactions")
          .select("id, type, subject, body, occurred_at")
          .eq("contact_id", resolvedId)
          .order("occurred_at", { ascending: false })
          .limit(intLimit);

        if (interactions && interactions.length > 0) {
          lines.push(`\n## Interaction History (${interactions.length} most recent)`);
          interactions.forEach(int => {
            const date = int.occurred_at ? new Date(int.occurred_at).toLocaleDateString() : "—";
            const bodySnip = int.body ? ` — ${int.body.substring(0, 120)}${int.body.length > 120 ? "…" : ""}` : "";
            lines.push(`- **${date}** [${int.type}] ${int.subject}${bodySnip}`);
          });
        } else {
          lines.push(`\n## Interaction History\nNo interactions logged yet. Use harold_log_interaction to record touchpoints.`);
        }
      }

      // Fetch pending CRM tasks for this contact
      const { data: tasks } = await supabase
        .from("tasks")
        .select("id, title, status, priority, due_date")
        .eq("contact_id", resolvedId)
        .in("status", ["pending", "in_progress"])
        .order("due_date", { ascending: true })
        .limit(5);

      if (tasks && tasks.length > 0) {
        lines.push(`\n## Open Tasks`);
        tasks.forEach(t => {
          const due = t.due_date ? new Date(t.due_date).toLocaleDateString() : "no due date";
          lines.push(`- [${t.status}] ${t.title} (${t.priority}, ${due})`);
        });
      }

      // Stage history, if this contact has ever moved in the pipeline
      {
        const { data: stageChanges } = await supabase
          .from("stage_changes")
          .select("from_stage, to_stage, notes, changed_at")
          .eq("contact_id", resolvedId)
          .order("changed_at", { ascending: false })
          .limit(10);

        if (stageChanges && stageChanges.length > 0) {
          lines.push(`\n## Stage History`);
          stageChanges.forEach(sc => {
            const date = sc.changed_at ? new Date(sc.changed_at).toLocaleDateString() : "—";
            const from = sc.from_stage || "—";
            const notesStr = sc.notes ? ` — ${sc.notes}` : "";
            lines.push(`- **${date}**: ${from} → ${sc.to_stage}${notesStr}`);
          });
        }
      }

      return {
        content: [{
          type: "text",
          text: lines.join("\n")
        }]
      };
    } catch (e) {
      return { content: [{ type: "text", text: `Error fetching contact: ${e.message}` }], isError: true };
    }
  }
);

// ── Tool: harold_pipeline ─────────────────────────────────────────
// One pipeline for everything the operator has in motion. A person is in it for a REASON:
// capital for a business, a role, a partner, a client. Same seven stages for all of it.
server.tool(
  "harold_pipeline",
  "Put someone in the pipeline, move them along it, or see who is where.\n\nThere is ONE pipeline, not one per contact type. What differs is the PURPOSE: why this person is in it. 'Raising the seed round', 'Distribution partner for the product launch', 'Hiring a head of product', 'First client for the consultancy'. A person can hold more than one entry if they are in play for more than one reason.\n\nStages, in order: Identified, Reached Out, In Conversation, Advancing, Committed, Active, Dormant.\n\nNothing is ever auto-placed. Set a stage when the conversation actually establishes where someone stands, and move them when it changes.\n\nActions: add, move, close, list",
  {
    action: z.enum(["add", "move", "close", "list"]).describe("add = put someone in the pipeline for a purpose; move = change their stage; close = they are done or gone; list = who is where"),
    contact_name: z.string().optional().describe("Contact name (fuzzy). Required for add/move/close."),
    org: z.string().optional().describe("Organization, to disambiguate the name"),
    entry_id: z.string().optional().describe("Pipeline entry UUID, when a contact has more than one"),
    purpose: z.string().optional().describe("Why they are in the pipeline, in the operator's words. Required for add."),
    project: z.string().optional().describe("Project name or slug from harold/projects.md, e.g. seed-round"),
    stage: z.enum(["Identified","Reached Out","In Conversation","Advancing","Committed","Active","Dormant"]).optional().describe("Stage to set (add/move)"),
    outcome: z.string().optional().describe("How it ended (close)"),
    notes: z.string().optional().describe("Why the stage changed. Recorded in the history."),
    filter_stage: z.string().optional().describe("list: only this stage"),
    filter_project: z.string().optional().describe("list: only this project slug"),
  },
  async ({ action, contact_name, org, entry_id, purpose, project, stage, outcome, notes, filter_stage, filter_project }) => {
    try {
      const supabase = getSupabase();
      if (!supabase) return { content: [{ type: "text", text: CRM_NOT_CONFIGURED }], isError: true };

      if (action === "list") {
        let q = supabase.from("contact_pipelines")
          .select("id, stage, purpose, project, entered_at, outcome, closed_at, contacts ( name, org, category, warmth )")
          .is("closed_at", null);
        if (filter_stage) q = q.eq("stage", filter_stage);
        if (filter_project) q = q.eq("project", filter_project);
        const { data, error } = await q;
        if (error) return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        if (!data || !data.length) return { content: [{ type: "text", text: "Pipeline is empty. Nobody has been placed yet. That is normal: an entry exists only once a conversation establishes a purpose." }] };
        const ORDER = ["Identified","Reached Out","In Conversation","Advancing","Committed","Active","Dormant"];
        const byStage = {};
        for (const e of data) (byStage[e.stage] ||= []).push(e);
        const lines = [`# Pipeline — ${data.length} open entr${data.length === 1 ? "y" : "ies"}`, ""];
        for (const st of ORDER) {
          if (!byStage[st]) continue;
          lines.push(`## ${st} (${byStage[st].length})`);
          for (const e of byStage[st]) {
            const c = e.contacts || {};
            const since = e.entered_at ? new Date(e.entered_at).toLocaleDateString() : "—";
            lines.push(`- **${c.name || "?"}**${c.org ? ` (${c.org})` : ""} — ${e.purpose || "no purpose recorded"}${e.project ? ` [${e.project}]` : ""} · since ${since}`);
          }
          lines.push("");
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
      }

      if (!contact_name && !entry_id) return { content: [{ type: "text", text: "Need contact_name (or entry_id)." }], isError: true };

      let contact = null;
      if (contact_name) {
        const resolved = await resolveContact(supabase, contact_name, org);
        if (resolved.error) return resolved.error;
        if (resolved.multiple) return resolved.multiple;
        contact = { id: resolved.id, name: resolved.name };
      }

      if (action === "add") {
        if (!purpose) return { content: [{ type: "text", text: "Need a purpose: why is this person in the pipeline? (e.g. 'Raising the seed round', 'Hiring a head of product')" }], isError: true };
        const { data, error } = await supabase.from("contact_pipelines")
          .insert({ contact_id: contact.id, stage: stage || "Identified", purpose, project: project || null })
          .select("id, stage, purpose, project").single();
        if (error) return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        await supabase.from("stage_changes").insert({ contact_id: contact.id, entry_id: data.id, from_stage: null, to_stage: data.stage, notes: notes || "" });
        return { content: [{ type: "text", text: `✓ ${contact.name} in the pipeline at **${data.stage}** — ${data.purpose}${data.project ? ` [${data.project}]` : ""}` }] };
      }

      // move / close both need the entry
      let entry = null;
      if (entry_id) {
        const { data } = await supabase.from("contact_pipelines").select("id, stage, purpose, project, contact_id").eq("id", entry_id).maybeSingle();
        entry = data;
      } else {
        const { data } = await supabase.from("contact_pipelines").select("id, stage, purpose, project, contact_id").eq("contact_id", contact.id).is("closed_at", null);
        if (!data || !data.length) return { content: [{ type: "text", text: `${contact.name} is not in the pipeline. Use action "add" with a purpose.` }], isError: true };
        if (data.length > 1 && !purpose) {
          return { content: [{ type: "text", text: `${contact.name} has ${data.length} open entries. Say which by passing purpose or entry_id:\n` + data.map(e => `- ${e.stage}: ${e.purpose} (${e.id})`).join("\n") }], isError: true };
        }
        entry = data.length === 1 ? data[0] : data.find(e => (e.purpose || "").toLowerCase().includes((purpose || "").toLowerCase()));
        if (!entry) return { content: [{ type: "text", text: `No entry for ${contact.name} matching that purpose.` }], isError: true };
      }

      if (action === "move") {
        if (!stage) return { content: [{ type: "text", text: "Need a stage to move to." }], isError: true };
        const from = entry.stage;
        const { error } = await supabase.from("contact_pipelines").update({ stage, entered_at: new Date().toISOString() }).eq("id", entry.id);
        if (error) return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        await supabase.from("stage_changes").insert({ contact_id: entry.contact_id, entry_id: entry.id, from_stage: from, to_stage: stage, notes: notes || "" });
        return { content: [{ type: "text", text: `✓ ${contact ? contact.name : "Entry"}: **${from} → ${stage}** (${entry.purpose})${notes ? `\n   ${notes}` : ""}` }] };
      }

      if (action === "close") {
        const { error } = await supabase.from("contact_pipelines")
          .update({ closed_at: new Date().toISOString(), outcome: outcome || "", stage: stage || entry.stage }).eq("id", entry.id);
        if (error) return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        return { content: [{ type: "text", text: `✓ Closed: ${entry.purpose}${outcome ? ` — ${outcome}` : ""}. The record stays; it is out of the open pipeline.` }] };
      }
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
    }
  }
);

// ── Tool: harold_crm_task ─────────────────────────────────────────

server.tool(
  "harold_crm_task",
  "Create, update, or complete a contact-specific CRM task. These are relationship follow-ups tied to a contact (e.g., 'Follow up with Jane re: term sheet', 'Send deck to Sam'). They feed into the alerts engine for overdue/upcoming tracking.\n\nFor project work, use the task manager (Linear by default) instead. CRM tasks are for contact-specific relationship actions only.\n\nActions: create, update, complete, cancel, list",
  {
    action: z.enum(["create", "update", "complete", "cancel", "list"]).describe("Action to perform"),
    task_id: z.string().optional().describe("Task UUID — required for update/complete/cancel"),
    contact_name: z.string().optional().describe("Contact name for lookup (create/list). Fuzzy match."),
    contact_id: z.string().optional().describe("Direct contact UUID (create/list)"),
    org: z.string().optional().describe("Organization to disambiguate contact lookup"),
    title: z.string().optional().describe("Task title (required for create)"),
    description: z.string().optional().describe("Task description/notes"),
    priority: z.enum(["high", "medium", "low"]).optional().describe("Task priority (default: medium)"),
    due_date: z.string().optional().describe("Due date (ISO format, e.g., '2026-02-20')"),
    status: z.enum(["pending", "in_progress", "completed", "cancelled"]).optional().describe("Task status (for update)"),
  },
  async ({ action, task_id, contact_name, contact_id, org, title, description, priority, due_date, status }) => {
    try {
      const supabase = getSupabase();
      if (!supabase) return { content: [{ type: "text", text: CRM_NOT_CONFIGURED }], isError: true };

      // ── LIST ──
      if (action === "list") {
        let query = supabase
          .from("tasks")
          .select("id, title, description, status, priority, due_date, completed_at, contact_id")
          .in("status", ["pending", "in_progress"])
          .order("due_date", { ascending: true, nullsFirst: false });

        // Filter by contact if provided
        if (contact_id) {
          query = query.eq("contact_id", contact_id);
        } else if (contact_name) {
          // Resolve contact first
          const resolved = await resolveContact(supabase, contact_name, org);
          if (resolved.error) return resolved.error;
          if (resolved.multiple) return resolved.multiple;
          query = query.eq("contact_id", resolved.id);
        }

        query = query.limit(20);
        const { data: tasks, error } = await query;
        if (error) throw error;

        if (!tasks || tasks.length === 0) {
          return { content: [{ type: "text", text: `No open CRM tasks found${contact_name ? ` for "${contact_name}"` : ""}.` }] };
        }

        // Fetch contact names for display
        const contactIds = [...new Set(tasks.filter(t => t.contact_id).map(t => t.contact_id))];
        const { data: contacts } = contactIds.length > 0
          ? await supabase.from("contacts").select("id, name, org").in("id", contactIds)
          : { data: [] };
        const contactMap = Object.fromEntries((contacts || []).map(c => [c.id, `${c.name} (${c.org || "no org"})`]));

        const lines = tasks.map((t, i) => {
          const due = t.due_date ? new Date(t.due_date).toLocaleDateString() : "no due date";
          const contact = t.contact_id ? contactMap[t.contact_id] || t.contact_id : "unlinked";
          return `${i + 1}. [${t.status}] **${t.title}** — ${contact} (${t.priority}, ${due})\n   id: ${t.id}`;
        });

        return { content: [{ type: "text", text: `Open CRM tasks (${tasks.length}):\n\n${lines.join("\n\n")}` }] };
      }

      // ── COMPLETE ──
      if (action === "complete") {
        if (!task_id) return { content: [{ type: "text", text: "Error: task_id required for complete action" }], isError: true };

        const { data, error } = await supabase
          .from("tasks")
          .update({ status: "completed", completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq("id", task_id)
          .select("id, title, status, completed_at")
          .single();

        if (error) throw error;
        return { content: [{ type: "text", text: `✅ Completed: "${data.title}"\n   ID: ${data.id}\n   Completed: ${data.completed_at}` }] };
      }

      // ── CANCEL ──
      if (action === "cancel") {
        if (!task_id) return { content: [{ type: "text", text: "Error: task_id required for cancel action" }], isError: true };

        const { data, error } = await supabase
          .from("tasks")
          .update({ status: "cancelled", updated_at: new Date().toISOString() })
          .eq("id", task_id)
          .select("id, title, status")
          .single();

        if (error) throw error;
        return { content: [{ type: "text", text: `❌ Cancelled: "${data.title}"\n   ID: ${data.id}` }] };
      }

      // ── UPDATE ──
      if (action === "update") {
        if (!task_id) return { content: [{ type: "text", text: "Error: task_id required for update action" }], isError: true };

        const updates = { updated_at: new Date().toISOString() };
        if (title !== undefined) updates.title = title;
        if (description !== undefined) updates.description = description;
        if (priority !== undefined) updates.priority = priority;
        if (due_date !== undefined) updates.due_date = due_date;
        if (status !== undefined) {
          updates.status = status;
          if (status === "completed") updates.completed_at = new Date().toISOString();
        }

        const { data, error } = await supabase
          .from("tasks")
          .update(updates)
          .eq("id", task_id)
          .select("id, title, status, priority, due_date")
          .single();

        if (error) throw error;
        const due = data.due_date ? new Date(data.due_date).toLocaleDateString() : "no due date";
        return { content: [{ type: "text", text: `✏️ Updated: "${data.title}" [${data.status}] (${data.priority}, ${due})\n   ID: ${data.id}` }] };
      }

      // ── CREATE ──
      if (action === "create") {
        if (!title) return { content: [{ type: "text", text: "Error: title required for create action" }], isError: true };

        let resolvedContactId = contact_id;
        let resolvedContactName = "";

        if (!resolvedContactId && contact_name) {
          const resolved = await resolveContact(supabase, contact_name, org);
          if (resolved.error) return resolved.error;
          if (resolved.multiple) return resolved.multiple;
          resolvedContactId = resolved.id;
          resolvedContactName = resolved.name;
        }

        const record = {
          title,
          description: description || "",
          status: "pending",
          priority: priority || "medium",
        };

        if (resolvedContactId) record.contact_id = resolvedContactId;
        if (due_date) record.due_date = due_date;

        const { data, error } = await supabase
          .from("tasks")
          .insert(record)
          .select("id, title, status, priority, due_date, contact_id")
          .single();

        if (error) throw error;

        const due = data.due_date ? new Date(data.due_date).toLocaleDateString() : "no due date";
        const contactStr = resolvedContactName ? ` → ${resolvedContactName}` : (data.contact_id ? ` → ${data.contact_id}` : "");

        return { content: [{ type: "text", text: `✅ Created CRM task: "${data.title}"${contactStr}\n   Priority: ${data.priority} | Due: ${due}\n   ID: ${data.id}` }] };
      }

      return { content: [{ type: "text", text: `Unknown action: ${action}` }], isError: true };
    } catch (e) {
      return { content: [{ type: "text", text: `CRM task error: ${e.message}` }], isError: true };
    }
  }
);

// Shared contact resolution helper (used by multiple tools)
async function resolveContact(supabase, contact_name, org) {
  const { data: exact } = await supabase
    .from("contacts")
    .select("id, name, org, warmth, status")
    .ilike("name", contact_name);

  let matches = exact || [];

  if (!matches.length) {
    const { data: partial } = await supabase
      .from("contacts")
      .select("id, name, org, warmth, status")
      .ilike("name", `%${contact_name}%`);
    matches = partial || [];
  }

  if (!matches.length) {
    return { error: { content: [{ type: "text", text: `No contact found matching "${contact_name}"${org ? ` at ${org}` : ""}. Use harold_upsert_contact to create them first.` }], isError: true } };
  }

  if (matches.length > 1 && org) {
    const orgFiltered = matches.filter(m =>
      m.org && m.org.toLowerCase().includes(org.toLowerCase())
    );
    if (orgFiltered.length >= 1) matches = orgFiltered;
  }

  if (matches.length > 1) {
    const list = matches.slice(0, 5).map(m => `  - ${m.name} (${m.org || "no org"}) [${m.warmth || "no warmth"}] — id: ${m.id}`).join("\n");
    return { multiple: { content: [{ type: "text", text: `Multiple contacts match "${contact_name}". Please specify:\n${list}\n\nUse contact_id for exact targeting.` }] } };
  }

  return { id: matches[0].id, name: matches[0].name };
}

// ── Start Server ──────────────────────────────────────────────────
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Harold Memory Sync MCP server running");
}

main().catch(console.error);
