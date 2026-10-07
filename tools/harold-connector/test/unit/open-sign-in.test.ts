// Sign-in for any MCP client: loopback, private-use scheme and any-host https redirects (RFC 8252),
// the optional ALLOWED_REDIRECT_HOSTS narrowing, the consent page's destination, and the SSRF guard on
// Client ID Metadata Documents.

import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { _resetIdentityCache } from "../../src/identity.js";
import { _resetOauthCaches, register } from "../../src/oauth.js";
import { pkceChallenge } from "../../src/crypto.js";
import { cimdUrlAllowed, classifyRedirect, isPublicIp, redirectAllowed, redirectHostsFromEnv, redirectMatches } from "../../src/redirects.js";
import { FakeGithub } from "./fakes.js";
import { OWNER, setTestEnv } from "./env.js";

const BASE = "https://harold-connector.example.com";
const ANY = null;
const NARROW = ["claude.ai", "claude.com"];

let gh: FakeGithub;
let app: ReturnType<typeof createApp>;
let lookups: string[];
const dns: Record<string, string[]> = {};
const appFetch = (url: string, init?: RequestInit) => app.fetch(new Request(url, init));

beforeEach(() => {
  setTestEnv({ PUBLIC_BASE_URL: BASE, ALLOWED_REDIRECT_HOSTS: "" }); // unrestricted: the new default
  _resetOauthCaches(); _resetIdentityCache();
  gh = new FakeGithub();
  gh.users.set("tok-owner", OWNER);
  gh.oauthCodes.set("gh-code-owner", "tok-owner");
  lookups = [];
  app = createApp({ fetch: gh.fetch, tools: { repoFor: () => { throw new Error("unused"); }, supabase: () => null }, lookup: fakeLookup });
});

async function fakeLookup(host: string): Promise<string[]> {
  lookups.push(host);
  if (!(host in dns)) throw new Error(`ENOTFOUND ${host}`);
  return dns[host];
}

