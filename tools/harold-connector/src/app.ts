// The HTTP surface: OAuth endpoints, metadata, and the MCP endpoint at /mcp.

import { Hono } from "hono";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { config, ownerRule, publicBaseUrl, repoConfig, tokenKey } from "./config.js";
import { open } from "./crypto.js";
import { checkTokenIdentityOnce, type FetchLike } from "./identity.js";
import { PAT_PREFIX, verifyPat } from "./pat.js";
import { HaroldRepo } from "./github.js";
import { instructions } from "./instructions.js";
import * as oauth from "./oauth.js";
import * as google from "./google.js";
import { registerTools, defaultDeps, type ToolDeps } from "./tools.js";
import { registerSyncRoutes, defaultSyncDeps, type SyncDeps } from "./sync/routes.js";

export interface AppOptions { fetch?: FetchLike; tools?: ToolDeps; now?: () => number; lookup?: oauth.LookupLike; sync?: SyncDeps }

export function verifyAccessToken(fetchImpl: FetchLike) {
  return async (_req: Request, bearer?: string): Promise<AuthInfo | undefined> => {
    if (!bearer) return undefined;
    // A personal access token (src/pat.ts): sealed under its own purpose, minted only by the TOKEN_KEY
    // holder for the owner after a GitHub check, so no GitHub round trip here when the owner is named.
    // When the owner is the repository's owner, only GitHub can say who that is: check once per token.
    // Revocable by id.
    if (bearer.startsWith(PAT_PREFIX)) {
      const c = config();
      const pat = verifyPat(c.tokenKey, bearer, c.owner.kind === "account" ? { login: c.owner.login, id: c.owner.id } : null);
      if (!pat) return undefined;
      // Re-checked at least daily (a PAT can live a year), like an OAuth access token.
      const recheck = Math.min(pat.exp, Math.floor(Date.now() / 1000) + oauth.ACCESS_TTL);
      if (c.owner.kind === "repo-owner" && await checkTokenIdentityOnce(bearer, pat.gh, c.owner, recheck, fetchImpl) !== pat.uid) return undefined;
      return { token: bearer, clientId: `pat:${pat.id}`, scopes: [oauth.SCOPE], expiresAt: pat.exp, resource: new URL(oauth.resourceUrl(c)), extra: { gh: pat.gh, login: pat.login, pat: pat.id } };
    }
    const p = open<oauth.AccessPayload & Record<string, unknown>>(tokenKey(), "access", bearer);
    if (!p || typeof p.gh !== "string" || typeof p.exp !== "number") return undefined;
    const c = config();
    const uid = await checkTokenIdentityOnce(bearer, p.gh, c.owner, p.exp, fetchImpl);
    if (uid === null) return undefined;
    return { token: bearer, clientId: p.client_id, scopes: [oauth.SCOPE], expiresAt: p.exp, resource: new URL(oauth.resourceUrl(c)), extra: { gh: p.gh, login: p.login } };
  };
}

/**
 * The connector's home page: the /mcp address once it is ready, and until then exactly what is missing. Right after
 * a first deploy, GitHub sign-in is not set up yet, so it spells out what to paste into GitHub's "New OAuth App"
 * form. It shows nothing secret, and the address it names is this deployment's configured address, never one taken
 * from the request.
 */
export function homePage(): string {
  let base = "";
  const missing: string[] = [];
  try { base = publicBaseUrl(); } catch (e) { missing.push(e instanceof Error ? e.message : String(e)); }
  const lines = ["Harold connector.", "", "This is a private MCP server for one person."];
  const hasGithub = !!(process.env.GITHUB_CLIENT_ID || "").trim() && !!(process.env.GITHUB_CLIENT_SECRET || "").trim();
  if (base && !hasGithub) {
    lines.push("", "Not ready: GitHub sign-in is not set up yet. To finish:", "",
      "1. Open https://github.com/settings/applications/new (GitHub: Settings, Developer settings, OAuth Apps, New OAuth App) and fill in:",
      "     Application name:            Harold connector (any name)",
      `     Homepage URL:                ${base}`,
      `     Authorization callback URL:  ${base}/github/callback`,
      "   Leave Enable Device Flow off. Register the application, then press Generate a new client secret.",
      "2. Add two environment variables to this deployment (on Vercel: the project's Settings, Environment Variables):",
      "     GITHUB_CLIENT_ID      the application's Client ID",
      "     GITHUB_CLIENT_SECRET  the client secret you just generated",
      "3. Redeploy (on Vercel: Deployments, the latest one, Redeploy), then open this page again.");
  }
  else if (base) {
    lines.push(`Add it in any MCP client as a remote (Streamable HTTP) server with the URL ${base}/mcp`,
      "Sign-in is OAuth with GitHub; tools without OAuth can use a personal access token (npm run token).", "",
      `The GitHub OAuth App's Authorization callback URL must be ${base}/github/callback (after adding a domain, update it there).`);
  }
  if (!hasGithub && !base) missing.push("Missing environment variables GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET (from a GitHub OAuth App)");
  // Without the client secret the key cannot be derived yet; that is already covered by the steps above.
  const checks: (() => unknown)[] = [() => ownerRule(), () => repoConfig()];
  if (hasGithub || (process.env.TOKEN_KEY || "").trim()) checks.unshift(() => tokenKey());
  for (const check of checks) {
    try { check(); } catch (e) { missing.push(e instanceof Error ? e.message : String(e)); }
  }
  for (const m of [...new Set(missing)]) lines.push("", `Not ready: ${m}`);
  return lines.join("\n") + "\n";
}

