// The provider registry: every task provider configured in the environment, in a fixed order. Each one is
// optional; with none configured the sync routes answer 503 and Harold's own task list works on its own.
//
//   linear    LINEAR_API_KEY + LINEAR_TEAM_KEY (LINEAR_WEBHOOK_SECRET for its webhook)
//   todoist   TODOIST_API_TOKEN (TODOIST_PROJECT to keep to one project; TODOIST_CLIENT_SECRET for its webhook)
//   asana     ASANA_ACCESS_TOKEN + ASANA_WORKSPACE (ASANA_PROJECT to keep to one project; its webhook needs SYNC_SECRET)
//   notion    NOTION_TOKEN (NOTION_WEBHOOK_SECRET optional); which database and how its fields map is saved in
//             sync_state by the sync_setup_notion tool, and until then the routes skip Notion as "not set up"

import type { FetchLike } from "../identity.js";
import { linearEntry, linearSyncFromEnv } from "./linear.js";
import { asanaEntry, asanaSyncFromEnv } from "./asana.js";
import { notionEntry, notionSyncFromEnv } from "./notion.js";
import type { ProviderEntry } from "./provider.js";
import { todoistEntry, todoistSyncFromEnv } from "./todoist.js";

/** Every provider the connector knows, configured or not (an unknown name in a webhook URL is a 404). */
export const KNOWN_PROVIDERS = ["linear", "todoist", "asana", "notion"] as const;

export function providersFromEnv(fetchImpl: FetchLike, now: () => number = Date.now): ProviderEntry[] {
  const out: ProviderEntry[] = [];
  const linear = linearSyncFromEnv();
  if (linear) out.push(linearEntry(linear, fetchImpl, now));
  const todoist = todoistSyncFromEnv();
  if (todoist) out.push(todoistEntry(todoist, fetchImpl, now));
  const asana = asanaSyncFromEnv();
  if (asana) out.push(asanaEntry(asana, fetchImpl, now));
  const notion = notionSyncFromEnv();
  if (notion) out.push(notionEntry(notion, fetchImpl, now));
  return out;
}
