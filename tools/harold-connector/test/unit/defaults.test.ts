// Fewer settings: every sign-in setting but GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET has a default on Vercel,
// and a variable that is set always wins. Covers PUBLIC_BASE_URL, HAROLD_REPO, the owner (the repository's
// owner, by numeric ids, at sign-in, refresh, /mcp and for personal access tokens), the derived TOKEN_KEY,
// the Supabase key name Vercel's integration uses, and the home page that guides a first deploy.

import { beforeEach, describe, expect, it } from "vitest";
import { hkdfSync, randomBytes } from "node:crypto";
import { createApp, homePage } from "../../src/app.js";
import {
  config, deriveTokenKey, ownerRule, publicBaseUrl, repoConfig, supabaseKeyFromEnv, tokenKey, TOKEN_KEY_INFO, TOKEN_KEY_SALT,
} from "../../src/config.js";
import { open, pkceChallenge, seal } from "../../src/crypto.js";
import { HaroldRepo } from "../../src/github.js";
import { checkOwner, _resetIdentityCache, type OwnerRule } from "../../src/identity.js";
import { _resetOauthCaches, issueTokens } from "../../src/oauth.js";
import { mintPat } from "../../src/pat.js";
import { githubTokenFrom } from "../../src/tools.js";
import { FakeGithub } from "./fakes.js";
import { OWNER, STRANGER, setTestEnv } from "./env.js";

const PROD = "harold-abc.vercel.app";
const BASE = `https://${PROD}`;
const REPO_ID = 987654321;
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const SECRET = "0123456789abcdef0123456789abcdef01234567"; // 40 hex characters, like a GitHub client secret

/** A first deploy on Vercel from the owner's own repository: only the GitHub OAuth App's two values are typed. */
function vercelEnv(extra: Record<string, string> = {}) {
  setTestEnv({
    TOKEN_KEY: "", PUBLIC_BASE_URL: "", HAROLD_REPO: "", ALLOWED_GITHUB_LOGIN: "", ALLOWED_GITHUB_ID: "",
    GITHUB_CLIENT_SECRET: SECRET,
    VERCEL_PROJECT_PRODUCTION_URL: PROD, VERCEL_GIT_REPO_OWNER: OWNER.login, VERCEL_GIT_REPO_SLUG: "harold", VERCEL_GIT_REPO_ID: String(REPO_ID),
    ...extra,
  });
}

beforeEach(() => { _resetOauthCaches(); _resetIdentityCache(); });

describe("PUBLIC_BASE_URL", () => {
  it("defaults to https:// plus Vercel's production address (previews too: Vercel sets it to the production domain everywhere)", () => {
    vercelEnv();
    expect(publicBaseUrl()).toBe(BASE);
    vercelEnv({ VERCEL_PROJECT_PRODUCTION_URL: "harold.example.com" }); // a custom domain, when one is added
    expect(publicBaseUrl()).toBe("https://harold.example.com");
  });
  it("an explicit value wins, without its trailing slash", () => {
    vercelEnv({ PUBLIC_BASE_URL: "https://connector.example.org/" });
    expect(publicBaseUrl()).toBe("https://connector.example.org");
    expect(config().publicBaseUrl).toBe("https://connector.example.org");
  });
  it("neither set, or a value that is not a host name: a clear error, never a guess", () => {
    vercelEnv({ VERCEL_PROJECT_PRODUCTION_URL: "" });
    expect(() => publicBaseUrl()).toThrow(/Missing environment variable PUBLIC_BASE_URL/);
    for (const bad of ["evil.com/path", "https://x.vercel.app", "a b.com", "x.com@evil.com", "localhost"]) {
      vercelEnv({ VERCEL_PROJECT_PRODUCTION_URL: bad });
      expect(() => publicBaseUrl(), bad).toThrow(/PUBLIC_BASE_URL/);
    }
  });
});

