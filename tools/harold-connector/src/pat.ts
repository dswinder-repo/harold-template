// Personal access tokens: for tools and scheduled jobs that cannot do interactive OAuth (a cron job,
// a simple agent configured with a static `Authorization: Bearer ...` header).
//
// A PAT is a blob sealed with TOKEN_KEY under its own purpose ("pat"), so it can never be read as a
// client_id, a sign-in state, an authorization code, an OAuth access token or a refresh token, and none
// of those can be read as a PAT. It carries an id, a label, the owner's GitHub login and numeric id, the
// GitHub token the tools act with (checked to be the owner's when the PAT is minted), and an expiry.
//
// Only whoever holds TOKEN_KEY can mint one, so using it needs no GitHub round trip. Revocation:
//   one token   add its id to REVOKED_TOKEN_IDS (comma-separated) and redeploy;
//   all tokens  rotate TOKEN_KEY (this also signs every OAuth client out).
// Lifetime is capped at PAT_MAX_DAYS, both when minting and when the token is used.
//
// Mint with `npm run token -- --name <label> --days <n>` (scripts/mint-token.ts).

import { open, randomId, seal } from "./crypto.js";

export const PAT_PREFIX = "harold_pat_";
export const PAT_MAX_DAYS = 365;
const DAY = 86400;

export interface PatPayload { id: string; name: string; login: string; uid: number; gh: string; iat: number; exp: number }

export function revokedTokenIds(raw = process.env.REVOKED_TOKEN_IDS): Set<string> {
  return new Set((raw || "").split(",").map(s => s.trim()).filter(Boolean));
}

export function validPatName(name: unknown): name is string {
  return typeof name === "string" && /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,59}$/.test(name);
}

export function mintPat(key: Buffer, p: { name: string; days: number; login: string; uid: number; gh: string }, now = Math.floor(Date.now() / 1000)) {
  if (!validPatName(p.name)) throw new Error("--name must be 1-60 characters: letters, digits, space, dot, dash, underscore");
  if (!Number.isInteger(p.days) || p.days < 1 || p.days > PAT_MAX_DAYS) throw new Error(`--days must be a whole number from 1 to ${PAT_MAX_DAYS}`);
  if (!p.login || !Number.isInteger(p.uid) || p.uid <= 0 || !p.gh) throw new Error("mintPat: login, uid and gh are required");
  const payload: PatPayload = { id: randomId(9), name: p.name, login: p.login, uid: p.uid, gh: p.gh, iat: now, exp: now + p.days * DAY };
  return { token: PAT_PREFIX + seal(key, "pat", { ...payload }), id: payload.id, name: payload.name, exp: payload.exp };
}

/**
 * The PAT's payload if the bearer is a PAT minted with `key`, unexpired, within the lifetime cap, not
 * revoked, and still for the configured owner (login AND numeric id). Otherwise null.
 */
export function verifyPat(
  key: Buffer, bearer: string, owner: { login: string; id: number }, revoked: Set<string> = revokedTokenIds(), now = Math.floor(Date.now() / 1000),
): PatPayload | null {
  if (typeof bearer !== "string" || !bearer.startsWith(PAT_PREFIX)) return null;
  const p = open<PatPayload & Record<string, unknown>>(key, "pat", bearer.slice(PAT_PREFIX.length), now);
  if (!p) return null;
  if (typeof p.id !== "string" || !p.id || typeof p.gh !== "string" || !p.gh || typeof p.login !== "string" || typeof p.uid !== "number") return null;
  if (typeof p.exp !== "number" || typeof p.iat !== "number" || p.exp <= now || p.exp - p.iat > PAT_MAX_DAYS * DAY) return null;
  if (revoked.has(p.id)) return null;
  if (p.login.toLowerCase() !== owner.login.toLowerCase() || p.uid !== owner.id) return null;
  return p;
}

/** `--name <label> --days <n>` (also `--name=<label>`). */
export function parsePatArgs(argv: string[]): { name: string; days: number } {
  const get = (flag: string): string | undefined => {
    for (let i = 0; i < argv.length; i++) {
      if (argv[i] === flag) return argv[i + 1];
      if (argv[i].startsWith(flag + "=")) return argv[i].slice(flag.length + 1);
    }
    return undefined;
  };
  const name = get("--name");
  const daysRaw = get("--days");
  if (!name) throw new Error("Usage: npm run token -- --name <label> --days <n>   (missing --name)");
  if (!daysRaw) throw new Error("Usage: npm run token -- --name <label> --days <n>   (missing --days)");
  if (!/^\d+$/.test(daysRaw)) throw new Error(`--days must be a whole number from 1 to ${PAT_MAX_DAYS}`);
  const days = Number(daysRaw);
  if (!validPatName(name)) throw new Error("--name must be 1-60 characters: letters, digits, space, dot, dash, underscore");
  if (days < 1 || days > PAT_MAX_DAYS) throw new Error(`--days must be a whole number from 1 to ${PAT_MAX_DAYS}`);
  return { name, days };
}
