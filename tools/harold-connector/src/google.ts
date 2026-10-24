// Google Calendar access owned by Harold itself: a small OAuth 2.0 flow on the connector, so every
// harness reads the calendars through Harold instead of relying on whichever calendar connector a
// particular chat happens to have. Read-only scopes only; there are no calendar write tools.
//
// Setup (once): the owner opens /google/authorize in a browser, approves the Google consent screen,
// and Google redirects to /google/callback. The callback exchanges the code, refuses any Google
// account whose email is not in ALLOWED_GOOGLE_EMAILS, seals the refresh token with the TOKEN_KEY
// (purpose "google") and shows it once, for the owner to store as GOOGLE_REFRESH_TOKEN in the
// deployment environment - the same philosophy as the personal access tokens (scripts/mint-token.ts):
// the TOKEN_KEY holder is the only one who can decrypt it, and rotating TOKEN_KEY revokes it.
//
// The connector has no database, so the sealed token lives in the environment. If Google ever rotates
// the refresh token on use, the rotated value cannot be persisted from a serverless run; the env value
// stays authoritative and a refusal means re-running /google/authorize. A durable store (e.g. a row in
// the existing Supabase project) is a possible follow-up and is deliberately not built here: it would
// make the CRM database a hard dependency of calendar reads.

import { randomBytes } from "node:crypto";
import { seal, open } from "./crypto.js";
import { config, tokenKey } from "./config.js";
import type { FetchLike } from "./identity.js";

export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const CALENDAR_API = "https://www.googleapis.com/calendar/v3";
export const SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
];

export interface GoogleConfig { clientId: string; clientSecret: string; /** sealed (purpose "google") refresh token */ sealedToken: string }

/** The three variables the calendar tools need; null (tools say "not configured") without them all. */
export function googleFromEnv(): GoogleConfig | null {
  const clientId = (process.env.GOOGLE_CLIENT_ID || "").trim();
  const clientSecret = (process.env.GOOGLE_CLIENT_SECRET || "").trim();
  const sealedToken = (process.env.GOOGLE_REFRESH_TOKEN || "").trim();
  if (!clientId || !clientSecret || !sealedToken) return null;
  return { clientId, clientSecret, sealedToken };
}

const STATE_TTL_SEC = 600;

/** Start of the owner-facing flow: redirect to Google's consent screen. State is sealed, 10 minutes. */
export function authorize(publicBaseUrl: string, clientId: string): string {
  const state = seal(tokenKey(), "google-state", { nonce: randomBytes(8).toString("hex"), exp: Math.floor(Date.now() / 1000) + STATE_TTL_SEC });
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${publicBaseUrl}/google/callback`,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent", // guarantees a refresh token, even on a repeat grant
    state,
  });
  return `${GOOGLE_AUTH_URL}?${q.toString()}`;
}

const page = (title: string, body: string, status = 200) =>
  new Response(`<!doctype html><title>${title}</title><body style="font-family:system-ui;max-width:42rem;margin:3rem auto;line-height:1.5">${body}</body>`, { status, headers: { "content-type": "text/html; charset=utf-8" } });
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export async function callback(req: Request, fetchImpl: FetchLike): Promise<Response> {
  const url = new URL(req.url);
  const error = url.searchParams.get("error");
  if (error) return page("Calendar not connected", `<h2>Calendar not connected</h2><p>Google answered: <b>${esc(error)}</b>. Nothing was stored.</p>`, 400);
  const state = url.searchParams.get("state") || "";
  const code = url.searchParams.get("code") || "";
  const st = open(tokenKey(), "google-state", state);
  if (!st) return page("Calendar not connected", `<h2>Calendar not connected</h2><p>This sign-in link is unknown or older than 10 minutes. Start again at <code>/google/authorize</code>.</p>`, 400);
  if (!code) return page("Calendar not connected", `<h2>Calendar not connected</h2><p>No authorization code came back from Google.</p>`, 400);

  const c = config();
  const tokRes = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: c.googleClientId,
      client_secret: c.googleClientSecret,
      redirect_uri: `${c.publicBaseUrl}/google/callback`,
      grant_type: "authorization_code",
    }).toString(),
  });
  const tok = await tokRes.json().catch(() => ({})) as { access_token?: string; refresh_token?: string; error?: string; error_description?: string };
  if (!tokRes.ok || !tok.access_token) {
    return page("Calendar not connected", `<h2>Calendar not connected</h2><p>Google's token exchange failed: ${esc(tok.error_description || tok.error || `HTTP ${tokRes.status}`)}.</p>`, 502);
  }
  if (!tok.refresh_token) {
    return page("Calendar not connected", `<h2>Calendar not connected</h2><p>Google did not return a refresh token. Start again at <code>/google/authorize</code>; the flow asks for consent explicitly so one is issued.</p>`, 502);
  }

  // The one-person gate, same idea as ALLOWED_GITHUB_LOGIN on the MCP sign-in: only Google accounts
  // the owner listed can bind a token here - anyone else completing the flow is refused.
  // The account's email is the id of its primary calendar, which the granted calendar scopes can read
  // (the userinfo endpoint would need an identity scope this connector deliberately does not request).
  const calRes = await fetchImpl(`${CALENDAR_API}/users/me/calendarList/primary`, { headers: { authorization: `Bearer ${tok.access_token}` } });
  const cal = await calRes.json().catch(() => ({})) as { id?: string; error?: { message?: string } };
  const email = (cal.id || "").toLowerCase();
  if (!email || !c.allowedGoogleEmails.includes(email)) {
    const why = email ? "" : calRes.ok
      ? " The primary-calendar lookup answered but carried no id."
      : ` The primary-calendar lookup failed: HTTP ${calRes.status}${cal.error?.message ? ` (${esc(cal.error.message)})` : ""}.`;
    return page("Calendar not connected", `<h2>Calendar not connected</h2><p>The Google account <b>${esc(email || "(unknown)")}</b> is not in this connector's ALLOWED_GOOGLE_EMAILS, so nothing was stored.${why} Sign in with an allowed account, or add it to the deployment environment first.</p>`, 403);
  }

  const sealed = seal(tokenKey(), "google", { rt: tok.refresh_token, email });
  return page("Calendar connected", `<h2>Calendar connected for ${esc(email)}</h2>
<p>Shown once. Store this as <code>GOOGLE_REFRESH_TOKEN</code> in the connector's environment (Production), redeploy, and the <code>calendar_list</code> and <code>calendar_events</code> tools go live:</p>
<p><code style="word-break:break-all;user-select:all">${esc(sealed)}</code></p>
<p>It is encrypted with the connector's TOKEN_KEY and useless without it. Rotating TOKEN_KEY revokes it (connect again the same way). Google consent-screen note: an app left in "Testing" status issues refresh tokens that expire after 7 days; publish the consent screen to avoid a weekly re-connect.</p>`);
}
