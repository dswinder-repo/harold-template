// Personal access tokens: minted with TOKEN_KEY, sealed as their own kind, accepted on /mcp without a
// GitHub round trip, refused when expired, revoked, from another key, over the lifetime cap, for another
// owner, or presented where a client_id, code or refresh token is expected (and vice versa).

import { beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createApp } from "../../src/app.js";
import { config } from "../../src/config.js";
import { open, pkceChallenge, seal } from "../../src/crypto.js";
import { HaroldRepo } from "../../src/github.js";
import { _resetIdentityCache } from "../../src/identity.js";
import { _resetOauthCaches, issueTokens } from "../../src/oauth.js";
import { mintPat, parsePatArgs, PAT_MAX_DAYS, PAT_PREFIX, verifyPat } from "../../src/pat.js";
import { secretScan } from "../../src/text.js";
import { githubTokenFrom } from "../../src/tools.js";
import { FakeGithub } from "./fakes.js";
import { OWNER, REPO, setTestEnv } from "./env.js";

const BASE = "https://harold-connector.example.com";
let gh: FakeGithub;
let app: ReturnType<typeof createApp>;
const appFetch = (url: string, init?: RequestInit) => app.fetch(new Request(url, init));
const mcpPost = (bearer: string) => appFetch(`${BASE}/mcp`, {
  method: "POST", headers: { Authorization: `Bearer ${bearer}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } }),
});
const mint = (over: Partial<{ name: string; days: number; login: string; uid: number; gh: string }> = {}, now?: number) =>
  mintPat(config().tokenKey, { name: "nightly-job", days: 30, login: OWNER.login, uid: OWNER.id, gh: "tok-owner", ...over }, now);

beforeEach(() => {
  setTestEnv({ PUBLIC_BASE_URL: BASE, REVOKED_TOKEN_IDS: "" });
  _resetOauthCaches(); _resetIdentityCache();
  gh = new FakeGithub();
  gh.users.set("tok-owner", OWNER);
  gh.files.set("harold/projects.md", "## Harold\n- folder: harold\n- status: active\n- aliases: harold\n");
  app = createApp({
    fetch: gh.fetch,
    tools: { repoFor: ctx => new HaroldRepo(githubTokenFrom(ctx), REPO, "main", gh.fetch), supabase: () => null },
  });
});

describe("personal access tokens", () => {
  it("a valid PAT works on /mcp with no GitHub identity round trip; the tools act with its GitHub token", async () => {
    const t = mint();
    expect(t.token.startsWith(PAT_PREFIX)).toBe(true);
    const client = new Client({ name: "cron", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), {
      fetch: async (u, init) => app.fetch(new Request(u, init)),
      requestInit: { headers: { Authorization: `Bearer ${t.token}` } },
    }));
    const where = await client.callTool({ name: "harold_where", arguments: { topic: "harold" } });
    expect((where.content as { text: string }[])[0].text).toMatch(/^Harold \[active\]/);
    await client.close();
    expect(gh.calls.filter(c => c === "GET /user")).toEqual([]);
    expect(gh.calls.some(c => c.includes("/contents/harold/projects.md"))).toBe(true);
  });

  it("an expired PAT is refused", async () => {
    const now = Math.floor(Date.now() / 1000);
    const t = mint({ days: 1 }, now - 2 * 86400);
    expect((await mcpPost(t.token)).status).toBe(401);
    expect(verifyPat(config().tokenKey, t.token, OWNER, new Set(), now)).toBeNull();
  });

  it("a revoked PAT is refused (REVOKED_TOKEN_IDS), others keep working", async () => {
    const a = mint({ name: "a" }), b = mint({ name: "b" });
    expect((await mcpPost(a.token)).status).toBe(200);
    process.env.REVOKED_TOKEN_IDS = ` other-id , ${a.id}`;
    expect((await mcpPost(a.token)).status).toBe(401);
    expect((await mcpPost(b.token)).status).toBe(200);
  });

  it("a PAT from another key is refused (rotating TOKEN_KEY revokes them all)", async () => {
    const t = mint();
    setTestEnv({ PUBLIC_BASE_URL: BASE, TOKEN_KEY: randomBytes(32).toString("hex") });
    expect((await mcpPost(t.token)).status).toBe(401);
    const foreign = mintPat(randomBytes(32), { name: "x", days: 30, login: OWNER.login, uid: OWNER.id, gh: "tok-owner" });
    expect(verifyPat(config().tokenKey, foreign.token, OWNER, new Set())).toBeNull();
  });

  it("a PAT for another GitHub id or login is refused, even when sealed with the right key", async () => {
    expect((await mcpPost(mint({ uid: 999 }).token)).status).toBe(401);
    expect((await mcpPost(mint({ login: "someone-else" }).token)).status).toBe(401);
  });

  it("caps the lifetime at 365 days, at minting and at use", () => {
    expect(() => mint({ days: PAT_MAX_DAYS + 1 })).toThrow(/365/);
    expect(() => mint({ days: 0 })).toThrow();
    expect(() => mint({ days: 1.5 })).toThrow();
    expect(() => mint({ name: "" })).toThrow();
    expect(() => mint({ name: "bad\nname" })).toThrow();
    expect(mint({ days: PAT_MAX_DAYS }).token).toBeTruthy();
    const now = Math.floor(Date.now() / 1000);
    const forged = PAT_PREFIX + seal(config().tokenKey, "pat", { id: "x1", name: "long", login: OWNER.login, uid: OWNER.id, gh: "tok-owner", iat: now, exp: now + (PAT_MAX_DAYS + 30) * 86400 });
    expect(verifyPat(config().tokenKey, forged, OWNER, new Set())).toBeNull();
    const noExp = PAT_PREFIX + seal(config().tokenKey, "pat", { id: "x2", name: "forever", login: OWNER.login, uid: OWNER.id, gh: "tok-owner", iat: now });
    expect(verifyPat(config().tokenKey, noExp, OWNER, new Set())).toBeNull();
  });

  it("token confusion: a PAT is never a client_id, code or refresh token, and they are never a PAT", async () => {
    const c = config();
    const pat = mint();
    const inner = pat.token.slice(PAT_PREFIX.length);
    // the PAT's sealed body opens only as "pat"
    for (const p of ["client", "state", "code", "access", "refresh"] as const) expect(open(c.tokenKey, p, inner)).toBeNull();
    // without its prefix, or with the prefix doubled, it is not accepted
    expect((await mcpPost(inner)).status).toBe(401);
    // as a refresh token or an authorization code at /token
    const bodies: Record<string, string>[] = [{ grant_type: "refresh_token", refresh_token: pat.token }, { grant_type: "refresh_token", refresh_token: inner },
      { grant_type: "authorization_code", code: pat.token, client_id: "x", redirect_uri: "http://127.0.0.1/cb", code_verifier: "v".repeat(50) }];
    for (const body of bodies) {
      const r = await appFetch(`${BASE}/token`, { method: "POST", body: new URLSearchParams(body) });
      expect(r.status).toBe(400);
      expect(((await r.json()) as { error: string }).error).toBe("invalid_grant");
    }
    // as a client_id at /authorize
    const a = await appFetch(`${BASE}/authorize?response_type=code&client_id=${encodeURIComponent(pat.token)}&redirect_uri=${encodeURIComponent("http://127.0.0.1/cb")}&code_challenge=${pkceChallenge("v".repeat(50))}&code_challenge_method=S256`);
    expect(a.status).toBe(400);
    // OAuth artefacts dressed up as a PAT
    const oauth = issueTokens(c, { gh: "tok-owner", login: OWNER.login, uid: OWNER.id, client_id: "x" });
    const client = seal(c.tokenKey, "client", { redirect_uris: ["http://127.0.0.1/cb"] });
    for (const blob of [oauth.access_token, oauth.refresh_token, client]) {
      expect(verifyPat(c.tokenKey, PAT_PREFIX + blob, OWNER, new Set())).toBeNull();
      expect((await mcpPost(PAT_PREFIX + blob)).status).toBe(401);
    }
    // and the OAuth access token itself still works as before
    expect((await mcpPost(oauth.access_token)).status).toBe(200);
  });

  it("parses the npm run token arguments", () => {
    expect(parsePatArgs(["--name", "nightly", "--days", "90"])).toEqual({ name: "nightly", days: 90 });
    expect(parsePatArgs(["--name=cron job", "--days=365"])).toEqual({ name: "cron job", days: 365 });
    for (const bad of [[], ["--name", "x"], ["--days", "3"], ["--name", "x", "--days", "366"], ["--name", "x", "--days", "-1"], ["--name", "x", "--days", "1e3"], ["--name", "x;rm", "--days", "3"]])
      expect(() => parsePatArgs(bad), bad.join(" ")).toThrow();
  });

  it("a PAT is caught by the write-time secret scan", () => {
    expect(secretScan(`token: ${mint().token}`)).not.toBeNull();
  });
});
