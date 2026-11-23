// Configuration, read from the environment at call time (never at import time) so tests can
// set process.env before each case and a missing variable fails loudly where it is needed.
// Every value is an environment variable; nothing about one owner or one deployment is built in.
//
// Only GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET have to be typed by hand on Vercel. Every other sign-in
// setting has a default, and a variable that is set always wins over its default:
//   PUBLIC_BASE_URL       https://<VERCEL_PROJECT_PRODUCTION_URL> (the project's production address)
//   HAROLD_REPO           <VERCEL_GIT_REPO_OWNER>/<VERCEL_GIT_REPO_SLUG> (the repository the connector is deployed from)
//   ALLOWED_GITHUB_LOGIN  the owner of that repository, matched by the repository's and the user's numeric ids
//   + ALLOWED_GITHUB_ID   at every check (src/identity.ts, OwnerRule "repo-owner")
//   TOKEN_KEY             derived from GITHUB_CLIENT_SECRET with HKDF-SHA256 (rotating the secret signs everyone out)

import { hkdfSync } from "node:crypto";
import { redirectHostsFromEnv, type RedirectHosts } from "./redirects.js";
import type { OwnerRule } from "./identity.js";

export interface Config {
  tokenKey: Buffer;
  githubClientId: string;
  githubClientSecret: string;
  /** Who may sign in: one named account, or the owner of the repository the connector is deployed from. */
  owner: OwnerRule;
  /** Optional narrowing of redirect targets; null (the default) means any https host. See redirects.ts. */
  allowedRedirectHosts: RedirectHosts;
  publicBaseUrl: string;
  googleClientId: string;
  googleClientSecret: string;
  /** The only Google accounts the calendar connect flow will bind (lowercase emails). */
  allowedGoogleEmails: string[];
}
// HAROLD_REPO / HAROLD_BRANCH are read by repoConfig() and the CRM variables by crm.supabaseFromEnv(),
// where the tools use them; sign-in does not depend on HAROLD_REPO (only on the deployment's own
// repository, when the owner is not named), so a missing HAROLD_REPO surfaces as a clear tool error in
// the chat instead of a failed sign-in.

const env = (name: string): string => (process.env[name] || "").trim();

function required(name: string, hint = ""): string {
  const v = env(name);
  if (!v) throw new Error(`Missing environment variable ${name}${hint ? ` (${hint})` : ""}`);
  return v;
}

// ───────────── the encryption key ─────────────

/** HKDF parameters for the TOKEN_KEY derived from GITHUB_CLIENT_SECRET. Changing the label changes the key (signs everyone out). */
export const TOKEN_KEY_SALT = "harold-connector";
export const TOKEN_KEY_INFO = "harold-connector token key v1";

export function deriveTokenKey(clientSecret: string): Buffer {
  return Buffer.from(hkdfSync("sha256", Buffer.from(clientSecret, "utf8"), Buffer.from(TOKEN_KEY_SALT), Buffer.from(TOKEN_KEY_INFO), 32));
}

/** TOKEN_KEY when set (it must then be valid); otherwise derived from GITHUB_CLIENT_SECRET. */
export function tokenKey(): Buffer {
  const hex = env("TOKEN_KEY");
  if (hex) {
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error("TOKEN_KEY must be 32 bytes as 64 hex characters (openssl rand -hex 32)");
    return Buffer.from(hex, "hex");
  }
  const secret = env("GITHUB_CLIENT_SECRET");
  if (!secret) throw new Error("Missing environment variable GITHUB_CLIENT_SECRET (the GitHub OAuth App's client secret; the encryption key is derived from it unless TOKEN_KEY is set)");
  // GitHub client secrets are 40 hex characters; refuse anything short enough to guess.
  if (secret.length < 20) throw new Error("GITHUB_CLIENT_SECRET is too short to derive the encryption key from; paste the full secret, or set TOKEN_KEY (openssl rand -hex 32)");
  return deriveTokenKey(secret);
}

// ───────────── the public address ─────────────

/**
 * PUBLIC_BASE_URL when set; otherwise https://<VERCEL_PROJECT_PRODUCTION_URL>. Vercel sets that variable on every
 * deployment, previews included, to the project's production domain (the shortest custom domain, else
 * <project>.vercel.app), so a preview announces the production address. Never derived from a request's Host header.
 */
export function publicBaseUrl(): string {
  const explicit = env("PUBLIC_BASE_URL");
  if (explicit) return explicit.replace(/\/+$/, "");
  const host = env("VERCEL_PROJECT_PRODUCTION_URL").toLowerCase();
  if (host && /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(host)) return `https://${host}`;
  throw new Error("Missing environment variable PUBLIC_BASE_URL (this deployment's public origin, e.g. https://<project>.vercel.app; on Vercel it defaults to the production address)");
}

// ───────────── the repository and its owner ─────────────

/** The repository this deployment was built from, when Vercel says (deployed from Git). */
export function vercelRepo(): { repo: string; owner: string; id: number } | null {
  const owner = env("VERCEL_GIT_REPO_OWNER");
  const slug = env("VERCEL_GIT_REPO_SLUG");
  const id = Number(env("VERCEL_GIT_REPO_ID"));
  if (!owner || !slug || !Number.isInteger(id) || id <= 0) return null;
  return { repo: `${owner}/${slug}`, owner, id };
}