export function createApp(opts: AppOptions = {}) {
  const fetchImpl: FetchLike = opts.fetch || ((i, init) => fetch(i, init));
  const deps: oauth.Deps = { fetch: fetchImpl, now: opts.now, lookup: opts.lookup };
  const tools = opts.tools || defaultDeps;
  const sync = opts.sync || defaultSyncDeps(fetchImpl);

  const handler = createMcpHandler(server => registerTools(server, tools), {
    serverInfo: { name: "harold", version: "0.1.0" },
    instructions: instructions(),
    // Every request must finish as soon as its answer is sent: on Vercel, memory is billed for as long as a
    // connection stays open. The tool list never changes while the server runs, so do not advertise
    // tools.listChanged (clients then never open a long-lived `subscriptions/listen` stream), and refuse such a
    // stream outright (maxSubscriptions: 0) if a client asks anyway.
    capabilities: { tools: { listChanged: false } },
    maxSubscriptions: 0,
  });

  // The task sync's project-map cache and tasks snapshot need the owner's GitHub access, which only authenticated
  // requests carry (src/sync/housekeeping.ts). It runs alongside the request, rate-limited, and a failure never
  // changes the answer.
  const mcp = async (req: Request): Promise<Response> => {
    let housekeeping: Promise<void> = Promise.resolve();
    try {
      const info = (req as Request & { auth?: AuthInfo }).auth;
      const gh = (info?.extra as { gh?: unknown } | undefined)?.gh;
      if (typeof gh === "string" && gh) {
        const c = repoConfig();
        housekeeping = sync.housekeeping(new HaroldRepo(gh, c.repo, c.branch, fetchImpl)).catch(() => undefined);
      }
    } catch { /* not configured: skip housekeeping */ }
    const res = await handler(req);
    // Keep the function alive until housekeeping finishes, but never hold the answer more than 5 seconds for it.
    await Promise.race([housekeeping, new Promise(r => setTimeout(r, 5_000).unref?.())]);
    return res;
  };

  const app = new Hono();

  app.get("/", c => c.text(homePage()));

  // Browser-based MCP clients call these straight from a web page: answer the preflight (before the token
  // check, which would refuse it) and mark every response, errors included, as readable cross-origin.
  for (const p of ["/.well-known/*", "/register", "/token", "/mcp", "/mcp/"]) {
    app.use(p, async (c, next) => {
      if (c.req.method === "OPTIONS") return new Response(null, { status: 204, headers: oauth.CORS });
      await next();
      const res = new Response(c.res.body, c.res);
      for (const [k, v] of Object.entries(oauth.CORS)) if (!res.headers.has(k)) res.headers.set(k, v);
      c.res = res;
    });
  }

  app.get("/.well-known/oauth-authorization-server", () => oauth.authorizationServerMetadata());
  app.get("/.well-known/oauth-authorization-server/mcp", () => oauth.authorizationServerMetadata());
  app.get("/.well-known/oauth-protected-resource", () => oauth.protectedResourceMetadata());
  app.get("/.well-known/oauth-protected-resource/mcp", () => oauth.protectedResourceMetadata());

  app.post("/register", c => oauth.register(c.req.raw));
  app.get("/authorize", c => oauth.authorize(c.req.raw, deps));
  app.post("/authorize/approve", c => oauth.approve(c.req.raw, deps));
  app.get("/github/callback", c => oauth.githubCallback(c.req.raw, deps));
  app.post("/token", c => oauth.token(c.req.raw, deps));

  // The connector's own Google sign-in for calendar access (owner-facing, browser navigation).
  app.get("/google/authorize", c => {
    const cfg = config();
    if (!cfg.googleClientId) return c.text("Google is not configured on this connector (GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are not set).", 501);
    return c.redirect(google.authorize(cfg.publicBaseUrl, cfg.googleClientId));
  });
  app.get("/google/callback", c => google.callback(c.req.raw, fetchImpl));

  const authed = (req: Request) => withMcpAuth(mcp, verifyAccessToken(fetchImpl), {
    required: true,
    resourceMetadataPath: "/.well-known/oauth-protected-resource/mcp",
    resourceUrl: config().publicBaseUrl,
  })(req);
  app.all("/mcp", c => authed(c.req.raw));
  app.all("/mcp/", c => authed(new Request(c.req.url.replace(/\/mcp\/(\?|$)/, "/mcp$1"), c.req.raw)));

  // Two-way task sync with each configured provider, Linear, Todoist, Asana and Notion (src/sync): webhooks in, push and catchup called by Supabase.
  registerSyncRoutes(app, sync);

  app.notFound(c => c.text("Not found", 404));
  app.onError((e, c) => { console.error("harold-connector error:", e instanceof Error ? e.message : e); return c.text("Internal error", 500); });
  return app;
}

