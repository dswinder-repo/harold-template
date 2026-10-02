// Who is on the other end of a GitHub token. The connector accepts exactly one person:
// ALLOWED_GITHUB_LOGIN and ALLOWED_GITHUB_ID must BOTH match (a login can be renamed and
// re-registered by someone else; the numeric id cannot).

import { sha256 } from "./crypto.js";

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface GithubUser { login: string; id: number }

export const GITHUB_API = "https://api.github.com";
export const UA = "harold-connector";

export async function fetchGithubUser(ghToken: string, fetchImpl: FetchLike = fetch): Promise<GithubUser | null> {
  const r = await fetchImpl(`${GITHUB_API}/user`, {
    headers: { Authorization: `Bearer ${ghToken}`, Accept: "application/vnd.github+json", "User-Agent": UA, "X-GitHub-Api-Version": "2022-11-28" },
  });
  if (!r.ok) return null;
  const u = (await r.json()) as { login?: unknown; id?: unknown };
  if (typeof u.login !== "string" || typeof u.id !== "number") return null;
  return { login: u.login, id: u.id };
}

export function isAllowedUser(u: GithubUser | null, allowedLogin: string, allowedId: number): boolean {
  if (!u) return false;
  return u.login.toLowerCase() === allowedLogin.toLowerCase() && u.id === allowedId;
}

// One identity check per access token, remembered for the life of this function instance.
// Fluid compute reuses instances, so this is usually one GitHub call per token per instance.
const checked = new Map<string, { ok: boolean; until: number }>();

export async function checkTokenIdentityOnce(
  accessToken: string, ghToken: string, allowedLogin: string, allowedId: number, expSec: number, fetchImpl: FetchLike = fetch,
): Promise<boolean> {
  const k = sha256(accessToken);
  const now = Date.now();
  const hit = checked.get(k);
  if (hit && hit.until > now) return hit.ok;
  const ok = isAllowedUser(await fetchGithubUser(ghToken, fetchImpl), allowedLogin, allowedId);
  // A failed check is only cached briefly, so a transient GitHub error does not lock the token out.
  checked.set(k, { ok, until: ok ? expSec * 1000 : now + 30_000 });
  if (checked.size > 500) for (const [key, v] of checked) if (v.until <= now) checked.delete(key);
  return ok;
}

export function _resetIdentityCache() { checked.clear(); }