describe("HAROLD_REPO", () => {
  it("defaults to the repository the connector is deployed from", () => {
    vercelEnv();
    expect(repoConfig()).toEqual({ repo: `${OWNER.login}/harold`, branch: "main" });
  });
  it("an explicit value wins", () => {
    vercelEnv({ HAROLD_REPO: "someone/other-harold", ALLOWED_GITHUB_LOGIN: OWNER.login, ALLOWED_GITHUB_ID: String(OWNER.id) });
    expect(repoConfig().repo).toBe("someone/other-harold");
  });
  it("off Vercel there is no default", () => {
    vercelEnv({ VERCEL_GIT_REPO_OWNER: "", VERCEL_GIT_REPO_SLUG: "", VERCEL_GIT_REPO_ID: "" });
    expect(() => repoConfig()).toThrow(/Missing environment variable HAROLD_REPO/);
  });
});

describe("TOKEN_KEY", () => {
  it("defaults to HKDF-SHA256 of GITHUB_CLIENT_SECRET with a fixed, versioned label: stable, 32 bytes, never the secret itself", () => {
    vercelEnv();
    const k = tokenKey();
    expect(k.length).toBe(32);
    expect(k.equals(Buffer.from(hkdfSync("sha256", SECRET, TOKEN_KEY_SALT, TOKEN_KEY_INFO, 32)))).toBe(true);
    expect(TOKEN_KEY_INFO).toMatch(/v1$/);
    expect(tokenKey().equals(k)).toBe(true); // the same on every instance and every deploy
    expect(k.toString("hex")).not.toContain(Buffer.from(SECRET).toString("hex").slice(0, 16));
  });
  it("rotating the client secret changes the key, so every token is refused (everyone signs in again)", () => {
    vercelEnv();
    const blob = seal(tokenKey(), "access", { gh: "x", exp: Math.floor(Date.now() / 1000) + 60 });
    vercelEnv({ GITHUB_CLIENT_SECRET: "fedcba9876543210fedcba9876543210fedcba98" });
    expect(open(tokenKey(), "access", blob)).toBeNull();
    expect(deriveTokenKey("fedcba9876543210fedcba9876543210fedcba98").equals(tokenKey())).toBe(true);
  });
  it("an explicit TOKEN_KEY wins, and an invalid one is an error, not a silent fallback", () => {
    const hex = randomBytes(32).toString("hex");
    vercelEnv({ TOKEN_KEY: hex });
    expect(tokenKey().toString("hex")).toBe(hex);
    vercelEnv({ TOKEN_KEY: "not-hex" });
    expect(() => tokenKey()).toThrow(/64 hex characters/);
  });
  it("no secret, or one too short to derive a key from, is refused", () => {
    vercelEnv({ GITHUB_CLIENT_SECRET: "" });
    expect(() => tokenKey()).toThrow(/GITHUB_CLIENT_SECRET/);
    vercelEnv({ GITHUB_CLIENT_SECRET: "short" });
    expect(() => tokenKey()).toThrow(/too short/);
  });
});

