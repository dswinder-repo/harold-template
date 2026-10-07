// A small, stateless OAuth 2.1 authorization server in front of GitHub.
//
//   client ──/register──▶ client_id = sealed(redirect_uris)                (RFC 7591, no database)
//   client ──/authorize─▶ (PKCE S256 required) consent page ──POST /authorize/approve──▶ GitHub login,
//          state = sealed(the client's params, 10 min), nonce cookie ties the button press to this browser
//   GitHub ──/github/callback──▶ code exchange, GET /user, must be ALLOWED_GITHUB_LOGIN + ALLOWED_GITHUB_ID
//          ──302──▶ client redirect_uri?code=sealed(GitHub token, PKCE challenge, client, 5 min)&state=...
//   client ──/token──▶ access_token = sealed(GitHub token, 24 h), refresh_token = sealed(GitHub token, 90 d)
//
// Also accepts Client ID Metadata Documents (the 2026-07-28 MCP spec's successor to DCR): a client_id
// that is an https URL on a public host (and on ALLOWED_REDIRECT_HOSTS, when that is set) is fetched
// and its redirect_uris used.
//
// Any MCP client may sign in: loopback, private-use scheme and https redirect URIs are accepted (see
// redirects.ts). The security boundary is the single GitHub account gate, PKCE S256, and the consent
// page, which shows the client's name and the exact destination of the code before anything happens.

import { config, type Config } from "./config.js";
import { open, randomId, seal, sha256, verifyPkce } from "./crypto.js";
import { fetchGithubUser, isAllowedUser, UA, type FetchLike } from "./identity.js";
import { lookup as dnsLookup } from "node:dns/promises";
import { cimdUrlAllowed, describeRedirect, hostOf, isPublicIp, redirectAllowed, redirectMatches, type RedirectHosts } from "./redirects.js";

export { redirectAllowed } from "./redirects.js";

export const ACCESS_TTL = 24 * 3600;
export const REFRESH_TTL = 90 * 24 * 3600;
export const CODE_TTL = 5 * 60;
export const STATE_TTL = 10 * 60;
export const SCOPE = "harold";

/** Resolves a host name to its IP addresses (for the metadata-document SSRF guard). */
export type LookupLike = (host: string) => Promise<string[]>;
export interface Deps { fetch: FetchLike; now?: () => number; lookup?: LookupLike }
const defaultLookup: LookupLike = async host => (await dnsLookup(host, { all: true, verbatim: true })).map(a => a.address);
const nowSec = (d: Deps) => Math.floor((d.now ? d.now() : Date.now()) / 1000);

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extra } });
const oauthError = (error: string, description: string, status = 400) => json({ error, error_description: description }, status);
const text = (body: string, status: number) => new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
const redirect = (url: string) => new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "no-store" } });
export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  // Named, not "*": browsers never let "*" cover Authorization.
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID",
  "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Session-Id",
  "Access-Control-Max-Age": "86400",
};

export const resourceUrl = (c: Config) => `${c.publicBaseUrl}/mcp`;

// ───────────── metadata ─────────────

export function authorizationServerMetadata(): Response {
  const c = config();
  const b = c.publicBaseUrl;
  return json({
    issuer: b,
    authorization_endpoint: `${b}/authorize`,
    token_endpoint: `${b}/token`,
    registration_endpoint: `${b}/register`,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    authorization_response_iss_parameter_supported: true,
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [SCOPE],
    client_id_metadata_document_supported: true,
    service_documentation: `${b}/`,
  }, 200, { ...CORS, "Cache-Control": "max-age=3600" });
}

export function protectedResourceMetadata(): Response {
  const c = config();
  return json({
    resource: resourceUrl(c),
    authorization_servers: [c.publicBaseUrl],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: "Harold",
  }, 200, { ...CORS, "Cache-Control": "max-age=3600" });
}

// ───────────── clients ─────────────

interface ClientInfo { redirect_uris: string[]; name?: string; metadataHost?: string }

