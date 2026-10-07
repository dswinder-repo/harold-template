// OAuth flow simulation against the real app with a mocked GitHub:
// discovery → DCR → authorize → GitHub callback → token → MCP call → refresh,
// driven by the MCP SDK 1.31 client's own OAuth helpers (so a standard client interoperates),
// plus every rejection path.

import { beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  discoverAuthorizationServerMetadata, discoverOAuthProtectedResourceMetadata, exchangeAuthorization, refreshAuthorization, registerClient, startAuthorization,
} from "@modelcontextprotocol/sdk/client/auth.js";
import { createApp } from "../../src/app.js";
import { _resetIdentityCache } from "../../src/identity.js";
import { _resetOauthCaches, issueTokens } from "../../src/oauth.js";
import { config } from "../../src/config.js";
import { seal, pkceChallenge } from "../../src/crypto.js";
import { TOOL_NAMES, type ToolDeps } from "../../src/tools.js";
import { HaroldRepo } from "../../src/github.js";
import { FakeGithub } from "./fakes.js";
import { OWNER, REPO, STRANGER, setTestEnv } from "./env.js";

const BASE = "https://harold-connector.example.com";
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";

let gh: FakeGithub;
let app: ReturnType<typeof createApp>;
const appFetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => app.fetch(url instanceof Request ? url : new Request(url, init));

beforeEach(() => {
  setTestEnv({ PUBLIC_BASE_URL: BASE });
  _resetOauthCaches(); _resetIdentityCache();
  gh = new FakeGithub();
  gh.users.set("tok-owner", OWNER);
  gh.users.set("tok-stranger", STRANGER);
  gh.oauthCodes.set("gh-code-owner", "tok-owner");
  gh.oauthCodes.set("gh-code-stranger", "tok-stranger");
  gh.files.set("harold/projects.md", "## Harold\n- folder: harold\n- status: active\n- aliases: harold\n");
  const tools: ToolDeps = {
    repoFor: ctx => new HaroldRepo(String((ctx.http?.authInfo?.extra as { gh: string }).gh), REPO, "main", gh.fetch),
    supabase: () => null,
  };
  app = createApp({ fetch: gh.fetch, tools });
});

async function discoverAndRegister() {
  const prm = await discoverOAuthProtectedResourceMetadata(`${BASE}/mcp`, {}, appFetch);
  const as = String(prm.authorization_servers![0]);
  const metadata = (await discoverAuthorizationServerMetadata(as, { fetchFn: appFetch }))!;
  const clientInformation = await registerClient(as, {
    metadata, fetchFn: appFetch,
    clientMetadata: { client_name: "Claude", redirect_uris: [REDIRECT], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" },
  });
  return { prm, as, metadata, clientInformation };
}

/** authorize → GitHub (simulated) → callback; returns Claude's redirect URL */
async function signIn(as: string, metadata: Awaited<ReturnType<typeof discoverAndRegister>>["metadata"], clientInformation: Awaited<ReturnType<typeof discoverAndRegister>>["clientInformation"], githubCode: string) {
  const { authorizationUrl, codeVerifier } = await startAuthorization(as, { metadata, clientInformation, redirectUrl: REDIRECT, scope: "harold", state: "claude-state-123", resource: new URL(`${BASE}/mcp`) });
  const a = await appFetch(authorizationUrl.toString());
  expect(a.status).toBe(200); // consent page
  expect(a.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  const html = await a.text();
  const request = html.match(/name="request" value="([^"]+)"/)![1];
  const cookie = a.headers.get("set-cookie")!.split(";")[0];
  // the button is a form post that must carry the nonce cookie set with the page
  const csrf = await appFetch(`${BASE}/authorize/approve`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ request }) });
  expect(csrf.status).toBe(403);
  const ok = await appFetch(`${BASE}/authorize/approve`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", cookie }, body: new URLSearchParams({ request }) });
  expect(ok.status).toBe(303);
  const toGithub = new URL(ok.headers.get("location")!);
  expect(toGithub.origin + toGithub.pathname).toBe("https://github.com/login/oauth/authorize");
  expect(toGithub.searchParams.get("scope")).toBe("repo");
  expect(toGithub.searchParams.get("redirect_uri")).toBe(`${BASE}/github/callback`);
  const cb = await appFetch(`${BASE}/github/callback?code=${githubCode}&state=${encodeURIComponent(toGithub.searchParams.get("state")!)}`);
  expect(cb.status).toBe(302);
  return { back: new URL(cb.headers.get("location")!), codeVerifier };
}

