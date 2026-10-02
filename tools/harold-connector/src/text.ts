// Pure text helpers: local dates, frontmatter, markdown appends, secret scanning, slugs.
// Everything here is deterministic and unit-tested.

import { tz as configuredTz } from "./config.js";

// ───────────── dates (the owner's time zone: HAROLD_TZ, UTC when unset) ─────────────

export function localParts(d = new Date(), zone = configuredTz()) {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "long", hour: "2-digit", minute: "2-digit", hour12: false });
  const p = Object.fromEntries(fmt.formatToParts(d).map(x => [x.type, x.value]));
  const hour = p.hour === "24" ? "00" : p.hour;
  return { iso: `${p.year}-${p.month}-${p.day}`, weekday: p.weekday as string, hm: `${hour}:${p.minute}` };
}

// ───────────── frontmatter ─────────────

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/;

/** Same reading as bin/harold frontmatter(): top-level `key: value` lines only. */
export function frontmatter(text: string): Record<string, string> {
  const m = text.match(FM_RE);
  if (!m) return {};
  const fm: Record<string, string> = {};
  m[1].split("\n").forEach(l => {
    const k = l.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (k) fm[k[1]] = k[2].trim().replace(/^["']|["']$/g, "");
  });
  return fm;
}

const SAFE_KEY = /^[A-Za-z_][\w-]{0,40}$/;

function yamlScalar(v: string): string {
  if (v === "" || /^[\w .,/@()+-]*$/.test(v) && !/^[-?:,\[\]{}#&*!|>'"%@`]/.test(v) && !/:\s/.test(v) && !/\s#/.test(v)) return v;
  return JSON.stringify(v);
}

/**
 * Update simple top-level scalar keys. Keys that exist are rewritten in place (only when their
 * current value is a scalar on that one line); new keys are appended at the end of the block.
 * A file without frontmatter gets one. Nested/list values are refused, not mangled.
 */
export function updateFrontmatter(text: string, updates: Record<string, string>): { text: string; error?: string } {
  for (const k of Object.keys(updates)) {
    if (!SAFE_KEY.test(k)) return { text, error: `Unsupported frontmatter key "${k}"` };
    const v = updates[k];
    if (typeof v !== "string" || /[\r\n]/.test(v) || v.length > 500) return { text, error: `Frontmatter value for "${k}" must be a single line of text` };
  }
  const m = text.match(FM_RE);
  if (!m) {
    const block = Object.entries(updates).map(([k, v]) => `${k}: ${yamlScalar(v)}`).join("\n");
    return { text: `---\n${block}\n---\n${text.startsWith("\n") ? "" : "\n"}${text}` };
  }
  const lines = m[1].split("\n");
  for (const [k, v] of Object.entries(updates)) {
    const i = lines.findIndex(l => new RegExp(`^${k}:`).test(l));
    if (i === -1) { lines.push(`${k}: ${yamlScalar(v)}`); continue; }
    const cur = lines[i].slice(k.length + 1).trim();
    if (cur === "" || /^[|>\[{]/.test(cur)) {
      return { text, error: `Frontmatter key "${k}" holds a nested or multi-line value; edit it in a code session` };
    }
    lines[i] = `${k}: ${yamlScalar(v)}`;
  }
  const body = text.slice(m[0].length);
  const eol = m[2] || "\n";
  return { text: `---\n${lines.join("\n")}\n---${eol}${body}` };
}

// ───────────── markdown append ─────────────

/**
 * Append text at the end of the section under `heading` (any level, matched case-insensitively on
 * its title), or at the end of the file. If the heading is named but absent, it is created at the end.
 */
export function appendUnderHeading(text: string, addition: string, heading?: string): string {
  const add = addition.replace(/\s+$/, "");
  const base = text.replace(/\s+$/, "");
  if (!heading) return `${base}\n\n${add}\n`;
  const title = heading.replace(/^#+\s*/, "").trim().toLowerCase();
  const lines = base.split("\n");
  let inFence = false;
  let start = -1, level = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) inFence = !inFence;
    if (inFence) continue;
    const h = lines[i].match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (h && h[2].trim().toLowerCase() === title) { start = i; level = h[1].length; break; }
  }
  if (start === -1) {
    const lvl = heading.match(/^(#+)\s/)?.[1] || "##";
    return `${base}\n\n${lvl} ${heading.replace(/^#+\s*/, "").trim()}\n\n${add}\n`;
  }
  let end = lines.length;
  inFence = false;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) inFence = !inFence;
    if (inFence) continue;
    const h = lines[i].match(/^(#{1,6})\s/);
    if (h && h[1].length <= level) { end = i; break; }
  }
  let insertAt = end;
  while (insertAt > start + 1 && lines[insertAt - 1].trim() === "") insertAt--;
  const before = lines.slice(0, insertAt);
  const after = lines.slice(end);
  const out = [...before, ...(insertAt === start + 1 ? [""] : []), add, ...(after.length ? ["", ...after] : [])];
  return out.join("\n") + "\n";
}

// ───────────── secrets ─────────────

/** bin/harold SECRET_PATTERNS, verbatim, plus plain password assignments. */
export const SECRET_PATTERNS: RegExp[] = [
  /sb_secret_[A-Za-z0-9_-]{10,}/, /sk-or-v1-[a-f0-9]{20,}/, /sk-ant-[A-Za-z0-9_-]{20,}/,
  /eyJhbGciOi[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, /ghp_[A-Za-z0-9]{30,}/, /github_pat_[A-Za-z0-9_]{30,}/,
  /AKIA[0-9A-Z]{16}/, /-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/, /xox[bp]-[A-Za-z0-9-]{20,}/, /lin_api_[A-Za-z0-9]{20,}/,
  /OPENROUTER_API_KEY\s*[=:]\s*["']?sk-/,
  // Added for the connector: GitHub OAuth/app tokens and plain passwords written into a note.
  /gh[ousr]_[A-Za-z0-9]{30,}/,
  /\b(?:password|passwd|passcode|pwd)\b\s*(?:is|was|=|:)\s*["'`]?[^\s"'`]{4,}/i,
];

export function secretScan(content: string): string | null {
  for (const re of SECRET_PATTERNS) if (re.test(content)) return re.source.slice(0, 40);
  return null;
}

// ───────────── misc ─────────────

export function slugify(s: string, max = 60): string {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max).replace(/-+$/g, "") || "note";
}

export function truncate(s: string, max: number, note = "truncated"): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n\n[… ${note}: showing ${max.toLocaleString("en-US")} of ${s.length.toLocaleString("en-US")} characters]`;
}

export function isProbablyBinary(buf: Uint8Array): boolean {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

export const BINARY_EXT = /\.(png|jpe?g|gif|webp|heic|ico|pdf|zip|gz|tgz|dmg|mp[34]|mov|webm|wav|m4a|xlsx?|docx?|pptx?|key|numbers|pages|sqlite|db|woff2?|ttf|otf|eot|psd|ai|sketch|fig|bin|exe|so|dylib|class|jar|pyc)$/i;