describe("the owner", () => {
  it("defaults to the owner of the deployment's repository, by its numeric id", () => {
    vercelEnv();
    expect(ownerRule()).toEqual({ kind: "repo-owner", repoId: REPO_ID, ownerLogin: OWNER.login });
    vercelEnv({ HAROLD_REPO: `${OWNER.login.toUpperCase()}/Harold` }); // the same repository, spelled differently
    expect(ownerRule().kind).toBe("repo-owner");
  });
  it("ALLOWED_GITHUB_LOGIN + ALLOWED_GITHUB_ID win; one without the other is an error", () => {
    vercelEnv({ ALLOWED_GITHUB_LOGIN: STRANGER.login, ALLOWED_GITHUB_ID: String(STRANGER.id) });
    expect(ownerRule()).toEqual({ kind: "account", login: STRANGER.login, id: STRANGER.id });
    vercelEnv({ ALLOWED_GITHUB_LOGIN: OWNER.login });
    expect(() => ownerRule()).toThrow(/ALLOWED_GITHUB_ID/);
    vercelEnv({ ALLOWED_GITHUB_ID: String(OWNER.id) });
    expect(() => ownerRule()).toThrow(/ALLOWED_GITHUB_LOGIN/);
  });
  it("HAROLD_REPO naming another repository, or no Vercel repository: the owner must be named", () => {
    vercelEnv({ HAROLD_REPO: "someone/elsewhere" });
    expect(() => ownerRule()).toThrow(/ALLOWED_GITHUB_LOGIN and ALLOWED_GITHUB_ID.*not the repository this connector is deployed from/);
    vercelEnv({ VERCEL_GIT_REPO_ID: "" });
    expect(() => ownerRule()).toThrow(/ALLOWED_GITHUB_ID/);
  });

  describe("checkOwner (repo-owner)", () => {
    const rule: OwnerRule = { kind: "repo-owner", repoId: REPO_ID, ownerLogin: OWNER.login };
    let gh: FakeGithub;
    beforeEach(() => {
      gh = new FakeGithub();
      gh.users.set("tok-owner", OWNER);
      gh.users.set("tok-stranger", STRANGER);
      gh.repos.set(REPO_ID, { owner: { ...OWNER, type: "User" }, visibleTo: ["tok-owner"] });
    });
    it("accepts the owner, looked up by repository id", async () => {
      expect(await checkOwner("tok-owner", rule, gh.fetch)).toEqual({ ok: true, user: OWNER });
      expect(gh.calls).toContain(`GET /repositories/${REPO_ID}`);
    });
    it("refuses someone who cannot see the private repository, and a collaborator who can", async () => {
      expect(await checkOwner("tok-stranger", rule, gh.fetch)).toMatchObject({ ok: false, reason: "not-owner" });
      gh.repos.get(REPO_ID)!.visibleTo.push("tok-stranger");
      expect(await checkOwner("tok-stranger", rule, gh.fetch)).toMatchObject({ ok: false, reason: "not-owner" });
      expect(await checkOwner("tok-unknown", rule, gh.fetch)).toMatchObject({ ok: false, reason: "no-user" });
    });
    it("matches by numeric id: a renamed owner still gets in, and someone holding the old login does not", async () => {
      gh.users.set("tok-owner", { login: "renamed-owner", id: OWNER.id });
      expect((await checkOwner("tok-owner", rule, gh.fetch)).ok).toBe(true);
      gh.users.set("tok-squatter", { login: OWNER.login, id: 55555555 });
      gh.repos.get(REPO_ID)!.visibleTo.push("tok-squatter");
      expect((await checkOwner("tok-squatter", rule, gh.fetch)).ok).toBe(false);
    });
    it("an organization-owned repository is refused with its own reason (the owner must then be named)", async () => {
      gh.repos.set(REPO_ID, { owner: { login: "an-org", id: OWNER.id, type: "Organization" }, visibleTo: ["tok-owner"] });
      expect(await checkOwner("tok-owner", rule, gh.fetch)).toMatchObject({ ok: false, reason: "organization" });
    });
  });
});

