// Where an authorization code may be sent, and where a client's metadata may be fetched from.
//
// Any MCP client can sign in, not only one chat app. Three kinds of redirect URI are accepted:
//
//   loopback     http://127.0.0.1, http://[::1], http://localhost on any port and path      (RFC 8252 §7.3)
//                CLI and desktop clients listen there for the one redirect. Always accepted.
//   private-use  cursor://..., vscode://..., com.example.app:/cb: an app on this device       (RFC 8252 §7.1)
//                Dangerous or meaningless schemes (javascript, data, file, ...) are refused.
//   https        any host, unless ALLOWED_REDIRECT_HOSTS narrows it (web apps such as claude.ai).
//
// Never accepted: userinfo (https://user@host), a fragment (#...), whitespace or control characters,
// plain http to anything but loopback.
//
// What keeps this safe is not the list: it is the single-GitHub-account gate, PKCE S256 and the consent
// page, which shows the exact destination before the owner approves (see oauth.ts).
//
// ALLOWED_REDIRECT_HOSTS (optional): unset, empty or "*" means any https host and any safe private-use
// scheme. A comma list narrows both: hosts (exact match, e.g. claude.ai) for https, and entries ending in
// ":" (e.g. cursor:, vscode:) for private-use schemes. Loopback stays accepted either way.

import { isIP } from "node:net";

/** null = unrestricted (the default). */
export type RedirectHosts = string[] | null;
export type RedirectKind = "https" | "loopback" | "private-use";

export function redirectHostsFromEnv(raw = process.env.ALLOWED_REDIRECT_HOSTS): RedirectHosts {
  const list = (raw || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  if (!list.length || list.includes("*")) return null;
  return list;
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "[::1]", "localhost"]);

// Schemes that run code, read local files, or do not lead to an app that could receive a code.
export const BLOCKED_SCHEMES = new Set([
  "javascript:", "data:", "file:", "blob:", "about:", "vbscript:", "ws:", "wss:", "ftp:",
  "filesystem:", "view-source:", "mailto:", "tel:", "sms:",
]);

// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS = /[\u0000- \u007f]/;

/** The kind of redirect URI, or null if it is not acceptable under `hosts`. */
export function classifyRedirect(uri: unknown, hosts: RedirectHosts): RedirectKind | null {
  if (typeof uri !== "string" || !uri || uri.length > 2000 || UNSAFE_CHARS.test(uri) || uri.includes("#")) return null;
  let u: URL;
  try { u = new URL(uri); } catch { return null; }
  if (u.username || u.password || u.hash) return null;
  const scheme = u.protocol.toLowerCase();
  if (scheme === "http:" || scheme === "https:") {
    const host = u.hostname.toLowerCase();
    if (!host) return null;
    if (LOOPBACK_HOSTS.has(host)) return "loopback";
    if (scheme !== "https:") return null;
    return hosts === null || hosts.includes(host) ? "https" : null;
  }
  if (!/^[a-z][a-z0-9+.-]*:$/.test(scheme) || BLOCKED_SCHEMES.has(scheme)) return null;
  return hosts === null || hosts.includes(scheme) ? "private-use" : null;
}

export const redirectAllowed = (uri: unknown, hosts: RedirectHosts): boolean => classifyRedirect(uri, hosts) !== null;

/**
 * Is `requested` one of the registered redirect URIs? Exact string match, except that a loopback URI
 * may differ in its port only (RFC 8252 §7.3: native apps pick a free port at request time).
 */
export function redirectMatches(registered: string[], requested: string): boolean {
  if (registered.includes(requested)) return true;
  if (classifyRedirect(requested, null) !== "loopback") return false;
  const r = new URL(requested);
  return registered.some(reg => {
    if (classifyRedirect(reg, null) !== "loopback") return false;
    const g = new URL(reg);
    return g.protocol === r.protocol && g.hostname === r.hostname && g.pathname === r.pathname && g.search === r.search;
  });
}

/** What the consent page shows as the destination of the code. */
export function describeRedirect(uri: string): { kind: RedirectKind | null; target: string; explain: string } {
  const kind = classifyRedirect(uri, null);
  const u = new URL(uri);
  if (kind === "loopback") return { kind, target: `${u.hostname}${u.port ? `:${u.port}` : ""}`, explain: "a program on this computer (a loopback address; used by command-line and desktop tools)" };
  if (kind === "private-use") return { kind, target: u.host ? `${u.protocol}//${u.host}` : u.protocol, explain: `the app on this device that handles ${u.protocol} links` };
  return { kind, target: u.host, explain: "a website" };
}

