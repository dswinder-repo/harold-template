// Local end-to-end (read-only) against your real Harold repository (HAROLD_REPO @ HAROLD_BRANCH):
// a real HTTP server on localhost, real GitHub API calls, and both MCP client generations
// (SDK 1.31 = 2025-era Streamable HTTP; SDK v2 = 2026-07-28). Skips cleanly without configuration.
import { check, connect, done, e2eSetup, isErr, mintAccessToken, oneLine, startLocal, textOf } from "./common.js";

const env = await e2eSetup();
const srv = await startLocal(env.repo, env.branch, env.user);
const token = await mintAccessToken(env.token);
const { HaroldRepo } = await import("../../src/github.js");
const { TOOL_NAMES } = await import("../../src/tools.js");
const { parseProjects } = await import("../../src/projects.js");
const repo = new HaroldRepo(env.token, env.repo, env.branch);
const tree = (await repo.tree()).map(f => f.path);
const binaryPath = tree.find(p => /\.(docx|png|pdf|xlsx|jpe?g)$/i.test(p));
const personPath = tree.find(p => /^vault\/people\/[^/]+\.md$/.test(p) && !/README\.md$/i.test(p));
const projectsFile = await repo.getText("harold/projects.md").catch(() => null);
const firstProject = projectsFile ? parseProjects(projectsFile.text)[0]?.name : undefined;

// no token → 401 with the RFC 9728 pointer
const noAuth = await fetch(`${srv.base}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
check("POST /mcp without a token is 401 with WWW-Authenticate resource_metadata", noAuth.status === 401 && /resource_metadata=/.test(noAuth.headers.get("www-authenticate") || ""), `${noAuth.status} ${noAuth.headers.get("www-authenticate")}`);
const prm = await (await fetch(`${srv.base}/.well-known/oauth-protected-resource/mcp`)).json() as { resource: string };
check("protected resource metadata", prm.resource === `${srv.base}/mcp`, prm.resource);

for (const sdk of ["v1", "v2"] as const) {
  console.log(`\n── MCP SDK ${sdk === "v1" ? "1.31 (@modelcontextprotocol/sdk)" : "v2 (@modelcontextprotocol/client)"} ──`);
  const c = await connect(srv.base, token, sdk);
  const tools = (await c.list()).tools;
  check(`${sdk} tools/list`, tools.length === TOOL_NAMES.length, `${tools.length} tools`);
  check(`${sdk} instructions delivered`, /harold_today/.test(c.instructions() || ""));

  const today = await c.call("harold_today", {});
  const tt = textOf(today);
  check(`${sdk} harold_today`, !isErr(today) && /^# Harold — \w+day, \d{4}-\d{2}-\d{2}/.test(tt) && tt.includes("## Most recent daily notes"), oneLine(tt.split("\n")[0]) + ` | brief: ${/No brief draft/.test(tt) ? "none" : "present"} | ${tt.length} chars`);

  const search = await c.call("harold_search", { query: "harold", limit: 5 });
  const st = textOf(search);
  check(`${sdk} harold_search`, !isErr(search) && /^(Found \d+ file|Code search)/.test(st) && /can lag/.test(st), oneLine(st.split("\n")[0]));

  const read = await c.call("harold_read", { path: "harold/projects.md" });
  check(`${sdk} harold_read`, !isErr(read) && textOf(read).startsWith("# harold/projects.md\n\n"), `${textOf(read).length} chars`);

  if (binaryPath) {
    const bin = await c.call("harold_read", { path: binaryPath });
    check(`${sdk} harold_read refuses a binary file`, isErr(bin) && /binary file/.test(textOf(bin)));
  }
  const missing = await c.call("harold_read", { path: "harold/no-such-file.md" });
  check(`${sdk} harold_read reports a missing file`, isErr(missing) && /^Not found/.test(textOf(missing)));

  if (firstProject) {
    const where = await c.call("harold_where", { topic: firstProject });
    check(`${sdk} harold_where(<first project>)`, !isErr(where) && textOf(where).startsWith(`${firstProject} [`), oneLine(textOf(where).split("\n")[0]));
  }

  if (personPath) {
    const name = personPath.slice("vault/people/".length, -3);
    const person = await c.call("harold_person", { name });
    const pt = textOf(person);
    check(`${sdk} harold_person(<first card>)`, !isErr(person) && pt.includes(`## Vault card: ${personPath}`), `CRM: ${/not configured/.test(pt) ? "not configured" : "present"}`);
  }

  const list = await c.call("harold_list", { folder: "vault" });
  check(`${sdk} harold_list("vault")`, !isErr(list) && /^vault — \d+ entr/.test(textOf(list)), oneLine(textOf(list).split("\n")[0]));

  const out = await c.call("harold_read", { path: "../etc/passwd" });
  check(`${sdk} path traversal refused`, isErr(out), oneLine(textOf(out), 80));
  await c.close();
}

await srv.close();
done();