/**
 * ALLOWED_GITHUB_LOGIN + ALLOWED_GITHUB_ID when either is set (then both are required). Otherwise, on Vercel, the
 * owner of the repository the connector is deployed from, identified by that repository's numeric id (stable across
 * renames and transfers of names); only when HAROLD_REPO is unset or names that same repository.
 */
export function ownerRule(): OwnerRule {
  const login = env("ALLOWED_GITHUB_LOGIN");
  const idRaw = env("ALLOWED_GITHUB_ID");
  const v = vercelRepo();
  if (login || idRaw || !v) {
    const hint = v ? "" : "; or deploy on Vercel from your own repository, where its owner is used automatically";
    const id = Number(required("ALLOWED_GITHUB_ID", `the owner's numeric GitHub user id${hint}`));
    if (!Number.isInteger(id) || id <= 0) throw new Error("ALLOWED_GITHUB_ID must be a numeric GitHub user id");
    return { kind: "account", login: required("ALLOWED_GITHUB_LOGIN", `the owner's GitHub login${hint}`), id };
  }
  const repo = env("HAROLD_REPO");
  if (repo && repo.toLowerCase() !== v.repo.toLowerCase()) {
    throw new Error(`Missing environment variables ALLOWED_GITHUB_LOGIN and ALLOWED_GITHUB_ID: HAROLD_REPO (${repo}) is not the repository this connector is deployed from, so its owner cannot be used automatically`);
  }
  return { kind: "repo-owner", repoId: v.id, ownerLogin: v.owner };
}

export function config(): Config {
  return {
    tokenKey: tokenKey(),
    githubClientId: required("GITHUB_CLIENT_ID"),
    githubClientSecret: required("GITHUB_CLIENT_SECRET"),
    owner: ownerRule(),
    allowedRedirectHosts: redirectHostsFromEnv(),
    publicBaseUrl: publicBaseUrl(),
    googleClientId: env("GOOGLE_CLIENT_ID"),
    googleClientSecret: env("GOOGLE_CLIENT_SECRET"),
    allowedGoogleEmails: (process.env.ALLOWED_GOOGLE_EMAILS || "").split(",").map(e => e.trim().toLowerCase()).filter(Boolean),
  };
}

/** Only what the knowledge-base tools need; lets them run without the OAuth variables. HAROLD_REPO defaults to the deployment's own repository. */
export function repoConfig(): { repo: string; branch: string } {
  const repo = env("HAROLD_REPO") || vercelRepo()?.repo
    || required("HAROLD_REPO", "owner/name of the private GitHub repository that holds your Harold workspace; on Vercel it defaults to the repository the connector is deployed from");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error(`HAROLD_REPO must look like owner/name, got "${repo}"`);
  const branch = (process.env.HAROLD_BRANCH || "main").trim() || "main";
  return { repo, branch };
}

/** The CRM's service key: SUPABASE_SERVICE_ROLE_KEY, else SUPABASE_SECRET_KEY (the name Vercel's Supabase integration sets). */
export function supabaseKeyFromEnv(): string {
  return env("SUPABASE_SERVICE_ROLE_KEY") || env("SUPABASE_SECRET_KEY");
}

// ───────────── time zone ─────────────
// HAROLD_TZ is an IANA zone name (e.g. America/Chicago, Europe/London). Unset: UTC. An invalid value
// falls back to UTC and the warning is shown in harold_today, so a typo is visible instead of silent.

export interface TzInfo { tz: string; source: "HAROLD_TZ" | "default"; warning?: string }

export function validTz(z: string): boolean {
  try { new Intl.DateTimeFormat("en-US", { timeZone: z }); return true; } catch { return false; }
}

export function tzInfo(): TzInfo {
  const raw = (process.env.HAROLD_TZ || "").trim();
  if (!raw) return { tz: "UTC", source: "default", warning: "HAROLD_TZ is not set, so dates are in UTC. Set it to your IANA time zone, e.g. America/Chicago." };
  if (validTz(raw)) return { tz: raw, source: "HAROLD_TZ" };
  return { tz: "UTC", source: "default", warning: `HAROLD_TZ "${raw}" is not an IANA time zone name (e.g. America/Chicago, Europe/London); using UTC.` };
}

export const tz = (): string => tzInfo().tz;

// ───────────── commits ─────────────

export const DEFAULT_COMMIT_EMAIL = "harold-connector@users.noreply.github.com";

/** Author and committer of every write. HAROLD_COMMIT_EMAIL overrides the neutral noreply default. */
export function commitAuthor(): { name: string; email: string } {
  const email = (process.env.HAROLD_COMMIT_EMAIL || "").trim() || DEFAULT_COMMIT_EMAIL;
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) throw new Error(`HAROLD_COMMIT_EMAIL is not an email address: "${email}"`);
  return { name: "Harold (connector)", email };
}

export const MAX_RESULT_CHARS = 100_000;

