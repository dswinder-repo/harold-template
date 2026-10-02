import { beforeEach, describe, expect, it } from "vitest";
import { isAllowedUser, checkTokenIdentityOnce, _resetIdentityCache } from "../../src/identity.js";
import { redirectAllowed, register, _resetOauthCaches } from "../../src/oauth.js";
import { config, isNoLogType, noLogTypes, repoConfig } from "../../src/config.js";
import { FakeGithub } from "./fakes.js";
import { OWNER, STRANGER, setTestEnv } from "./env.js";

beforeEach(() => { setTestEnv(); _resetOauthCaches(); _resetIdentityCache(); });

const hosts = ["claude.ai", "claude.com"];

describe("DCR redirect-host enforcement", () => {
  it("accepts https redirect URIs on claude.ai and claude.com only", () => {
    expect(redirectAllowed("https://claude.ai/api/mcp/auth_callback", hosts)).toBe(true);
    expect(redirectAllowed("https://claude.com/api/mcp/auth_callback", hosts)).toBe(true);
    expect(redirectAllowed("https://CLAUDE.AI/api/mcp/auth_callback", hosts)).toBe(true);
    for (const bad of [
      "http://claude.ai/api/mcp/auth_callback",       // not https
      "https://evil.com/cb",
      "https://claude.ai.evil.com/cb",                  // suffix trick
      "https://evil.com/?x=https://claude.ai/",
      "https://user:pw@claude.ai/cb",                   // userinfo
      "https://claude.ai/cb#frag",                      // fragment
      "https://sub.claude.ai/cb",                       // exact host only
      "javascript:alert(1)", "", 42,
    ]) expect(redirectAllowed(bad, hosts), String(bad)).toBe(false);
  });

  it("/register issues a client_id for claude redirect URIs and refuses others", async () => {
    const ok = await register(new Request("https://x/register", { method: "POST", body: JSON.stringify({ client_name: "Claude", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] }), headers: { "content-type": "application/json" } }));
    expect(ok.status).toBe(201);
    const j = await ok.json() as Record<string, unknown>;
    expect(typeof j.client_id).toBe("string");
    expect(j.token_endpoint_auth_method).toBe("none");

    const bad = await register(new Request("https://x/register", { method: "POST", body: JSON.stringify({ redirect_uris: ["https://claude.ai/cb", "https://evil.example/cb"] }), headers: { "content-type": "application/json" } }));
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as Record<string, unknown>).error).toBe("invalid_redirect_uri");

    const none = await register(new Request("https://x/register", { method: "POST", body: JSON.stringify({}), headers: { "content-type": "application/json" } }));
    expect(none.status).toBe(400);
  });

  it("honours a configured ALLOWED_REDIRECT_HOSTS", async () => {
    setTestEnv({ ALLOWED_REDIRECT_HOSTS: "claude.ai" });
    const r = await register(new Request("https://x/register", { method: "POST", body: JSON.stringify({ redirect_uris: ["https://claude.com/api/mcp/auth_callback"] }) }));
    expect(r.status).toBe(400);
  });
});

describe("identity check", () => {
  it("accepts only the owner: login AND numeric id must both match", () => {
    expect(isAllowedUser(OWNER, OWNER.login, OWNER.id)).toBe(true);
    expect(isAllowedUser({ login: "Example-Owner", id: OWNER.id }, OWNER.login, OWNER.id)).toBe(true); // GitHub logins are case-insensitive
    expect(isAllowedUser(STRANGER, OWNER.login, OWNER.id)).toBe(false);
    expect(isAllowedUser({ login: OWNER.login, id: 999 }, OWNER.login, OWNER.id)).toBe(false);          // renamed-login takeover
    expect(isAllowedUser({ login: "someone", id: OWNER.id }, OWNER.login, OWNER.id)).toBe(false);
    expect(isAllowedUser(null, OWNER.login, OWNER.id)).toBe(false);
  });

  it("checks GitHub at most once per access token, and rejects another user's token", async () => {
    const gh = new FakeGithub();
    gh.users.set("tok-owner", OWNER);
    gh.users.set("tok-stranger", STRANGER);
    const exp = Math.floor(Date.now() / 1000) + 3600;
    expect(await checkTokenIdentityOnce("access-A", "tok-owner", OWNER.login, OWNER.id, exp, gh.fetch)).toBe(true);
    expect(await checkTokenIdentityOnce("access-A", "tok-owner", OWNER.login, OWNER.id, exp, gh.fetch)).toBe(true);
    expect(gh.calls.filter(c => c === "GET /user").length).toBe(1);
    expect(await checkTokenIdentityOnce("access-B", "tok-stranger", OWNER.login, OWNER.id, exp, gh.fetch)).toBe(false);
    expect(await checkTokenIdentityOnce("access-C", "tok-revoked", OWNER.login, OWNER.id, exp, gh.fetch)).toBe(false);
  });
});

describe("configuration", () => {
  it("HAROLD_REPO is required (no default repository) and must be owner/name", () => {
    setTestEnv({ HAROLD_REPO: "" });
    expect(() => repoConfig()).toThrow(/Missing environment variable HAROLD_REPO/);
    setTestEnv({ HAROLD_REPO: "not-a-repo" });
    expect(() => repoConfig()).toThrow(/owner\/name/);
    setTestEnv({ HAROLD_REPO: "someone/harold", HAROLD_BRANCH: "" });
    expect(repoConfig()).toEqual({ repo: "someone/harold", branch: "main" });
  });
  it("sign-in does not depend on HAROLD_REPO; the owner's login and numeric id are both required", () => {
    setTestEnv({ HAROLD_REPO: "" });
    expect(config().allowedGithubLogin).toBe(OWNER.login);
    setTestEnv({ ALLOWED_GITHUB_ID: "" });
    expect(() => config()).toThrow(/ALLOWED_GITHUB_ID/);
    setTestEnv({ ALLOWED_GITHUB_LOGIN: "" });
    expect(() => config()).toThrow(/ALLOWED_GITHUB_LOGIN/);
    setTestEnv({ ALLOWED_GITHUB_ID: "abc" });
    expect(() => config()).toThrow(/numeric/);
  });
  it("HAROLD_NO_LOG_TYPES is empty by default and parsed case-insensitively", () => {
    expect(noLogTypes()).toEqual([]);
    expect(isNoLogType("team")).toBe(false);
    setTestEnv({ HAROLD_NO_LOG_TYPES: "Team, family ,," });
    expect(noLogTypes()).toEqual(["team", "family"]);
    expect(isNoLogType("TEAM")).toBe(true);
    expect(isNoLogType("")).toBe(false);
  });
});
