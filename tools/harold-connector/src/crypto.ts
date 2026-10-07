// Sealed blobs: AES-256-GCM, no database anywhere.
//
// Every artefact the OAuth server hands out (client_id, state, authorization code, access token,
// refresh token), and every personal access token (src/pat.ts), is JSON sealed with the TOKEN_KEY. The blob's purpose ("client", "code", ...) is
// bound in as additional authenticated data, so a blob minted for one purpose cannot be replayed
// as another (an authorization code is not an access token, a client_id is not a refresh token, a
// personal access token is none of them).
//
// Wire format: base64url( version(1) | iv(12) | ciphertext | tag(16) )

import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

export type Purpose = "client" | "state" | "code" | "access" | "refresh" | "pat";
const VERSION = 1;

export function seal(key: Buffer, purpose: Purpose, payload: Record<string, unknown>): string {
  if (key.length !== 32) throw new Error("seal: key must be 32 bytes");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(`harold-connector:${purpose}:v${VERSION}`));
  const body = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, body, cipher.getAuthTag()]).toString("base64url");
}

/** Returns the payload, or null if the blob was tampered with, sealed for another purpose, or expired. */
export function open<T extends Record<string, unknown>>(key: Buffer, purpose: Purpose, blob: string, nowSec = Math.floor(Date.now() / 1000)): (T & { exp?: number }) | null {
  try {
    if (typeof blob !== "string" || blob.length < 40 || blob.length > 8192 || !/^[A-Za-z0-9_-]+$/.test(blob)) return null;
    const buf = Buffer.from(blob, "base64url");
    if (buf.length < 1 + 12 + 16 + 1 || buf[0] !== VERSION) return null;
    const iv = buf.subarray(1, 13);
    const tag = buf.subarray(buf.length - 16);
    const body = buf.subarray(13, buf.length - 16);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(Buffer.from(`harold-connector:${purpose}:v${VERSION}`));
    decipher.setAuthTag(tag);
    const json = Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
    const payload = JSON.parse(json) as T & { exp?: number };
    if (typeof payload.exp === "number" && payload.exp < nowSec) return null;
    return payload;
  } catch {
    return null;
  }
}

/** PKCE S256 (RFC 7636): BASE64URL(SHA256(ascii(code_verifier))) == code_challenge */
export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

export function verifyPkce(verifier: string | undefined | null, challenge: string): boolean {
  if (!verifier || !/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return false;
  const a = Buffer.from(pkceChallenge(verifier));
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export function randomId(bytes = 12): string {
  return randomBytes(bytes).toString("base64url");
}