describe("sign-in with only the two GitHub values set", () => {
  let gh: FakeGithub;
  let app: ReturnType<typeof createApp>;
  const appFetch = (url: string, init?: RequestInit) => app.fetch(new Request(url, init));
  const mcpPost = (bearer: string) => appFetch(`${BASE}/mcp`, {
    method: "POST", headers: { Authorization: `Bearer ${bearer}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } }),
  });

  beforeEach(() => {
    vercelEnv({ GITHUB_CLIENT_ID: "test-client-id" });
    gh = new FakeGithub();
    gh.users.set("tok-owner", OWNER);
    gh.users.set("tok-stranger", STRANGER);
    gh.oauthCodes.set("gh-code-owner", "tok-owner");
    gh.oauthCodes.set("gh-code-stranger", "tok-stranger");
    gh.repos.set(REPO_ID, { owner: { ...OWNER, type: "User" }, visibleTo: ["tok-owner"] });
    gh.files.set("harold/projects.md", "## Harold\n- folder: harold\n- status: active\n");
    app = createApp({ fetch: gh.fetch, tools: { repoFor: ctx => new HaroldRepo(githubTokenFrom(ctx), `${OWNER.login}/harold`, "main", gh.fetch), supabase: () => null } });
  });

  async function signIn(githubCode: string) {
    const reg = await appFetch(`${BASE}/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: "Test", redirect_uris: [REDIRECT] }) });
    const clientId = ((await reg.json()) as { client_id: string }).client_id;
    const verifier = randomBytes(32).toString("base64url");
    const q = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: REDIRECT, code_challenge: pkceChallenge(verifier), code_challenge_method: "S256", state: "s1" });
    const page = await appFetch(`${BASE}/authorize?${q}`);
    const html = await page.text();
    const request = html.match(/name="request" value="([^"]+)"/)![1];
    const cookie = page.headers.get("set-cookie")!.split(";")[0];
    const ok = await appFetch(`${BASE}/authorize/approve`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", cookie }, body: new URLSearchParams({ request }) });
    const toGithub = new URL(ok.headers.get("location")!);
    const cb = await appFetch(`${BASE}/github/callback?code=${githubCode}&state=${encodeURIComponent(toGithub.searchParams.get("state")!)}`);
    return { html, toGithub, back: new URL(cb.headers.get("location")!), clientId, verifier };
  }

  it("the owner signs in; the derived key, the default address and the repository's owner are used throughout", async () => {
    const { html, toGithub, back, clientId, verifier } = await signIn("gh-code-owner");
    expect(html).toContain(`${OWNER.login} (the owner of the repository this connector is deployed from)`);
    expect(toGithub.searchParams.get("redirect_uri")).toBe(`${BASE}/github/callback`);
    expect(back.searchParams.get("iss")).toBe(BASE);
    const code = back.searchParams.get("code")!;
    expect(code).toBeTruthy();
    const tok = await appFetch(`${BASE}/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: clientId, redirect_uri: REDIRECT, code_verifier: verifier }) });
    const t = (await tok.json()) as { access_token: string; refresh_token: string };
    expect(open(deriveTokenKey(SECRET), "access", t.access_token)).not.toBeNull();
    expect((await mcpPost(t.access_token)).status).toBe(200);
    const meta = (await (await appFetch(`${BASE}/.well-known/oauth-protected-resource/mcp`)).json()) as { resource: string };
    expect(meta.resource).toBe(`${BASE}/mcp`);
    // Refresh re-checks ownership: once the repository is transferred away, the refresh is refused.
    gh.repos.set(REPO_ID, { owner: { ...STRANGER, type: "User" }, visibleTo: ["tok-owner", "tok-stranger"] });
    const r = await appFetch(`${BASE}/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: clientId }) });
    expect(r.status).toBe(400);
  });

  it("a stranger is refused and their GitHub grant revoked", async () => {
    const { back } = await signIn("gh-code-stranger");
    expect(back.searchParams.get("error")).toBe("access_denied");
    expect(back.searchParams.get("code")).toBeNull();
    expect(gh.revoked).toEqual(["tok-stranger"]);
  });

  it("an organization-owned repository: refused, and the error says to name the owner", async () => {
    gh.repos.set(REPO_ID, { owner: { login: "an-org", id: 4242, type: "Organization" }, visibleTo: ["tok-owner"] });
    const { back } = await signIn("gh-code-owner");
    expect(back.searchParams.get("error")).toBe("access_denied");
    expect(back.searchParams.get("error_description")).toMatch(/organization.*ALLOWED_GITHUB_LOGIN and ALLOWED_GITHUB_ID/);
  });

  it("/mcp checks a correctly sealed access token's GitHub identity against the repository's owner", async () => {
    const c = config();
    const stranger = issueTokens(c, { gh: "tok-stranger", login: STRANGER.login, uid: STRANGER.id, client_id: "x" }).access_token;
    expect((await mcpPost(stranger)).status).toBe(401);
    const owner = issueTokens(c, { gh: "tok-owner", login: OWNER.login, uid: OWNER.id, client_id: "x" }).access_token;
    expect((await mcpPost(owner)).status).toBe(200);
  });

  it("personal access tokens: checked with GitHub against the repository's owner, once per token", async () => {
    const key = config().tokenKey;
    const good = mintPat(key, { name: "job", days: 30, login: OWNER.login, uid: OWNER.id, gh: "tok-owner" }).token;
    expect((await mcpPost(good)).status).toBe(200);
    expect((await mcpPost(good)).status).toBe(200);
    expect(gh.calls.filter(c => c === `GET /repositories/${REPO_ID}`).length).toBe(1);
    const stranger = mintPat(key, { name: "job", days: 30, login: STRANGER.login, uid: STRANGER.id, gh: "tok-stranger" }).token;
    expect((await mcpPost(stranger)).status).toBe(401);
    // The owner's GitHub token under another person's id: refused too.
    const mismatched = mintPat(key, { name: "job", days: 30, login: STRANGER.login, uid: STRANGER.id, gh: "tok-owner" }).token;
    expect((await mcpPost(mismatched)).status).toBe(401);
  });

  it("explicit settings still win over every default (an existing deployment is unchanged)", async () => {
    const hex = randomBytes(32).toString("hex");
    vercelEnv({ GITHUB_CLIENT_ID: "test-client-id", TOKEN_KEY: hex, PUBLIC_BASE_URL: "https://mine.example.com", ALLOWED_GITHUB_LOGIN: OWNER.login, ALLOWED_GITHUB_ID: String(OWNER.id), HAROLD_REPO: "owner/explicit" });
    const c = config();
    expect(c.tokenKey.toString("hex")).toBe(hex);
    expect(c.publicBaseUrl).toBe("https://mine.example.com");
    expect(c.owner).toEqual({ kind: "account", login: OWNER.login, id: OWNER.id });
    expect(repoConfig().repo).toBe("owner/explicit");
    // Named owner: no repository lookup at all.
    const t = issueTokens(c, { gh: "tok-owner", login: OWNER.login, uid: OWNER.id, client_id: "x" }).access_token;
    const res = await app.fetch(new Request("https://mine.example.com/mcp", {
      method: "POST", headers: { Authorization: `Bearer ${t}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } }),
    }));
    expect(res.status).toBe(200);
    expect(gh.calls.some(c => c.startsWith("GET /repositories/"))).toBe(false);
  });
});

describe("the home page", () => {
  it("right after the first deploy, says exactly what to paste into GitHub's New OAuth App form", async () => {
    vercelEnv({ GITHUB_CLIENT_ID: "", GITHUB_CLIENT_SECRET: "" });
    const text = homePage();
    expect(text).toContain("https://github.com/settings/applications/new");
    expect(text).toContain(`Homepage URL:                ${BASE}\n`);
    expect(text).toContain(`Authorization callback URL:  ${BASE}/github/callback\n`);
    expect(text).toMatch(/GITHUB_CLIENT_ID\s+the application's Client ID/);
    expect(text).not.toMatch(/Missing environment variable GITHUB_CLIENT_SECRET/); // the steps cover it
    // served at / without any setting beyond Vercel's own
    const res = await createApp({ fetch: new FakeGithub().fetch }).fetch(new Request(`${BASE}/`));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(text);
  });
  it("once configured, names the /mcp address and the callback URL, and nothing is missing", () => {
    vercelEnv({ GITHUB_CLIENT_ID: "test-client-id" });
    const text = homePage();
    expect(text).toContain(`${BASE}/mcp`);
    expect(text).toContain(`${BASE}/github/callback`);
    expect(text).not.toContain("Not ready");
  });
  it("lists what is still missing, and never takes the address from the request", async () => {
    vercelEnv({ GITHUB_CLIENT_ID: "test-client-id", VERCEL_PROJECT_PRODUCTION_URL: "", VERCEL_GIT_REPO_ID: "" });
    const res = await createApp({ fetch: new FakeGithub().fetch }).fetch(new Request("https://attacker.example/", { headers: { host: "attacker.example" } }));
    const text = await res.text();
    expect(text).toMatch(/Not ready: Missing environment variable PUBLIC_BASE_URL/);
    expect(text).toMatch(/Not ready: Missing environment variable ALLOWED_GITHUB_ID/);
    expect(text).not.toContain("attacker.example");
  });
});

describe("Supabase key", () => {
  it("SUPABASE_SERVICE_ROLE_KEY, else SUPABASE_SECRET_KEY (the name Vercel's Supabase integration sets); the first wins", () => {
    setTestEnv({ SUPABASE_SECRET_KEY: "sb_secret_x" });
    expect(supabaseKeyFromEnv()).toBe("sb_secret_x");
    setTestEnv({ SUPABASE_SECRET_KEY: "sb_secret_x", SUPABASE_SERVICE_ROLE_KEY: "service-role" });
    expect(supabaseKeyFromEnv()).toBe("service-role");
    setTestEnv();
    expect(supabaseKeyFromEnv()).toBe("");
  });
});