const narrowedTo = (hosts: RedirectHosts) => hosts === null ? "" : ` (this server is limited to ${hosts.join(", ")} by ALLOWED_REDIRECT_HOSTS)`;

export async function register(req: Request): Promise<Response> {
  const c = config();
  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; } catch { return oauthError("invalid_client_metadata", "Body must be JSON"); }
  const uris = body.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > 10) return oauthError("invalid_redirect_uri", "redirect_uris must be a non-empty array");
  const bad = uris.filter(u => !redirectAllowed(u, c.allowedRedirectHosts));
  if (bad.length) return oauthError("invalid_redirect_uri", `Accepted redirect URIs: http://127.0.0.1, http://[::1] or http://localhost on any port; https; or an app's own scheme such as cursor:// (no userinfo, no fragment)${narrowedTo(c.allowedRedirectHosts)}`);
  const name = typeof body.client_name === "string" ? body.client_name.slice(0, 100) : undefined;
  const issuedAt = Math.floor(Date.now() / 1000);
  const client_id = seal(c.tokenKey, "client", { redirect_uris: uris, name, iat: issuedAt });
  return json({
    client_id,
    client_id_issued_at: issuedAt,
    client_name: name,
    redirect_uris: uris,
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    scope: SCOPE,
  }, 201, CORS);
}

const cimdCache = new Map<string, { info: ClientInfo | null; until: number }>();
const CIMD_MAX_BYTES = 64 * 1024;
const CIMD_CACHE_MAX = 200;

function cacheCimd(clientId: string, info: ClientInfo | null) {
  cimdCache.delete(clientId);
  cimdCache.set(clientId, { info, until: Date.now() + (info ? 600_000 : 30_000) });
  if (cimdCache.size > CIMD_CACHE_MAX) {
    for (const [k, v] of cimdCache) if (v.until <= Date.now()) cimdCache.delete(k);
    while (cimdCache.size > CIMD_CACHE_MAX) cimdCache.delete(cimdCache.keys().next().value!);
  }
}

async function readCapped(r: Response, max: number): Promise<string | null> {
  if (Number(r.headers.get("content-length") || 0) > max) return null;
  if (!r.body) return null;
  const reader = r.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) { await reader.cancel().catch(() => undefined); return null; }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** SSRF guard: the metadata URL's host must resolve only to public addresses. */
async function resolvesPublic(host: string, deps: Deps): Promise<boolean> {
  const literal = host.startsWith("[") ? host.slice(1, -1) : host;
  if (isPublicIp(literal)) return true;
  if (/^[\d.]+$/.test(literal) || literal.includes(":")) return false; // a non-public IP literal
  try {
    const addrs = await (deps.lookup || defaultLookup)(literal);
    return addrs.length > 0 && addrs.every(isPublicIp);
  } catch { return false; }
}

async function resolveClient(clientId: string, c: Config, deps: Deps): Promise<ClientInfo | null> {
  if (!clientId) return null;
  if (clientId.startsWith("https://")) {
    // Metadata documents: https, default port, public host (and on ALLOWED_REDIRECT_HOSTS when set).
    if (!cimdUrlAllowed(clientId, c.allowedRedirectHosts)) return null;
    const hit = cimdCache.get(clientId);
    if (hit && hit.until > Date.now()) return hit.info;
    let info: ClientInfo | null = null;
    try {
      if (await resolvesPublic(hostOf(clientId), deps)) {
        // No redirects: a public URL must not bounce the fetch to an internal one.
        const r = await deps.fetch(clientId, { headers: { Accept: "application/json", "User-Agent": UA }, redirect: "error", signal: AbortSignal.timeout(5000) });
        const body = r.ok ? await readCapped(r, CIMD_MAX_BYTES) : null;
        const doc = body ? (JSON.parse(body) as { client_id?: unknown; redirect_uris?: unknown; client_name?: unknown }) : null;
        if (doc && doc.client_id === clientId && Array.isArray(doc.redirect_uris) && doc.redirect_uris.length > 0 && doc.redirect_uris.length <= 10
          && doc.redirect_uris.every(u => redirectAllowed(u, c.allowedRedirectHosts))) {
          info = { redirect_uris: doc.redirect_uris as string[], name: typeof doc.client_name === "string" ? doc.client_name.slice(0, 100) : undefined, metadataHost: hostOf(clientId) };
        }
      }
    } catch { info = null; }
    cacheCimd(clientId, info);
    return info;
  }
  const p = open<{ redirect_uris: string[]; name?: string }>(c.tokenKey, "client", clientId);
  if (!p || !Array.isArray(p.redirect_uris)) return null;
  // Re-check on every use: narrowing ALLOWED_REDIRECT_HOSTS takes effect on existing registrations too.
  if (!p.redirect_uris.every(u => redirectAllowed(u, c.allowedRedirectHosts))) return null;
  return { redirect_uris: p.redirect_uris, name: p.name };
}