describe("OAuth flow (mocked GitHub)", () => {
  it("metadata and 401 challenge", async () => {
    const r = await appFetch(`${BASE}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
    expect(r.status).toBe(401);
    expect(r.headers.get("www-authenticate")).toContain(`resource_metadata="${BASE}/.well-known/oauth-protected-resource/mcp"`);
    const { prm, metadata } = await discoverAndRegister();
    expect(prm.resource).toBe(`${BASE}/mcp`);
    expect(metadata.code_challenge_methods_supported).toEqual(["S256"]);
    expect(metadata.registration_endpoint).toBe(`${BASE}/register`);
    expect((metadata as Record<string, unknown>).authorization_response_iss_parameter_supported).toBe(true);
  });

  it("browser clients: preflight answered before the token check, and responses readable cross-origin", async () => {
    for (const path of ["/mcp", "/mcp/", "/token", "/register", "/.well-known/oauth-protected-resource/mcp"]) {
      const pre = await appFetch(`${BASE}${path}`, { method: "OPTIONS", headers: { origin: "https://inspector.example", "access-control-request-method": "POST", "access-control-request-headers": "authorization, content-type" } });
      expect(pre.status, path).toBe(204);
      expect(pre.headers.get("access-control-allow-headers"), path).toContain("Authorization");
    }
    const r = await appFetch(`${BASE}/mcp`, { method: "POST", headers: { origin: "https://inspector.example", "content-type": "application/json" }, body: "{}" });
    expect(r.status).toBe(401);
    expect(r.headers.get("access-control-allow-origin")).toBe("*");
    expect(r.headers.get("access-control-expose-headers")).toContain("WWW-Authenticate");
    const t = await appFetch(`${BASE}/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "grant_type=nope" });
    expect(t.headers.get("access-control-allow-origin")).toBe("*");
    const slash = await appFetch(`${BASE}/mcp/`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(slash.status).toBe(401); // same endpoint, not a 404
  });

  it("authorize → callback → token → MCP → refresh (owner)", async () => {
    const { as, metadata, clientInformation } = await discoverAndRegister();
    const { back, codeVerifier } = await signIn(as, metadata, clientInformation, "gh-code-owner");
    expect(back.origin + back.pathname).toBe(REDIRECT);
    expect(back.searchParams.get("state")).toBe("claude-state-123");
    expect(back.searchParams.get("iss")).toBe(BASE); // RFC 9207 (Gemini CLI requires it)
    const code = back.searchParams.get("code")!;
    expect(code).toBeTruthy();

    const tokens = await exchangeAuthorization(as, { metadata, clientInformation, authorizationCode: code, codeVerifier, redirectUri: REDIRECT, resource: new URL(`${BASE}/mcp`), fetchFn: appFetch });
    expect(tokens.token_type).toBe("Bearer");
    expect(tokens.expires_in).toBe(86400);
    expect(tokens.refresh_token).toBeTruthy();

    // replaying the code fails
    await expect(exchangeAuthorization(as, { metadata, clientInformation, authorizationCode: code, codeVerifier, redirectUri: REDIRECT, fetchFn: appFetch })).rejects.toThrow();

    // the access token works on /mcp (SDK 1.31 client, Streamable HTTP)
    const client = new Client({ name: "oauth-flow-test", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), { fetch: appFetch, requestInit: { headers: { Authorization: `Bearer ${tokens.access_token}` } } }));
    const list = await client.listTools();
    expect(list.tools.map(t => t.name).sort()).toEqual([...TOOL_NAMES].sort());
    const where = await client.callTool({ name: "harold_where", arguments: { topic: "harold" } });
    expect((where.content as { text: string }[])[0].text).toMatch(/^Harold \[active\]/);
    await client.close();

    const refreshed = await refreshAuthorization(as, { metadata, clientInformation, refreshToken: tokens.refresh_token!, fetchFn: appFetch });
    expect(refreshed.access_token).toBeTruthy();
    expect(refreshed.access_token).not.toBe(tokens.access_token);
    const again = new Client({ name: "oauth-flow-test", version: "1.0.0" });
    await again.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), { fetch: appFetch, requestInit: { headers: { Authorization: `Bearer ${refreshed.access_token}` } } }));
    expect((await again.listTools()).tools.length).toBe(TOOL_NAMES.length);
    await again.close();

    // a refresh token or authorization code is not an access token
    for (const wrong of [tokens.refresh_token!, code]) {
      const r = await appFetch(`${BASE}/mcp`, { method: "POST", headers: { Authorization: `Bearer ${wrong}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: "{}" });
      expect(r.status).toBe(401);
    }
  });

  it("rejects a GitHub user who is not the owner (and revokes their grant)", async () => {
    const { as, metadata, clientInformation } = await discoverAndRegister();
    const { back } = await signIn(as, metadata, clientInformation, "gh-code-stranger");
    expect(back.searchParams.get("error")).toBe("access_denied");
    expect(back.searchParams.get("code")).toBeNull();
    expect(back.searchParams.get("state")).toBe("claude-state-123");
    expect(gh.revoked).toEqual(["tok-stranger"]);
  });

  it("rejects an access token whose GitHub identity is someone else, even if correctly sealed", async () => {
    const t = issueTokens(config(), { gh: "tok-stranger", login: OWNER.login, uid: OWNER.id, client_id: "x" });
    const r = await appFetch(`${BASE}/mcp`, { method: "POST", headers: { Authorization: `Bearer ${t.access_token}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
    expect(r.status).toBe(401);
  });

  it("with ALLOWED_REDIRECT_HOSTS set, rejects a redirect URI on another host at registration and at authorize", async () => {
    const { as, metadata, clientInformation } = await discoverAndRegister();
    await expect(registerClient(as, { metadata, fetchFn: appFetch, clientMetadata: { redirect_uris: ["https://evil.example/cb"], client_name: "x" } })).rejects.toThrow();
    // A registered client asking to send the code somewhere else gets a 400 page, never a redirect.
    const challenge = pkceChallenge("v".repeat(50));
    for (const redirect of ["https://evil.example/cb", "https://claude.com/api/mcp/auth_callback"]) {
      const u = `${BASE}/authorize?response_type=code&client_id=${encodeURIComponent(clientInformation.client_id)}&redirect_uri=${encodeURIComponent(redirect)}&code_challenge=${challenge}&code_challenge_method=S256&state=s`;
      const r = await appFetch(u);
      expect(r.status).toBe(400);
      expect(r.headers.get("location")).toBeNull();
    }
    // A forged client_id (not sealed by us) is refused.
    const forged = await appFetch(`${BASE}/authorize?response_type=code&client_id=forged&redirect_uri=${encodeURIComponent(REDIRECT)}&code_challenge=${challenge}&code_challenge_method=S256`);
    expect(forged.status).toBe(400);
  });

  it("requires PKCE S256 and verifies it at /token", async () => {
    const { as, metadata, clientInformation } = await discoverAndRegister();
    const cid = encodeURIComponent(clientInformation.client_id);
    const redir = encodeURIComponent(REDIRECT);
    const noPkce = await appFetch(`${BASE}/authorize?response_type=code&client_id=${cid}&redirect_uri=${redir}&state=s`);
    expect(new URL(noPkce.headers.get("location")!).searchParams.get("error")).toBe("invalid_request");
    const plain = await appFetch(`${BASE}/authorize?response_type=code&client_id=${cid}&redirect_uri=${redir}&code_challenge=${"a".repeat(43)}&code_challenge_method=plain`);
    expect(new URL(plain.headers.get("location")!).searchParams.get("error")).toBe("invalid_request");

    const { back } = await signIn(as, metadata, clientInformation, "gh-code-owner");
    const code = back.searchParams.get("code")!;
    const bad = await appFetch(`${BASE}/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: clientInformation.client_id, redirect_uri: REDIRECT, code_verifier: "w".repeat(50) }) });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toBe("invalid_grant");
    const wrongClient = await appFetch(`${BASE}/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: "someone-else", redirect_uri: REDIRECT, code_verifier: "w".repeat(50) }) });
    expect(wrongClient.status).toBe(400);
  });

  it("expired codes and refresh tokens, and a refresh whose GitHub token was revoked, are refused", async () => {
    const c = config();
    const now = Math.floor(Date.now() / 1000);
    const v = "x".repeat(60);
    const oldCode = seal(c.tokenKey, "code", { gh: "tok-owner", login: OWNER.login, uid: OWNER.id, cc: pkceChallenge(v), client_id: "cid", redirect_uri: REDIRECT, exp: now - 1 });
    const r1 = await appFetch(`${BASE}/token`, { method: "POST", body: new URLSearchParams({ grant_type: "authorization_code", code: oldCode, client_id: "cid", redirect_uri: REDIRECT, code_verifier: v }) });
    expect(r1.status).toBe(400);
    const oldRefresh = seal(c.tokenKey, "refresh", { gh: "tok-owner", login: OWNER.login, uid: OWNER.id, client_id: "cid", exp: now - 1 });
    expect((await appFetch(`${BASE}/token`, { method: "POST", body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: oldRefresh }) })).status).toBe(400);
    const revoked = issueTokens(c, { gh: "tok-gone", login: OWNER.login, uid: OWNER.id, client_id: "cid" });
    const r3 = await appFetch(`${BASE}/token`, { method: "POST", body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: revoked.refresh_token }) });
    expect(r3.status).toBe(400);
    expect(((await r3.json()) as { error: string }).error).toBe("invalid_grant");
  });

  it("an expired sign-in state is refused", async () => {
    const c = config();
    const st = seal(c.tokenKey, "state", { client_id: "x", redirect_uri: REDIRECT, code_challenge: "c", state: "", exp: Math.floor(Date.now() / 1000) - 5 });
    const r = await appFetch(`${BASE}/github/callback?code=gh-code-owner&state=${st}`);
    expect(r.status).toBe(400);
  });

  it("with ALLOWED_REDIRECT_HOSTS set, accepts a Client ID Metadata Document client_id on an allowed host only", async () => {
    const CIMD = "https://claude.ai/oauth/mcp-client-metadata.json";
    const docs: Record<string, unknown> = {
      [CIMD]: { client_id: CIMD, client_name: "Claude", redirect_uris: [REDIRECT] },
      "https://claude.ai/oauth/lying.json": { client_id: "https://claude.ai/other.json", redirect_uris: [REDIRECT] },
    };
    const wrapped = async (u: string | URL | Request, init?: RequestInit) => {
      const url = String(u instanceof Request ? u.url : u);
      if (url in docs) return new Response(JSON.stringify(docs[url]), { headers: { "content-type": "application/json" } });
      return gh.fetch(u, init);
    };
    app = createApp({ fetch: wrapped, tools: { repoFor: () => { throw new Error("unused"); }, supabase: () => null }, lookup: async () => ["160.79.104.10"] });
    const ch = pkceChallenge("c".repeat(50));
    const go = (cid: string) => appFetch(`${BASE}/authorize?response_type=code&client_id=${encodeURIComponent(cid)}&redirect_uri=${encodeURIComponent(REDIRECT)}&code_challenge=${ch}&code_challenge_method=S256&state=s`);
    expect((await go(CIMD)).status).toBe(200);
    expect((await go("https://claude.ai/oauth/lying.json")).status).toBe(400);
    expect((await go("https://evil.example/client.json")).status).toBe(400);
  });
});
