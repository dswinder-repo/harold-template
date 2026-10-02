// The HTTP surface: OAuth endpoints, metadata, and the MCP endpoint at /mcp.

import { Hono } from "hono";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { config, repoConfig, tokenKey } from "./config.js";
import { open } from "./crypto.js";
import { checkTokenIdentityOnce, type FetchLike } from "./identity.js";
import { instructions } from "./instructions.js";
import * as oauth from "./oauth.js";
import { registerTools, defaultDeps, type ToolDeps } from "./tools.js";

export interface AppOptions { fetch?: FetchLike; tools?: ToolDeps; now?: () => number }

export function verifyAccessToken(fetchImpl: FetchLike) {
  return async (_req: Request, bearer?: string): Promise<AuthInfo | undefined> => {
    if (!bearer) return undefined;
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
  const deps: oauth.Deps = { fetch: fetchImpl, now: opts.now };
  const tools = opts.tools || defaultDeps;

  const mcp = createMcpHandler(server => registerTools(server, tools), {
    serverInfo: { name: "harold", version: "0.1.0" },
    instructions: instructions(),
  });

  const app = new Hono();

  app.get("/", c => {
    let notReady = "";
    try { repoConfig(); } catch (e) { notReady = `\nNot ready: ${e instanceof Error ? e.message : String(e)}\n`; }
    return c.text("Harold connector.\n\nThis is a private MCP server for one person. Add it in your chat app as a custom (remote MCP) connector with the URL "
      + `${config().publicBaseUrl}/mcp\n${notReady}`);
  });

  app.get("/.well-known/oauth-authorization-server", () => oauth.authorizationServerMetadata());
  app.get("/.well-known/oauth-authorization-server/mcp", () => oauth.authorizationServerMetadata());
  app.get("/.well-known/oauth-protected-resource", () => oauth.protectedResourceMetadata());
  app.get("/.well-known/oauth-protected-resource/mcp", () => oauth.protectedResourceMetadata());
  app.options("/.well-known/*", () => new Response(null, { status: 204, headers: oauth.CORS }));
  app.options("/register", () => new Response(null, { status: 204, headers: oauth.CORS }));
  app.options("/token", () => new Response(null, { status: 204, headers: oauth.CORS }));

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

  app.notFound(c => c.text("Not found", 404));
  app.onError((e, c) => { console.error("harold-connector error:", e instanceof Error ? e.message : e); return c.text("Internal error", 500); });
  return app;
}