function resourceOk(resource: string | null, c: Config): boolean {
  if (!resource) return true;
  const norm = (s: string) => s.replace(/\/+$/, "");
  return norm(resource) === norm(resourceUrl(c)) || norm(resource) === norm(c.publicBaseUrl);
}

// ───────────── /authorize ─────────────

export async function authorize(req: Request, deps: Deps): Promise<Response> {
  const c = config();
  const q = new URL(req.url).searchParams;
  const clientId = q.get("client_id") || "";
  const redirectUri = q.get("redirect_uri") || "";
  const client = await resolveClient(clientId, c, deps);
  if (!client) return text("Unknown or invalid client_id. Register the client first.", 400);
  // Never redirect to a URI that is not registered: that is how open redirectors are made.
  if (!redirectUri || !redirectMatches(client.redirect_uris, redirectUri) || !redirectAllowed(redirectUri, c.allowedRedirectHosts)) {
    return text("redirect_uri is missing or does not match the registered redirect URIs.", 400);
  }
  const state = q.get("state") || "";
  const back = (error: string, description: string) => {
    const u = new URL(redirectUri);
    u.searchParams.set("iss", c.publicBaseUrl); // RFC 9207
    u.searchParams.set("error", error);
    u.searchParams.set("error_description", description);
    if (state) u.searchParams.set("state", state);
    return redirect(u.toString());
  };
  if (q.get("response_type") !== "code") return back("unsupported_response_type", "Only response_type=code is supported");
  const challenge = q.get("code_challenge") || "";
  if (!challenge) return back("invalid_request", "PKCE is required: code_challenge is missing");
  if (q.get("code_challenge_method") !== "S256") return back("invalid_request", "PKCE code_challenge_method must be S256");
  if (!/^[A-Za-z0-9_-]{43}$/.test(challenge)) return back("invalid_request", "code_challenge is not a valid S256 challenge");
  const resource = q.get("resource");
  if (!resourceOk(resource, c)) return back("invalid_target", "Unknown resource");

  // Consent step. This server signs in to GitHub with ONE static OAuth app for every MCP client,
  // and GitHub skips its own consent screen once the app is approved. Without a page here, a link to
  // /authorize crafted from someone else's connector flow would complete silently with the owner's GitHub
  // session (the MCP spec's "confused deputy" case). Since any redirect host or app scheme may be
  // registered, this page is also where the owner sees exactly where the code will go. The nonce
  // cookie stops a cross-site form post from skipping the page.
  const nonce = randomId(16);
  const sealedState = seal(c.tokenKey, "state", {
    client_id: clientId, redirect_uri: redirectUri, code_challenge: challenge, state, resource: resource || resourceUrl(c),
    exp: nowSec(deps) + STATE_TTL, n: nonce,
  });
  return consentPage(c, client, redirectUri, sealedState, nonce);
}

const esc = (s: string) => s.replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!));
export const CONSENT_COOKIE = "harold_consent";

