// The setup step of the Notion task sync, behind the MCP tool sync_setup_notion: which Notion database (data source)
// holds the tasks and how its properties map to Harold's fields, saved in sync_state 'notion' detail.setup so it
// needs no redeploy. Also the owner's half of the webhook handshake (see src/sync/notion.ts, "Webhooks").
//
//   no arguments          lists the data sources shared with the integration, the saved setup, the webhook state,
//                         and (when exactly one data source is shared and nothing is saved) a proposed mapping
//   database (+ choices)  proposes a mapping for that database and checks it against its real properties; nothing is
//                         saved until the owner says yes (confirm: true with the same choices)
//   webhook "expect"      accepts Notion's verification token for the next 30 minutes
//   webhook "reveal_token" shows the received token once, to paste into Notion's Verify form

import { publicBaseUrl } from "../config.js";
import type { FetchLike } from "../identity.js";
import {
  NotionClient, NotionError, WEBHOOK_EXPECT_MS, buildSetup, dataSourceName, describeSetup, loadNotionState, notionSyncFromEnv, patchNotionState,
  sameId, type DataSource, type NotionSyncConfig, type SetupOverrides,
} from "./notion.js";
import type { SyncStore } from "./store.js";

export interface NotionSetupArgs extends SetupOverrides {
  database?: string;
  confirm?: boolean;
  webhook?: "expect" | "reveal_token";
}

export interface NotionSetupDeps {
  store: () => SyncStore | null;
  fetch: FetchLike;
  now: () => number;
  config?: () => NotionSyncConfig | null;
  baseUrl?: () => string;
}

type Out = { text: string; isError?: boolean };

