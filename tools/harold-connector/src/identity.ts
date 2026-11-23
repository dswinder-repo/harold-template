// Who is on the other end of a GitHub token. The connector accepts exactly one person, by one of two rules
// (config.ts ownerRule()):
//
//   "account"     ALLOWED_GITHUB_LOGIN and ALLOWED_GITHUB_ID must BOTH match (a login can be renamed and
//                 re-registered by someone else; the numeric id cannot).
//   "repo-owner"  neither is set and the connector runs on Vercel from a Git repository: the user must own
//                 that repository. The repository is looked up by its numeric id (GET /repositories/:id,
//                 with the user's own token) and its owner compared to the user by numeric id, so renaming
//                 an account or a repository, and someone else taking over the old name, changes nothing.
//                 A repository owned by an organization is refused: several people can administer one, and
//                 the connector is for one person, so that case needs ALLOWED_GITHUB_LOGIN and ALLOWED_GITHUB_ID.
//
// The same check runs at sign-in, at every token refresh, once per access token on /mcp, and for personal
// access tokens under the "repo-owner" rule.

import { sha256 } from "./crypto.js";

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface GithubUser { login: string; id: number }

export type OwnerRule =
  | { kind: "account"; login: string; id: number }
  | { kind: "repo-owner"; repoId: number; ownerLogin: string };

export const GITHUB_API = "https://api.github.com";
export const UA = "harold-connector";

const ghHeaders = (ghToken: string) => ({ Authorization: `Bearer ${ghToken}`, Accept: "application/vnd.github+json", "User-Agent": UA, "X-GitHub-Api-Version": "2022-11-28" });

export async function fetchGithubUser(ghToken: string, fetchImpl: FetchLike = fetch): Promise<GithubUser | null> {
  const r = await fetchImpl(`${GITHUB_API}/user`, { headers: ghHeaders(ghToken) });
  if (!r.ok) return null;
  const u = (await r.json()) as { login?: unknown; id?: unknown };
  if (typeof u.login !== "string" || typeof u.id !== "number") return null;
  return { login: u.login, id: u.id };
}

export function isAllowedUser(u: GithubUser | null, allowedLogin: string, allowedId: number): boolean {
  if (!u) return false;
  return u.login.toLowerCase() === allowedLogin.toLowerCase() && u.id === allowedId;
}

/** Who the rule accepts, in words, for the consent page. */
export function describeOwner(rule: OwnerRule): string {
  return rule.kind === "account" ? rule.login : `${rule.ownerLogin} (the owner of the repository this connector is deployed from)`;
}

export type OwnerCheck = { ok: true; user: GithubUser } | { ok: false; user: GithubUser | null; reason: "no-user" | "not-owner" | "organization" };

/** Is the GitHub token's user the one person `rule` accepts? Fails closed on any GitHub error. */
export async function checkOwner(ghToken: string, rule: OwnerRule, fetchImpl: FetchLike = fetch): Promise<OwnerCheck> {
  const user = await fetchGithubUser(ghToken, fetchImpl).catch(() => null);
  if (!user) return { ok: false, user: null, reason: "no-user" };
  if (rule.kind === "account") return isAllowedUser(user, rule.login, rule.id) ? { ok: true, user } : { ok: false, user, reason: "not-owner" };
  try {
    const r = await fetchImpl(`${GITHUB_API}/repositories/${rule.repoId}`, { headers: ghHeaders(ghToken) });
    // 404: the user cannot see the (private) repository, so is certainly not its owner.
    if (!r.ok) return { ok: false, user, reason: "not-owner" };
    const repo = (await r.json()) as { id?: unknown; owner?: { id?: unknown; type?: unknown } };
    if (repo.id !== rule.repoId || !repo.owner || typeof repo.owner.id !== "number") return { ok: false, user, reason: "not-owner" };
    if (repo.owner.type !== "User") return { ok: false, user, reason: "organization" };
    return repo.owner.id === user.id ? { ok: true, user } : { ok: false, user, reason: "not-owner" };
  } catch {
    return { ok: false, user, reason: "not-owner" };
  }
}

// One identity check per access token, remembered for the life of this function instance.
// Fluid compute reuses instances, so this is usually one GitHub call (two for "repo-owner") per token per instance.
const checked = new Map<string, { ok: boolean; uid?: number; until: number }>();

/** The token's owner check, cached per access token (or personal access token). Returns the accepted user's id, or null. */
export async function checkTokenIdentityOnce(
  accessToken: string, ghToken: string, rule: OwnerRule, expSec: number, fetchImpl: FetchLike = fetch,
): Promise<number | null> {
  const k = sha256(accessToken);
  const now = Date.now();
  const hit = checked.get(k);
  if (hit && hit.until > now) return hit.ok ? hit.uid! : null;
  const res = await checkOwner(ghToken, rule, fetchImpl);
  // A failed check is only cached briefly, so a transient GitHub error does not lock the token out.
  checked.set(k, res.ok ? { ok: true, uid: res.user.id, until: expSec * 1000 } : { ok: false, until: now + 30_000 });
  if (checked.size > 500) for (const [key, v] of checked) if (v.until <= now) checked.delete(key);
  return res.ok ? res.user.id : null;
}

export function _resetIdentityCache() { checked.clear(); }