function consentPage(c: Config, client: ClientInfo, redirectUri: string, sealedState: string, nonce: string): Response {
  const dest = describeRedirect(redirectUri);
  // The name is whatever the client says; strip control and bidi-override characters so it cannot disguise itself.
  const name = (client.name || "").replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g, "").trim().slice(0, 80) || "An unnamed application";
  const kindNote = dest.kind === "https" ? "" : dest.kind === "loopback"
    ? "<p class=\"muted\">A loopback address is only reachable from this computer.</p>"
    : `<p class="muted">Any app installed on this device can claim the ${esc(dest.target.split("//")[0])} scheme. Continue only if you are connecting that app right now.</p>`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect Harold</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:34rem;margin:8vh auto;padding:0 1rem;color:#1a1a1a;background:#fafaf7}
@media (prefers-color-scheme:dark){body{color:#eee;background:#161616}.who{border-color:#444!important}}button{font:inherit;padding:.6rem 1.2rem;border-radius:.5rem;border:0;background:#2b5cd9;color:#fff;cursor:pointer}
.muted{opacity:.7;font-size:.9rem}.who{border:1px solid #ccc;border-radius:.5rem;padding:.75rem 1rem;margin:1rem 0}.who dt{font-size:.8rem;text-transform:uppercase;letter-spacing:.04em;opacity:.7;margin-top:.5rem}
.who dt:first-child{margin-top:0}.who dd{margin:0;overflow-wrap:anywhere}.dest{font:600 1.15rem/1.4 ui-monospace,SFMono-Regular,Menlo,monospace}code{overflow-wrap:anywhere}</style></head><body>
<h1>Connect Harold?</h1>
<p>An application is asking to read and write Harold (the knowledge base and the CRM).</p>
<dl class="who">
<dt>Application (the name it gives itself)</dt><dd><strong>${esc(name)}</strong>${client.metadataHost ? ` <span class="muted">· metadata published at ${esc(client.metadataHost)}</span>` : ""}</dd>
<dt>Your sign-in will be sent to</dt><dd><span class="dest">${esc(dest.target)}</span><br><span class="muted">${esc(dest.explain)}</span></dd>
<dt>Exact redirect address</dt><dd><code>${esc(redirectUri)}</code></dd>
</dl>
${kindNote}
<p>Continue only if you just started connecting this tool yourself and the destination above is the tool you are using. Whoever receives the sign-in can read and write Harold. You will sign in with GitHub next; only the account <strong>${esc(c.allowedGithubLogin)}</strong> is accepted.</p>
<form method="post" action="${esc(c.publicBaseUrl)}/authorize/approve"><input type="hidden" name="request" value="${esc(sealedState)}"><button type="submit">Continue to GitHub</button></form>
<p class="muted">If you did not expect this, or you do not recognise the destination, close this window. Nothing has been shared.</p>
</body></html>`;
  const secure = c.publicBaseUrl.startsWith("https://") ? "; Secure" : "";
  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://github.com; frame-ancestors 'none'; base-uri 'none'",
      "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer",
      "Set-Cookie": `${CONSENT_COOKIE}=${nonce}; Path=/authorize; HttpOnly; SameSite=Lax; Max-Age=${STATE_TTL}${secure}`,
    },
  });
}

function cookie(req: Request, name: string): string | null {
  for (const part of (req.headers.get("cookie") || "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

/** POST /authorize/approve: the consent button. Checks the nonce cookie, then sends the browser to GitHub. */
export async function approve(req: Request, deps: Deps): Promise<Response> {
  const c = config();
  const form = new URLSearchParams(await req.text());
  const st = open<StatePayload & { n: string } & Record<string, unknown>>(c.tokenKey, "state", form.get("request") || "", nowSec(deps));
  if (!st) return text("This sign-in request has expired or is invalid. Start again from your app.", 400);
  const n = cookie(req, CONSENT_COOKIE);
  if (!n || n !== st.n) return text("Please confirm from the Harold consent page (cookies must be enabled). Start again from your app.", 403);
  const gh = new URL("https://github.com/login/oauth/authorize");
  gh.searchParams.set("client_id", c.githubClientId);
  gh.searchParams.set("redirect_uri", `${c.publicBaseUrl}/github/callback`);
  gh.searchParams.set("scope", "repo");
  gh.searchParams.set("state", form.get("request")!);
  gh.searchParams.set("allow_signup", "false");
  return new Response(null, { status: 303, headers: { Location: gh.toString(), "Cache-Control": "no-store", "Set-Cookie": `${CONSENT_COOKIE}=; Path=/authorize; Max-Age=0` } });
}

// ───────────── /github/callback ─────────────

interface StatePayload { client_id: string; redirect_uri: string; code_challenge: string; state: string; resource: string }

export async function githubCallback(req: Request, deps: Deps): Promise<Response> {
  const c = config();
  const q = new URL(req.url).searchParams;
  const st = open<StatePayload & Record<string, unknown>>(c.tokenKey, "state", q.get("state") || "", nowSec(deps));
  if (!st) return text("This sign-in link has expired or is invalid. Start again from your app.", 400);
  const back = (params: Record<string, string>) => {
    const u = new URL(st.redirect_uri);
    u.searchParams.set("iss", c.publicBaseUrl); // RFC 9207: some clients (Gemini CLI) reject a callback without it
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    if (st.state) u.searchParams.set("state", st.state);
    return redirect(u.toString());
  };
  if (q.get("error")) return back({ error: "access_denied", error_description: "GitHub sign-in was cancelled or refused" });
  const code = q.get("code");
  if (!code) return back({ error: "invalid_request", error_description: "GitHub returned no code" });

  let ghToken = "";
  try {
    const r = await deps.fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": UA },
      body: JSON.stringify({ client_id: c.githubClientId, client_secret: c.githubClientSecret, code, redirect_uri: `${c.publicBaseUrl}/github/callback` }),
    });
    const t = (await r.json()) as { access_token?: string; error?: string };
    ghToken = t.access_token || "";
    if (!ghToken) console.error(`harold-connector: GitHub code exchange refused: ${t.error || `HTTP ${r.status}`}`);
  } catch (e) { ghToken = ""; console.error(`harold-connector: GitHub code exchange failed: ${(e as Error).message}`); }
  if (!ghToken) return back({ error: "server_error", error_description: "Could not exchange the GitHub code" });

  const user = await fetchGithubUser(ghToken, deps.fetch).catch(() => null);
  if (!isAllowedUser(user, c.allowedGithubLogin, c.allowedGithubId)) {
    console.error(`harold-connector: refused GitHub account ${user ? `${user.login} (${user.id})` : "(lookup failed)"}`);
    await revokeGithubToken(ghToken, c, deps).catch(() => undefined); // do not keep a stranger's token alive
    return back({ error: "access_denied", error_description: "This Harold connector only accepts its owner's GitHub account" });
  }

  const authCode = seal(c.tokenKey, "code", {
    gh: ghToken, login: user!.login, uid: user!.id, cc: st.code_challenge, client_id: st.client_id, redirect_uri: st.redirect_uri,
    resource: st.resource, exp: nowSec(deps) + CODE_TTL, jti: randomId(),
  });
  console.log(`harold-connector: GitHub sign-in ok for ${user!.login}; returning code to ${new URL(st.redirect_uri).host}`);
  return back({ code: authCode });
}

async function revokeGithubToken(ghToken: string, c: Config, deps: Deps) {
  const basic = Buffer.from(`${c.githubClientId}:${c.githubClientSecret}`).toString("base64");
  await deps.fetch(`https://api.github.com/applications/${c.githubClientId}/grant`, {
    method: "DELETE",
    headers: { Authorization: `Basic ${basic}`, Accept: "application/vnd.github+json", "User-Agent": UA, "Content-Type": "application/json" },
    body: JSON.stringify({ access_token: ghToken }),
  });
}