async function registerClient(redirect_uris: string[], client_name = "Test client") {
  const r = await appFetch(`${BASE}/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name, redirect_uris }) });
  return { status: r.status, body: (await r.json()) as { client_id?: string; error?: string; error_description?: string } };
}

const challenge = pkceChallenge("v".repeat(50));
const authorizeUrl = (clientId: string, redirect: string) =>
  `${BASE}/authorize?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirect)}&code_challenge=${challenge}&code_challenge_method=S256&state=st`;

describe("redirect URIs any MCP client uses", () => {
  it("accepts loopback on any port and path, IPv4, IPv6 and localhost, even when narrowed", () => {
    for (const hosts of [ANY, NARROW]) {
      for (const ok of [
        "http://127.0.0.1/callback", "http://127.0.0.1:1/", "http://127.0.0.1:33418", "http://127.0.0.1:65535/oauth/callback?x=1",
        "http://[::1]:8080/callback", "http://[::1]/", "http://localhost:53682/", "http://localhost/cb", "http://LOCALHOST:9/cb",
      ]) expect(classifyRedirect(ok, hosts), `${ok} ${hosts}`).toBe("loopback");
    }
  });

  it("refuses plain http anywhere but loopback", () => {
    for (const bad of ["http://claude.ai/cb", "http://127.0.0.2/cb", "http://10.0.0.1/cb", "http://localhost.evil.com/cb", "http://[::2]/cb", "http://example.com:80/"])
      expect(redirectAllowed(bad, ANY), bad).toBe(false);
  });

  it("accepts private-use app schemes", () => {
    for (const ok of ["cursor://anysphere.cursor-retrieval/oauth/user-harold/callback", "vscode://vscode.github-authentication/did-authenticate", "com.example.app:/oauth2redirect", "my-agent+v2.app://cb"])
      expect(classifyRedirect(ok, ANY), ok).toBe("private-use");
  });

  it("refuses dangerous or meaningless schemes", () => {
    for (const bad of [
      "javascript:alert(1)", "JavaScript:alert(1)", "data:text/html,<script>alert(1)</script>", "file:///etc/passwd", "blob:https://claude.ai/uuid",
      "about:blank", "vbscript:msgbox", "ws://example.com/", "wss://example.com/", "ftp://example.com/", "mailto:a@b.c", "view-source:https://x/", "filesystem:https://x/",
    ]) expect(redirectAllowed(bad, ANY), bad).toBe(false);
  });

  it("accepts https on any host when unrestricted", () => {
    for (const ok of ["https://claude.ai/api/mcp/auth_callback", "https://chatgpt.com/connector_platform_oauth_redirect", "https://www.cursor.com/agents/mcp/oauth/callback", "https://vscode.dev/redirect", "https://example.org:8443/cb"])
      expect(classifyRedirect(ok, ANY), ok).toBe("https");
  });

  it("still narrows https hosts (exact match) when ALLOWED_REDIRECT_HOSTS is set, and app schemes only when listed", () => {
    expect(redirectAllowed("https://claude.ai/api/mcp/auth_callback", NARROW)).toBe(true);
    for (const bad of ["https://evil.com/cb", "https://claude.ai.evil.com/cb", "https://sub.claude.ai/cb", "cursor://anysphere.cursor-retrieval/cb"])
      expect(redirectAllowed(bad, NARROW), bad).toBe(false);
    expect(redirectAllowed("cursor://anysphere.cursor-retrieval/cb", ["claude.ai", "cursor:"])).toBe(true);
    expect(redirectAllowed("vscode://x/cb", ["claude.ai", "cursor:"])).toBe(false);
  });

  it("refuses userinfo, fragments (even empty), whitespace and control characters on every kind", () => {
    for (const bad of [
      "https://user:pw@claude.ai/cb", "https://user@example.com/cb", "http://u@127.0.0.1:8080/cb", "http://u:p@localhost/cb", "cursor://u:p@host/cb",
      "https://example.com/cb#frag", "https://example.com/cb#", "http://127.0.0.1:8080/cb#x", "cursor://host/cb#x",
      "https://example.com/cb\n", " https://example.com/cb", "https://exa\tmple.com/cb", "http://127.0.0.1/c b", "", 42, null, "x".repeat(2001),
    ]) expect(redirectAllowed(bad, ANY), JSON.stringify(bad)).toBe(false);
  });

  it("reads ALLOWED_REDIRECT_HOSTS: unset, empty or * mean any host", () => {
    expect(redirectHostsFromEnv(undefined)).toBeNull();
    expect(redirectHostsFromEnv("")).toBeNull();
    expect(redirectHostsFromEnv(" * ")).toBeNull();
    expect(redirectHostsFromEnv("claude.ai,*")).toBeNull();
    expect(redirectHostsFromEnv("Claude.ai, claude.com ,cursor:")).toEqual(["claude.ai", "claude.com", "cursor:"]);
  });

  it("matches a loopback redirect on any port at request time (RFC 8252 §7.3), everything else exactly", () => {
    expect(redirectMatches(["http://127.0.0.1/callback"], "http://127.0.0.1:53123/callback")).toBe(true);
    expect(redirectMatches(["http://127.0.0.1:1000/callback"], "http://127.0.0.1:2000/callback")).toBe(true);
    expect(redirectMatches(["http://[::1]/cb"], "http://[::1]:4000/cb")).toBe(true);
    expect(redirectMatches(["http://127.0.0.1/callback"], "http://127.0.0.1:53123/other")).toBe(false);
    expect(redirectMatches(["http://127.0.0.1/callback"], "http://localhost:53123/callback")).toBe(false);
    expect(redirectMatches(["http://127.0.0.1/callback?a=1"], "http://127.0.0.1:5/callback?a=2")).toBe(false);
    expect(redirectMatches(["https://claude.ai/cb"], "https://claude.ai:444/cb")).toBe(false);
    expect(redirectMatches(["cursor://a/cb"], "cursor://a/cb")).toBe(true);
    expect(redirectMatches(["cursor://a/cb"], "cursor://a/cb2")).toBe(false);
  });
});

describe("registration and authorize for any client", () => {
  it("/register accepts loopback, app schemes and any https host; refuses javascript:, data:, file:", async () => {
    for (const uris of [["http://127.0.0.1:33418/callback"], ["http://[::1]:5000/cb"], ["http://localhost:8787/callback"], ["cursor://anysphere.cursor-retrieval/oauth/callback"], ["https://chatgpt.com/connector_platform_oauth_redirect"], ["vscode://vscode.github-authentication/did-authenticate", "https://vscode.dev/redirect"]]) {
      const r = await registerClient(uris);
      expect(r.status, uris.join()).toBe(201);
    }
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "file:///tmp/x", "https://u:p@example.com/cb", "https://example.com/cb#x"]) {
      const r = await registerClient(["http://127.0.0.1/cb", bad]);
      expect(r.status, bad).toBe(400);
      expect(r.body.error).toBe("invalid_redirect_uri");
    }
  });

  it("re-checks a registered client on every use when ALLOWED_REDIRECT_HOSTS is narrowed later", async () => {
    const { body } = await registerClient(["https://example.org/cb"]);
    expect((await appFetch(authorizeUrl(body.client_id!, "https://example.org/cb"))).status).toBe(200);
    setTestEnv({ PUBLIC_BASE_URL: BASE, ALLOWED_REDIRECT_HOSTS: "claude.ai" });
    _resetOauthCaches();
    const r = await appFetch(authorizeUrl(body.client_id!, "https://example.org/cb"));
    expect(r.status).toBe(400);
    expect(r.headers.get("location")).toBeNull();
    const narrowed = await register(new Request(`${BASE}/register`, { method: "POST", body: JSON.stringify({ redirect_uris: ["https://example.org/cb"] }) }));
    expect(narrowed.status).toBe(400);
  });

  it("never redirects to a URI the client did not register", async () => {
    const { body } = await registerClient(["http://127.0.0.1/callback"]);
    for (const other of ["https://evil.example/cb", "http://localhost:5000/callback", "cursor://x/cb", "http://127.0.0.1:5000/elsewhere"]) {
      const r = await appFetch(authorizeUrl(body.client_id!, other));
      expect(r.status, other).toBe(400);
      expect(r.headers.get("location")).toBeNull();
    }
  });

  it("completes the whole flow to a loopback redirect on an ephemeral port (CLI style)", async () => {
    const { body } = await registerClient(["http://127.0.0.1/callback"], "Some CLI");
    const redirect = "http://127.0.0.1:53123/callback";
    const verifier = "q".repeat(60);
    const a = await appFetch(`${BASE}/authorize?response_type=code&client_id=${encodeURIComponent(body.client_id!)}&redirect_uri=${encodeURIComponent(redirect)}&code_challenge=${pkceChallenge(verifier)}&code_challenge_method=S256&state=cli`);
    expect(a.status).toBe(200);
    const html = await a.text();
    expect(html).toContain("127.0.0.1:53123");
    expect(html).toContain("Some CLI");
    const request = html.match(/name="request" value="([^"]+)"/)![1];
    const cookie = a.headers.get("set-cookie")!.split(";")[0];
    const ok = await appFetch(`${BASE}/authorize/approve`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", cookie }, body: new URLSearchParams({ request }) });
    expect(ok.status).toBe(303);
    const state = new URL(ok.headers.get("location")!).searchParams.get("state")!;
    const cb = await appFetch(`${BASE}/github/callback?code=gh-code-owner&state=${encodeURIComponent(state)}`);
    const back = new URL(cb.headers.get("location")!);
    expect(back.origin + back.pathname).toBe("http://127.0.0.1:53123/callback");
    expect(back.searchParams.get("state")).toBe("cli");
    const t = await appFetch(`${BASE}/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code: back.searchParams.get("code")!, client_id: body.client_id!, redirect_uri: redirect, code_verifier: verifier }) });
    expect(t.status).toBe(200);
    expect(((await t.json()) as { access_token?: string }).access_token).toBeTruthy();
  });

  it("the consent page shows the client name and the exact destination, escaped", async () => {
    const { body } = await registerClient(["cursor://anysphere.cursor-retrieval/oauth/callback"], `Cursor <img src=x onerror=alert(1)>`);
    const r = await appFetch(authorizeUrl(body.client_id!, "cursor://anysphere.cursor-retrieval/oauth/callback"));
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain("Cursor &lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<img");
    expect(html).toContain("cursor://anysphere.cursor-retrieval");
    expect(html).toContain("<code>cursor://anysphere.cursor-retrieval/oauth/callback</code>");
    expect(html).toMatch(/handles cursor: links/);

    const web = await registerClient(["https://evil.example/cb"], "Claude");
    const w = await (await appFetch(authorizeUrl(web.body.client_id!, "https://evil.example/cb"))).text();
    expect(w).toMatch(/<span class="dest">evil\.example<\/span>/); // a client calling itself "Claude" still shows where the code goes

    const bidi = await registerClient(["https://evil.example/cb"], "Claude\u202Eelpmaxe.live\u202C");
    const b = await (await appFetch(authorizeUrl(bidi.body.client_id!, "https://evil.example/cb"))).text();
    expect(b).not.toMatch(/[\u202A-\u202E]/);
    expect(b).toContain("<strong>Claudeelpmaxe.live</strong>");
  });
});

