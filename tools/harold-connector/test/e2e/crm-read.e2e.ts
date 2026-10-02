// CRM READ tools against your live Supabase CRM. Runs only when SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are set in the environment (for example: set -a; . ~/.harold/env; set +a),
// plus the HAROLD_REPO / GITHUB_TOKEN of the read run. No CRM write tool is called here.
import { check, connect, crmConfigured, done, e2eSetup, isErr, mintAccessToken, oneLine, skip, startLocal, textOf } from "./common.js";

if (!crmConfigured()) skip("set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (and HAROLD_REPO, GITHUB_TOKEN) to run the CRM read checks");
const env = await e2eSetup();
const srv = await startLocal(env.repo, env.branch, env.user, true);
const c = await connect(srv.base, await mintAccessToken(env.token), "v1");

const s = await c.call("crm_search_contacts", { limit: 3, order_by: "updated_at" });
const st = textOf(s);
check("crm_search_contacts(limit=3)", !isErr(s) && /^(Found \d+ contact|No contacts found)/.test(st), oneLine(st.split("\n")[0]));

const firstName = (st.match(/^1\. \*\*(.+?)\*\*/m) || [])[1];
if (firstName) {
  const g = await c.call("crm_get_contact", { contact_name: firstName, interaction_limit: 3 });
  const gt = textOf(g);
  check("crm_get_contact(<first result>)", !isErr(g) && gt.startsWith("# ") && /\*\*ID:\*\* [0-9a-f-]{36}/.test(gt), `${gt.split("\n").length} lines, sections: ${(gt.match(/^## .+$/gm) || []).join(", ") || "none"}`);
  const p = await c.call("harold_person", { name: firstName });
  const pt = textOf(p);
  check("harold_person(<first result>) includes the CRM record", !isErr(p) && pt.includes("## CRM") && !/not configured/.test(pt));
}
const kw = await c.call("crm_search_contacts", { keyword: "a", limit: 2 });
check("crm_search_contacts(keyword=a)", !isErr(kw), oneLine(textOf(kw).split("\n")[0]));

const pl = await c.call("crm_pipeline", { action: "list" });
check("crm_pipeline(list) (read-only action)", !isErr(pl), oneLine(textOf(pl).split("\n")[0]));

await c.close();
await srv.close();
done();
