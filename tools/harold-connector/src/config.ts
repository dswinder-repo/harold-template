// Configuration, read from the environment at call time (never at import time) so tests can
// set process.env before each case and a missing variable fails loudly where it is needed.
// Every value is an environment variable; nothing about one owner or one deployment is built in.

export interface Config {
  tokenKey: Buffer;
  githubClientId: string;
  githubClientSecret: string;
  allowedGithubLogin: string;
  allowedGithubId: number;
  allowedRedirectHosts: string[];
  publicBaseUrl: string;
}
// HAROLD_REPO / HAROLD_BRANCH are read by repoConfig() and the CRM variables by crm.supabaseFromEnv(),
// where the tools use them; sign-in does not depend on them, so a missing HAROLD_REPO surfaces as a
// clear tool error in the chat instead of a failed sign-in.

function required(name: string, hint = ""): string {
  const v = (process.env[name] || "").trim();
  if (!v) throw new Error(`Missing environment variable ${name}${hint ? ` (${hint})` : ""}`);
  return v;
}

export function tokenKey(): Buffer {
  const hex = required("TOKEN_KEY", "openssl rand -hex 32");
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error("TOKEN_KEY must be 32 bytes as 64 hex characters (openssl rand -hex 32)");
  return Buffer.from(hex, "hex");
}

export function config(): Config {
  const id = Number(required("ALLOWED_GITHUB_ID", "the owner's numeric GitHub user id"));
  if (!Number.isInteger(id) || id <= 0) throw new Error("ALLOWED_GITHUB_ID must be a numeric GitHub user id");
  return {
    tokenKey: tokenKey(),
    githubClientId: required("GITHUB_CLIENT_ID"),
    githubClientSecret: required("GITHUB_CLIENT_SECRET"),
    allowedGithubLogin: required("ALLOWED_GITHUB_LOGIN", "the owner's GitHub login"),
    allowedGithubId: id,
    allowedRedirectHosts: (process.env.ALLOWED_REDIRECT_HOSTS || "claude.ai,claude.com")
      .split(",").map(s => s.trim().toLowerCase()).filter(Boolean),
    publicBaseUrl: required("PUBLIC_BASE_URL").replace(/\/+$/, ""),
  };
}

/** Only what the knowledge-base tools need; lets them run without the OAuth variables. HAROLD_REPO has no default. */
export function repoConfig(): { repo: string; branch: string } {
  const repo = required("HAROLD_REPO", "owner/name of the private GitHub repository that holds your Harold workspace");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error(`HAROLD_REPO must look like owner/name, got "${repo}"`);
  const branch = (process.env.HAROLD_BRANCH || "main").trim() || "main";
  return { repo, branch };
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

// ───────────── contact types never logged ─────────────
// Optional, empty by default: HAROLD_NO_LOG_TYPES lists contact types (comma-separated, matched
// case-insensitively) whose conversations are never logged as CRM interactions. Their records may still
// be created and updated. Same setting and meaning as bin/harold and tools/harold-mcp.

export function noLogTypes(): string[] {
  return [...new Set((process.env.HAROLD_NO_LOG_TYPES || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean))];
}

export const isNoLogType = (type: unknown): boolean => {
  const t = String(type ?? "").trim().toLowerCase();
  return !!t && noLogTypes().includes(t);
};

// ───────────── commits ─────────────

export const DEFAULT_COMMIT_EMAIL = "harold-connector@users.noreply.github.com";

/** Author and committer of every write. HAROLD_COMMIT_EMAIL overrides the neutral noreply default. */
export function commitAuthor(): { name: string; email: string } {
  const email = (process.env.HAROLD_COMMIT_EMAIL || "").trim() || DEFAULT_COMMIT_EMAIL;
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) throw new Error(`HAROLD_COMMIT_EMAIL is not an email address: "${email}"`);
  return { name: "Harold (connector)", email };
}

export const MAX_RESULT_CHARS = 100_000;