// ───────────── /token ─────────────

// Stateless codes could be replayed inside their 5 minutes; remember the ones this instance has
// redeemed. (PKCE already binds a code to the client that started the flow.)
const usedCodes = new Map<string, number>();

export interface AccessPayload { gh: string; login: string; uid: number; client_id: string; scope: string; jti: string; exp: number }

export function issueTokens(c: Config, p: { gh: string; login: string; uid: number; client_id: string }, now = Math.floor(Date.now() / 1000)) {
  const access_token = seal(c.tokenKey, "access", { gh: p.gh, login: p.login, uid: p.uid, client_id: p.client_id, scope: SCOPE, jti: randomId(), iat: now, exp: now + ACCESS_TTL });
  const refresh_token = seal(c.tokenKey, "refresh", { gh: p.gh, login: p.login, uid: p.uid, client_id: p.client_id, jti: randomId(), iat: now, exp: now + REFRESH_TTL });
  return { access_token, token_type: "Bearer", expires_in: ACCESS_TTL, refresh_token, scope: SCOPE };
}

async function readForm(req: Request): Promise<URLSearchParams> {
  const ct = req.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    const o = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return new URLSearchParams(Object.entries(o).map(([k, v]) => [k, String(v)]));
  }
  return new URLSearchParams(await req.text());
}