// ───────────── Client ID Metadata Documents: where the server may fetch from (SSRF guard) ─────────────

/** An https client_id URL the server may fetch: public host, default port, no userinfo or fragment. */
export function cimdUrlAllowed(clientId: string, hosts: RedirectHosts): boolean {
  if (typeof clientId !== "string" || clientId.length > 2000 || UNSAFE_CHARS.test(clientId) || clientId.includes("#")) return false;
  let u: URL;
  try { u = new URL(clientId); } catch { return false; }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return false;
  const host = u.hostname.toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".")) return false;
  const literal = host.startsWith("[") ? host.slice(1, -1) : host;
  if (isIP(literal) && !isPublicIp(literal)) return false;
  return hosts === null || hosts.includes(host);
}

export const hostOf = (url: string): string => new URL(url).hostname.toLowerCase();

function v4Public(o: number[]): boolean {
  const [a, b, c] = o;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;                       // this-net, private, loopback, multicast, reserved
  if (a === 100 && b >= 64 && b <= 127) return false;                                   // CGNAT
  if (a === 169 && b === 254) return false;                                             // link-local (cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;                       // IETF assignments, TEST-NET-1
  if (a === 192 && b === 88 && c === 99) return false;                                  // 6to4 relay
  if (a === 198 && (b === 18 || b === 19)) return false;                                // benchmarking
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function parseV4(s: string): number[] | null {
  const m = s.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const o = m.slice(1).map(Number);
  return o.every(n => n <= 255) ? o : null;
}

function parseV6(s: string): number[] | null {
  if (s.includes("%")) return null; // zone ids are link-local by definition
  const dotted = s.match(/^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) { // ::ffff:127.0.0.1 -> ::ffff:7f00:1
    const o = parseV4(dotted[2]);
    if (!o) return null;
    s = `${dotted[1]}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const part = (x: string) => (x ? x.split(":").map(h => (/^[0-9a-f]{1,4}$/i.test(h) ? parseInt(h, 16) : NaN)) : []);
  const head = part(halves[0]);
  const rest = halves.length === 2 ? part(halves[1]) : [];
  const fill = 8 - head.length - rest.length;
  if (halves.length === 1 ? fill !== 0 : fill < 1) return null;
  const groups = [...head, ...Array(halves.length === 2 ? fill : 0).fill(0), ...rest];
  return groups.every(g => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

/** true only for a globally routable unicast address. Unparseable input counts as not public. */
export function isPublicIp(ip: string): boolean {
  const s = ip.trim().replace(/^\[|\]$/g, "").toLowerCase();
  const kind = isIP(s);
  if (kind === 4) { const o = parseV4(s); return !!o && v4Public(o); }
  if (kind !== 6) return false;
  const g = parseV6(s);
  if (!g) return false;
  const embedded = (hi: number, lo: number) => v4Public([hi >> 8, hi & 255, lo >> 8, lo & 255]);
  if (g.slice(0, 6).every(x => x === 0)) return g[6] === 0 && g[7] <= 1 ? false : embedded(g[6], g[7]); // ::, ::1, ::a.b.c.d
  if (g.slice(0, 5).every(x => x === 0) && g[5] === 0xffff) return embedded(g[6], g[7]);              // ::ffff:a.b.c.d
  if (g[0] === 0x64 && g[1] === 0xff9b) return g[2] === 0 && g.slice(3, 6).every(x => x === 0) ? embedded(g[6], g[7]) : false; // NAT64
  if (g[0] === 0x2002) return embedded(g[1], g[2]);                                                    // 6to4
  if (g[0] === 0x2001 && (g[1] === 0 || g[1] === 0xdb8)) return false;                                 // Teredo, documentation
  if (g[0] === 0x100 && g.slice(1, 4).every(x => x === 0)) return false;                               // discard-only
  if ((g[0] & 0xfe00) === 0xfc00) return false;                                                        // unique local
  if ((g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xffc0) === 0xfec0) return false;                          // link-local, site-local
  if ((g[0] & 0xff00) === 0xff00) return false;                                                        // multicast
  return (g[0] & 0xe000) === 0x2000;                                                                   // global unicast 2000::/3
}