/** A Notion id from an id, a dashed UUID or a Notion URL (the id in the path; a ?v= view id is ignored). */
export function notionIdFrom(s: string): string | null {
  let t = s.trim();
  try { if (/^https?:\/\//i.test(t)) t = new URL(t).pathname; } catch { /* not a URL */ }
  const ids = t.replace(/-/g, "").match(/[0-9a-f]{32}/gi);
  if (!ids) return null;
  const h = ids[ids.length - 1].toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const listLine = (d: DataSource, i: number) => `${i + 1}. ${dataSourceName(d)} (data source ${d.id}${d.parent?.database_id ? `, database ${d.parent.database_id}` : ""})`;
const propertyList = (d: DataSource) => Object.entries(d.properties || {}).map(([n, p]) => `${n} (${p.type.replace("_", " ")})`).join(", ");

/** Finds the data source the owner named: a data source id, a database id or URL, or a name. */
async function resolve(api: NotionClient, given: string): Promise<{ ds: DataSource; databaseId: string } | { error: string }> {
  const id = notionIdFrom(given);
  if (id) {
    try {
      const ds = await api.dataSource(id);
      return { ds, databaseId: ds.parent?.database_id || id };
    } catch (e) { if (!(e instanceof NotionError) || (e.status !== 404 && e.status !== 400)) throw e; }
    try {
      const db = await api.database(id);
      const list = db.data_sources || [];
      if (!list.length) return { error: `The database ${id} has no data source the integration can read.` };
      if (list.length > 1) return { error: `That database has ${list.length} data sources; say which one holds the tasks:\n${list.map((d, i) => `${i + 1}. ${d.name} (data source ${d.id})`).join("\n")}` };
      return { ds: await api.dataSource(list[0].id), databaseId: db.id };
    } catch (e) {
      if (e instanceof NotionError && (e.status === 404 || e.status === 400)) {
        return { error: `Notion has no database or data source ${id} that the integration can see. In Notion, open the database, choose ··· → Connections, and add the integration; then try again.` };
      }
      throw e;
    }
  }
  const all = await api.dataSources();
  const want = given.trim().toLowerCase();
  const hits = all.filter(d => dataSourceName(d).toLowerCase() === want);
  const loose = hits.length ? hits : all.filter(d => dataSourceName(d).toLowerCase().includes(want));
  if (!loose.length) return { error: `No database called "${given}" is shared with the integration.${all.length ? ` Shared: ${all.map(d => `"${dataSourceName(d)}"`).join(", ")}.` : " None is shared yet: in Notion, open the database, choose ··· → Connections, and add the integration."}` };
  if (loose.length > 1) return { error: `Several databases match "${given}"; name one by its id:\n${loose.map(listLine).join("\n")}` };
  const ds = loose[0].properties && Object.keys(loose[0].properties).length ? loose[0] : await api.dataSource(loose[0].id);
  return { ds, databaseId: ds.parent?.database_id || loose[0].parent?.database_id || "" };
}

function webhookStatus(w: { token?: string; received_at?: string; expect_until?: string }, cfg: NotionSyncConfig, now: number, base: string): string {
  const url = `${base}/webhooks/notion`;
  if (cfg.webhookSecret) return `Webhook: signatures are checked with NOTION_WEBHOOK_SECRET (subscription URL ${url}).`;
  if (w.token) return `Webhook: a verification token arrived ${w.received_at}; signatures are checked with it. If you have not pasted it into Notion's Verify form yet, ask me to reveal it.`;
  const until = Date.parse(w.expect_until || "");
  if (Number.isFinite(until) && until > now) return `Webhook: waiting for Notion's verification token until ${new Date(until).toISOString()} (subscription URL ${url}).`;
  return `Webhook: not set up (optional; without it changes in Notion reach Harold within 10 minutes). To add it, ask me to expect the Notion webhook, then create a subscription in Notion with the URL ${url}.`;
}

export async function setupNotion(args: NotionSetupArgs, deps: NotionSetupDeps): Promise<Out> {
  const cfg = (deps.config || notionSyncFromEnv)();
  if (!cfg) return { text: "Notion is not connected: set NOTION_TOKEN in the connector's environment (the secret of an internal integration, from notion.so/profile/integrations), redeploy, and share the task database with that integration (in Notion: ··· → Connections).", isError: true };
  const store = deps.store();
  if (!store) return { text: "The task sync's database is not configured (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY), so a Notion setup cannot be saved.", isError: true };
  const now = deps.now();
  const base = (deps.baseUrl?.() || (() => { try { return publicBaseUrl(); } catch { return ""; } })() || "<the connector's URL>").replace(/\/+$/, "");
  let state = await loadNotionState(store);

  // Once NOTION_WEBHOOK_SECRET holds the received token, the stored copy is no longer needed.
  if (cfg.webhookSecret && state.webhook.token && state.webhook.token === cfg.webhookSecret) {
    await patchNotionState(store, { webhook: { received_at: state.webhook.received_at } });
    state = await loadNotionState(store);
  }

  if (args.webhook === "expect") {
    const until = new Date(now + WEBHOOK_EXPECT_MS).toISOString();
    await patchNotionState(store, { webhook: { ...state.webhook, expect_until: until } });
    return { text: [
      `Ready for Notion's verification token until ${until} (30 minutes).`,
      `1. In Notion, open your integration's settings (notion.so/profile/integrations), Webhooks tab, and create a subscription with the URL ${base}/webhooks/notion, choosing the page events (created, properties updated, deleted, undeleted, moved). If the subscription already exists, press "Resend token" in its Verify dialog.`,
      `2. Notion sends a one-time verification token to Harold. Then ask me to reveal it and paste it into Notion's Verify form.`,
      `Any token that arrives outside this window is refused, so nobody else can set it.`,
    ].join("\n") };
  }

  if (args.webhook === "reveal_token") {
    if (!state.webhook.token) {
      return { text: cfg.webhookSecret
        ? "The webhook token is already in NOTION_WEBHOOK_SECRET, and Harold keeps no copy of it."
        : "No verification token has arrived yet. Ask me to expect the Notion webhook, then create the subscription (or press Resend token) in Notion.", isError: !cfg.webhookSecret };
    }
    return { text: [
      `Notion's verification token (received ${state.webhook.received_at}):`,
      "",
      state.webhook.token,
      "",
      "Paste it into the Verify form of the subscription in Notion's Webhooks tab. It is a secret: it signs every webhook, so do not put it anywhere else.",
      "Harold already checks signatures with it. Optionally, set NOTION_WEBHOOK_SECRET to the same value in the connector's environment; after the next redeploy Harold erases its stored copy.",
    ].join("\n") };
  }

  const api = new NotionClient(cfg.token, deps.fetch);
  const overrides: SetupOverrides = { fields: args.fields, status_map: args.status_map, priority_map: args.priority_map };

  if (!args.database) {
    const all = await api.dataSources();
    const lines: string[] = [];
    if (state.setup) lines.push("Current setup:", describeSetup(state.setup), "");
    else lines.push("Notion is connected but not set up yet: the sync skips Notion until a database is chosen.", "");
    if (!all.length) lines.push("No database is shared with the integration. In Notion, open the task database, choose ··· → Connections, and add the integration; then ask again.");
    else lines.push("Databases shared with the integration:", ...all.map(listLine));
    if (!state.setup && all.length === 1) {
      const ds = all[0].properties && Object.keys(all[0].properties).length ? all[0] : await api.dataSource(all[0].id);
      const b = buildSetup(ds, ds.parent?.database_id || "", overrides, deps.now);
      lines.push("", ...proposalText(ds, b));
    } else if (all.length) lines.push("", "Tell me which one holds the tasks and I will propose how its properties map to Harold's fields.");
    lines.push("", webhookStatus(state.webhook, cfg, now, base));
    return { text: lines.join("\n") };
  }

  const r = await resolve(api, args.database);
  if ("error" in r) return { text: r.error, isError: true };
  const b = buildSetup(r.ds, r.databaseId, overrides, deps.now);
  if (!b.setup) return { text: proposalText(r.ds, b).join("\n"), isError: true };
  if (!args.confirm) return { text: proposalText(r.ds, b).join("\n") };

  const switching = !!state.setup && !sameId(state.setup.data_source_id, b.setup.data_source_id);
  // A new data source starts from a fresh cursor; re-saving the same one keeps it.
  await patchNotionState(store, { setup: b.setup }, switching ? null : undefined);
  return { text: [
    "Saved. The Notion task sync now uses:",
    describeSetup(b.setup),
    ...(b.notes.length ? ["", ...b.notes.map(n => `Note: ${n}`)] : []),
    ...(switching ? ["", `This replaces ${state.setup!.name}. Pages of that database stop syncing; their Harold tasks are kept as they are.`] : []),
    "",
    "Next: the first import brings in every open page, plus finished ones edited in the last 30 days (POST /sync/catchup with {\"import\": true, \"provider\": \"notion\"}, or npm run sync:import -- notion). After that the 10-minute catchup keeps both sides in step.",
    webhookStatus(state.webhook, cfg, now, base),
  ].join("\n") };
}

function proposalText(ds: DataSource, b: ReturnType<typeof buildSetup>): string[] {
  if (!b.setup) {
    return [
      `This mapping for ${dataSourceName(ds)} does not work yet:`,
      ...b.problems.map(p => `- ${p}`),
      "",
      `Its properties: ${propertyList(ds) || "none"}.`,
      "Tell me which property to use for each field (fields), or which option means each status (status_map).",
    ];
  }
  return [
    `Proposed mapping for ${dataSourceName(ds)} (not saved yet):`,
    describeSetup(b.setup),
    ...(b.notes.length ? ["", ...b.notes.map(n => `Note: ${n}`)] : []),
    "",
    `All its properties: ${propertyList(ds)}.`,
    "If this is right, say so and I will save it (the same call with confirm: true). To change a choice, name the property or option to use instead.",
  ];
}