function basicClientId(req: Request): string | null {
  const h = req.headers.get("authorization") || "";
  if (!/^basic /i.test(h)) return null;
  try { return decodeURIComponent(Buffer.from(h.slice(6), "base64").toString("utf8").split(":")[0]); } catch { return null; }
}

export async function token(req: Request, deps: Deps): Promise<Response> {
  const c = config();
  const f = await readForm(req);
  const grant = f.get("grant_type");
  const clientId = f.get("client_id") || basicClientId(req) || "";
  const now = nowSec(deps);

  if (grant === "authorization_code") {
    const code = f.get("code") || "";
    const p = open<{ gh: string; login: string; uid: number; cc: string; client_id: string; redirect_uri: string; jti: string }>(c.tokenKey, "code", code, now);
    if (!p) return oauthError("invalid_grant", "Authorization code is invalid or expired");
    if (!clientId || clientId !== p.client_id) return oauthError("invalid_grant", "client_id does not match the authorization code");
    if ((f.get("redirect_uri") || "") !== p.redirect_uri) return oauthError("invalid_grant", "redirect_uri does not match the authorization request");
    if (!verifyPkce(f.get("code_verifier"), p.cc)) return oauthError("invalid_grant", "PKCE verification failed");
    const h = sha256(code);
    if (usedCodes.has(h)) return oauthError("invalid_grant", "Authorization code was already used");
    usedCodes.set(h, (p.exp || now + CODE_TTL) * 1000);
    for (const [k, until] of usedCodes) if (until < Date.now()) usedCodes.delete(k);
    return json(issueTokens(c, p, now));
  }

  if (grant === "refresh_token") {
    const p = open<{ gh: string; login: string; uid: number; client_id: string }>(c.tokenKey, "refresh", f.get("refresh_token") || "", now);
    if (!p) return oauthError("invalid_grant", "Refresh token is invalid or expired");
    if (clientId && clientId !== p.client_id) return oauthError("invalid_grant", "client_id does not match the refresh token");
    // The GitHub token inside must still work and still be the owner's.
    const user = await fetchGithubUser(p.gh, deps.fetch).catch(() => null);
    if (!isAllowedUser(user, c.allowedGithubLogin, c.allowedGithubId)) return oauthError("invalid_grant", "The GitHub authorization behind this token is no longer valid");
    return json(issueTokens(c, p, now));
  }

  return oauthError("unsupported_grant_type", "Supported: authorization_code, refresh_token");
}

export function _resetOauthCaches() { usedCodes.clear(); cimdCache.clear(); }
