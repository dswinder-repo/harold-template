// Registers the Asana webhooks the connector needs (one per project: Asana sends task events only to project webhooks).
//
//   npm run sync:asana-webhook -- https://<your-connector-host>
//   needs ASANA_ACCESS_TOKEN, ASANA_WORKSPACE (ASANA_PROJECT to cover one project) and SYNC_SECRET, the same values the
//   deployed connector has. The connector must already be deployed with them: Asana calls the target during this very
//   request (the handshake), and the request fails if the connector does not answer it.
//
// The target is https://<host>/webhooks/asana?t=<token>, the token being derived from SYNC_SECRET (src/sync/asana.ts).
// Safe to run again: a project that already has a webhook for this target is left alone. Nothing secret is printed.

import { AsanaProvider, asanaSyncFromEnv } from "../src/sync/asana.js";
import { ProjectMap } from "../src/sync/projectmap.js";

const fail = (m: string): never => { console.error(m); process.exit(1); };
const base = (process.argv[2] || process.env.PUBLIC_BASE_URL || "").trim();
if (!/^https:\/\/[^/]+/.test(base)) fail("Give the connector's public https URL: npm run sync:asana-webhook -- https://<host>");
const cfg = asanaSyncFromEnv() ?? fail("Set ASANA_ACCESS_TOKEN and ASANA_WORKSPACE.");
const syncSecret = (process.env.SYNC_SECRET || "").trim() || fail("Set SYNC_SECRET (the same value as the deployed connector).");
const provider = new AsanaProvider(cfg, new ProjectMap([]), (i, init) => fetch(i, init));
const results = await provider.registerWebhooks(base, syncSecret);
for (const r of results) console.log(`${r.status.padEnd(7)} ${r.name} (${r.project})${r.error ? `: ${r.error}` : ""}`);
if (!results.length) console.log("No projects to watch.");
if (results.some(r => r.status === "failed")) process.exit(2);
