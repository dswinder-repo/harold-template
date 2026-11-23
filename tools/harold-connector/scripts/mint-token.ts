// Mint a personal access token for a tool or scheduled job that cannot do interactive OAuth:
//
//   npm run token -- --name <label> --days <n>          (at most 365 days)
//
// Needs, in this process's environment only (never on the command line, never in a file in the repo):
//   TOKEN_KEY             the SAME value as the deployment (a token minted with another key is refused there);
//                         if the deployment has no TOKEN_KEY, set GITHUB_CLIENT_SECRET to its value instead
//                         (the key is derived from it the same way)
//   ALLOWED_GITHUB_LOGIN  and ALLOWED_GITHUB_ID, as in the deployment; if the deployment leaves them unset (its
//                         owner is the owner of its repository), set HAROLD_REPO=owner/name to that repository instead
//   GITHUB_TOKEN          the GitHub token the tools will act with; if unset, `gh auth token` is used.
//                         It must belong to the owner; it is checked here, and again by the deployment when the
//                         owner is the repository's owner.
//
// The token is printed on stdout and nothing is stored anywhere. Its id is printed on stderr: to revoke
// this one token, add the id to REVOKED_TOKEN_IDS in the deployment and redeploy. Rotating TOKEN_KEY (or
// GITHUB_CLIENT_SECRET, when TOKEN_KEY is unset) revokes every token (and signs every OAuth client out).

import { execFileSync } from "node:child_process";
import { tokenKey } from "../src/config.js";
import { fetchGithubUser, GITHUB_API, isAllowedUser, UA } from "../src/identity.js";
import { mintPat, parsePatArgs } from "../src/pat.js";

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

function ghCliToken(): string {
  try { return execFileSync("gh", ["auth", "token"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return ""; }
}

let args: { name: string; days: number };
try { args = parsePatArgs(process.argv.slice(2)); } catch (e) { fail((e as Error).message); }

let key: Buffer;
try { key = tokenKey(); } catch (e) { fail(`${(e as Error).message}. Set TOKEN_KEY (or, if the deployment has none, GITHUB_CLIENT_SECRET) to the deployment's value in this shell first.`); }

const login = (process.env.ALLOWED_GITHUB_LOGIN || "").trim();
const idRaw = (process.env.ALLOWED_GITHUB_ID || "").trim();
const repo = (process.env.HAROLD_REPO || "").trim();
const id = Number(idRaw);
if (login || idRaw || !repo) {
  if (!login || !Number.isInteger(id) || id <= 0) fail("Set ALLOWED_GITHUB_LOGIN and ALLOWED_GITHUB_ID (the deployment's values), or, if the deployment leaves them unset, HAROLD_REPO=owner/name (the repository it is deployed from), in this shell first.");
}

const gh = (process.env.GITHUB_TOKEN || "").trim() || ghCliToken();
if (!gh) fail("Set GITHUB_TOKEN (or sign in with the GitHub CLI: gh auth login). The tools act with it.");

const user = await fetchGithubUser(gh).catch(() => null);
if (login) {
  if (!isAllowedUser(user, login, id)) fail(`The GitHub token belongs to ${user ? `${user.login} (${user.id})` : "nobody GitHub recognises"}, not ${login} (${id}). Nothing minted.`);
} else {
  if (!user) fail("GitHub does not recognise this token. Nothing minted.");
  const r = await fetch(`${GITHUB_API}/repos/${repo}`, { headers: { Authorization: `Bearer ${gh}`, Accept: "application/vnd.github+json", "User-Agent": UA } }).catch(() => null);
  const o = r?.ok ? ((await r.json()) as { owner?: { id?: unknown; type?: unknown } }).owner : undefined;
  if (!o || o.type !== "User" || o.id !== user.id) fail(`The GitHub token belongs to ${user.login} (${user.id}), who does not own ${repo} (or it belongs to an organization, which needs ALLOWED_GITHUB_LOGIN and ALLOWED_GITHUB_ID). Nothing minted.`);
}

const t = mintPat(key, { name: args.name, days: args.days, login: user!.login, uid: user!.id, gh });
console.error(`Minted "${t.name}" (id ${t.id}), valid until ${new Date(t.exp * 1000).toISOString()}.`);
console.error(`Use it as the header  Authorization: Bearer <token>  on <PUBLIC_BASE_URL>/mcp.`);
console.error(`To revoke it: add ${t.id} to REVOKED_TOKEN_IDS in the deployment and redeploy.`);
console.log(t.token);
