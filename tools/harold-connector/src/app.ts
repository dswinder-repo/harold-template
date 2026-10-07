// The HTTP surface: OAuth endpoints, metadata, and the MCP endpoint at /mcp.

import { Hono } from "hono";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { config, repoConfig, tokenKey } from "./config.js";
import { open } from "./crypto.js";
import { checkTokenIdentityOnce, type FetchLike } from "./identity.js";
import { PAT_PREFIX, verifyPat } from "./pat.js";
import { instructions } from "./instructions.js";
import * as oauth from "./oauth.js";
import { registerTools, defaultDeps, type ToolDeps } from "./tools.js";

export interface AppOptions { fetch?: FetchLike; tools?: ToolDeps; now?: () => number; lookup?: oauth.LookupLike }

export function verifyAccessToken(fetchImpl: FetchLike) {
  return async (_req: Request, bearer?: string): Promise<AuthInfo | undefined> => {
    if (!bearer) return undefined;
    // A personal access token (src/pat.ts): sealed under its own purpose, minted only by the TOKEN_KEY
    // holder for the owner after a GitHub check, so no GitHub round trip here. Revocable by id.
    if (bearer.startsWith(PAT_PREFIX)) {
      const c = config();
      const pat = verifyPat(c.tokenKey, bearer, { login: c.allowedGithubLogin, id: c.allowedGithubId });
      if (!pat) return undefined;
      return { token: bearer, clientId: `pat:${pat.id}`, scopes: [oauth.SCOPE], expiresAt: pat.exp, resource: new URL(oauth.resourceUrl(c)), extra: { gh: pat.gh, login: pat.login, pat: pat.id } };
    }
    const p = open<oauth.AccessPayload & Record<string, unknown>>(tokenKey(), "access", bearer);
    if (!p || typeof p.gh !== "string" || typeof p.exp !== "number") return undefined;
    const c = config();
    const ok = await checkTokenIdentityOnce(bearer, p.gh, c.allowedGithubLogin, c.allowedGithubId, p.exp, fetchImpl);
    if (!ok) return undefined;
    return { token: bearer, clientId: p.client_id, scopes: [oauth.SCOPE], expiresAt: p.exp, resource: new URL(oauth.resourceUrl(c)), extra: { gh: p.gh, login: p.login } };
  };
}

export function createApp(opts: AppOptions = {}) {
  const fetchImpl: FetchLike = opts.fetch || ((i, init) => fetch(i, init));
  const deps: oauth.Deps = { fetch: fetchImpl, now: opts.now, lookup: opts.lookup };
  const tools = opts.tools || defaultDeps;

  const mcp = createMcpHandler(server => registerTools(server, tools), {
    serverInfo: { name: "harold", version: "0.1.0" },
    instructions: instructions(),
  });

  const app = new Hono();

  app.get("/", c => {
    let notReady = "";
    try { repoConfig(); } catch (e) { notReady = `\nNot ready: ${e instanceof Error ? e.message : String(e)}\n`; }
    return c.text("Harold connector.\n\nThis is a private MCP server for one person. Add it in any MCP client as a remote (Streamable HTTP) server with the URL "
      + `${config().publicBaseUrl}/mcp\nSign-in is OAuth with GitHub; tools without OAuth can use a personal access token (npm run token).\n${notReady}`);
  });

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

  const authed = (req: Request) => withMcpAuth(mcp, verifyAccessToken(fetchImpl), {
    required: true,
    resourceMetadataPath: "/.well-known/oauth-protected-resource/mcp",
    resourceUrl: config().publicBaseUrl,
  })(req);
  app.all("/mcp", c => authed(c.req.raw));
  app.all("/mcp/", c => authed(new Request(c.req.url.replace(/\/mcp\/(\?|$)/, "/mcp$1"), c.req.raw)));

  app.notFound(c => c.text("Not found", 404));
  app.onError((e, c) => { console.error("harold-connector error:", e instanceof Error ? e.message : e); return c.text("Internal error", 500); });
  return app;
}