describe("Client ID Metadata Documents: any public https host, never an internal one", () => {
  it("cimdUrlAllowed refuses non-https, loopback, private and link-local targets, ports, userinfo, fragments", () => {
    expect(cimdUrlAllowed("https://client.example.com/oauth/metadata.json", ANY)).toBe(true);
    expect(cimdUrlAllowed("https://client.example.com/m.json", NARROW)).toBe(false);
    expect(cimdUrlAllowed("https://claude.ai/m.json", NARROW)).toBe(true);
    for (const bad of [
      "http://client.example.com/m.json", "https://localhost/m.json", "https://app.localhost/m.json", "https://127.0.0.1/m.json", "https://[::1]/m.json",
      "https://10.1.2.3/m.json", "https://169.254.169.254/latest/meta-data", "https://192.168.1.1/m.json", "https://172.16.0.1/m.json", "https://100.64.0.1/m.json",
      "https://[::ffff:127.0.0.1]/m.json", "https://[fd00::1]/m.json", "https://[fe80::1]/m.json", "https://0x7f.0.0.1/m.json", "https://2130706433/m.json",
      "https://client.example.com:8443/m.json", "https://u:p@client.example.com/m.json", "https://client.example.com/m.json#x", "https://client.example.com./m.json",
    ]) expect(cimdUrlAllowed(bad, ANY), bad).toBe(false);
  });

  it("isPublicIp", () => {
    for (const pub of ["8.8.8.8", "1.1.1.1", "160.79.104.10", "2606:4700::1111", "2a00:1450:4001::200e", "::ffff:8.8.8.8"]) expect(isPublicIp(pub), pub).toBe(true);
    for (const priv of ["127.0.0.1", "10.0.0.1", "172.31.255.255", "192.168.0.1", "169.254.169.254", "100.100.100.200", "0.0.0.0", "224.0.0.1", "255.255.255.255", "198.18.0.1",
      "::", "::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:10.0.0.1", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1", "64:ff9b::a00:1", "2002:a00:1::1", "2001:db8::1", "fe80::1%eth0", "not-an-ip", ""])
      expect(isPublicIp(priv), priv).toBe(false);
  });

  const CIMD = "https://client.example.com/oauth/metadata.json";
  const REDIRECT = "http://127.0.0.1:7777/callback";
  function withDocs(docs: Record<string, () => Response>) {
    const inits: RequestInit[] = [];
    const wrapped = async (u: string | URL | Request, init?: RequestInit) => {
      const url = String(u instanceof Request ? u.url : u);
      if (url in docs) { inits.push(init || {}); return docs[url](); }
      return gh.fetch(u, init);
    };
    app = createApp({ fetch: wrapped, tools: { repoFor: () => { throw new Error("unused"); }, supabase: () => null }, lookup: fakeLookup });
    return inits;
  }
  const doc = (body: unknown) => () => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

  it("fetches a metadata document from any public host, without following redirects", async () => {
    dns["client.example.com"] = ["93.184.215.14"];
    const inits = withDocs({ [CIMD]: doc({ client_id: CIMD, client_name: "Example agent", redirect_uris: [REDIRECT] }) });
    const r = await appFetch(authorizeUrl(CIMD, REDIRECT));
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain("Example agent");
    expect(html).toContain("metadata published at client.example.com");
    expect(inits[0].redirect).toBe("error");
    expect(inits[0].signal).toBeDefined();
  });

  it("refuses a host that resolves to a private or loopback address, without fetching it", async () => {
    for (const [host, addrs] of [["internal.example.com", ["10.0.0.5"]], ["rebind.example.com", ["93.184.215.14", "127.0.0.1"]], ["meta.example.com", ["169.254.169.254"]], ["v6.example.com", ["::1"]]] as const) {
      dns[host] = [...addrs];
      const url = `https://${host}/m.json`;
      const inits = withDocs({ [url]: doc({ client_id: url, redirect_uris: [REDIRECT] }) });
      const r = await appFetch(authorizeUrl(url, REDIRECT));
      expect(r.status, host).toBe(400);
      expect(inits.length, host).toBe(0);
    }
    // a lookup failure fails closed
    const inits = withDocs({ "https://nxdomain.example.com/m.json": doc({ client_id: "https://nxdomain.example.com/m.json", redirect_uris: [REDIRECT] }) });
    expect((await appFetch(authorizeUrl("https://nxdomain.example.com/m.json", REDIRECT))).status).toBe(400);
    expect(inits.length).toBe(0);
  });

  it("refuses literal internal addresses before any lookup, and an oversized or lying document", async () => {
    withDocs({});
    for (const url of ["https://127.0.0.1/m.json", "https://169.254.169.254/m.json", "https://[::1]/m.json", "https://localhost/m.json"])
      expect((await appFetch(authorizeUrl(url, REDIRECT))).status, url).toBe(400);
    expect(lookups).toEqual([]);

    dns["big.example.com"] = ["93.184.215.14"];
    dns["liar.example.com"] = ["93.184.215.14"];
    dns["bad.example.com"] = ["93.184.215.14"];
    withDocs({
      "https://big.example.com/m.json": () => new Response(JSON.stringify({ client_id: "https://big.example.com/m.json", redirect_uris: [REDIRECT], pad: "x".repeat(70_000) })),
      "https://liar.example.com/m.json": doc({ client_id: "https://other.example.com/m.json", redirect_uris: [REDIRECT] }),
      "https://bad.example.com/m.json": doc({ client_id: "https://bad.example.com/m.json", redirect_uris: ["javascript:alert(1)"] }),
    });
    for (const url of ["https://big.example.com/m.json", "https://liar.example.com/m.json", "https://bad.example.com/m.json"])
      expect((await appFetch(authorizeUrl(url, REDIRECT))).status, url).toBe(400);
  });
});
