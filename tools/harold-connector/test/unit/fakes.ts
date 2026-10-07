// Test doubles: an in-memory GitHub (contents, tree, search, /user, OAuth) and an in-memory Supabase.
import { createHash } from "node:crypto";

type Json = Record<string, unknown>;
const res = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export class FakeGithub {
  files = new Map<string, string>();          // path -> content
  puts: { path: string; message: string; author: Json; branch: string }[] = [];
  users = new Map<string, { login: string; id: number }>();  // token -> user
  oauthCodes = new Map<string, string>();     // github code -> token
  revoked: string[] = [];
  conflictsToInject = 0;                      // next N PUTs answer 409 after sneaking in a concurrent write
  concurrentWrite?: (path: string, current: string | undefined) => string;
  calls: string[] = [];
  searchHits: string[] = [];                  // paths /search/code answers with (GitHub code search)

  sha(s: string) { return createHash("sha1").update(s).digest("hex"); }

  fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method || "GET").toUpperCase();
    this.calls.push(`${method} ${url.pathname}`);
    const auth = new Headers(init?.headers).get("authorization") || "";
    const tok = auth.replace(/^Bearer /i, "");

    if (url.host === "github.com" && url.pathname === "/login/oauth/access_token") {
      const body = JSON.parse(String(init?.body || "{}"));
      const t = this.oauthCodes.get(body.code);
      return res(200, t ? { access_token: t, token_type: "bearer", scope: "repo" } : { error: "bad_verification_code" });
    }
    if (url.pathname === "/user") { const u = this.users.get(tok); return u ? res(200, u) : res(401, { message: "Bad credentials" }); }
    if (url.pathname.match(/^\/applications\/[^/]+\/grant$/) && method === "DELETE") { this.revoked.push(JSON.parse(String(init?.body)).access_token); return res(204); }
    if (!this.users.has(tok)) return res(401, { message: "Bad credentials" });

    const m = url.pathname.match(/^\/repos\/[^/]+\/[^/]+\/contents\/?(.*)$/);
    if (m) {
      const path = decodeURIComponent(m[1]);
      if (method === "GET") {
        if (this.files.has(path)) { const t = this.files.get(path)!; return res(200, { type: "file", path, sha: this.sha(t), size: Buffer.byteLength(t), encoding: "base64", content: Buffer.from(t).toString("base64") }); }
        const prefix = path ? path + "/" : "";
        const kids = new Map<string, { type: string; size: number }>();
        for (const [p, t] of this.files) if (p.startsWith(prefix)) { const rest = p.slice(prefix.length); const [head, ...more] = rest.split("/"); kids.set(head, more.length ? { type: "dir", size: 0 } : { type: "file", size: t.length }); }
        if (!kids.size) return res(404, { message: "Not Found" });
        return res(200, [...kids].map(([name, v]) => ({ name, path: prefix + name, type: v.type, size: v.size })));
      }
      if (method === "PUT") {
        const body = JSON.parse(String(init?.body));
        if (this.conflictsToInject > 0) {
          this.conflictsToInject--;
          if (this.concurrentWrite) this.files.set(path, this.concurrentWrite(path, this.files.get(path)));
          return res(409, { message: "is at X but expected Y" });
        }
        const cur = this.files.get(path);
        if (cur !== undefined && body.sha !== this.sha(cur)) return res(409, { message: "sha mismatch" });
        if (cur === undefined && body.sha) return res(422, { message: "sha given for new file" });
        if (cur !== undefined && !body.sha) return res(422, { message: "\"sha\" wasn't supplied." });
        const text = Buffer.from(body.content, "base64").toString("utf8");
        this.files.set(path, text);
        this.puts.push({ path, message: body.message, author: body.author, branch: body.branch });
        return res(200, { content: { sha: this.sha(text) }, commit: { sha: this.sha(body.message + text + this.puts.length) } });
      }
    }
    if (url.pathname.match(/\/git\/trees\//)) return res(200, { tree: [...this.files.keys()].map(p => ({ path: p, type: "blob", size: this.files.get(p)!.length })) });
    if (url.pathname === "/search/code") return res(200, { items: this.searchHits.map(path => ({ path, text_matches: [] })) });
    return res(404, { message: `fake: no route ${method} ${url.pathname}` });
  };
}

// ───────────── Supabase ─────────────

type Row = Record<string, unknown>;
type Filter = (r: Row) => boolean;
function like(pattern: string): RegExp {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "\\" && i + 1 < pattern.length) { re += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); continue; }
    re += ch === "%" ? ".*" : ch === "_" ? "." : ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`, "i");
}

export class FakeSupabase {
  tables: Record<string, Row[]> = { contacts: [], contact_categories: [], contact_pipelines: [], pipeline_stages: [], stage_changes: [], interactions: [], tasks: [] };
  inserts: { table: string; rows: Row[] }[] = [];
  updates: { table: string; values: Row }[] = [];
  private n = 0;
  id() { return `00000000-0000-0000-0000-${String(++this.n).padStart(12, "0")}`; }
  from(table: string) { return new Q(this, table); }
}

class Q implements PromiseLike<{ data: unknown; error: null | { message: string } }> {
  private filters: Filter[] = [];
  private op: "select" | "insert" | "update" | "upsert" = "select";
  private payload: Row[] = [];
  private values: Row = {};
  private one: "single" | "maybe" | null = null;
  private lim = Infinity;
  private off = 0;
  private embeds: { table: string; cols: string[] }[] = [];
  private selected = false;
  constructor(private db: FakeSupabase, private table: string) {}
  select(cols?: string) {
    this.selected = true;
    // One-to-many embeds from contacts, as PostgREST does: "interactions ( occurred_at, type )".
    for (const m of (cols || "").matchAll(/(\w+)\s*\(([^)]*)\)/g)) this.embeds.push({ table: m[1], cols: m[2].split(",").map(c => c.trim()).filter(Boolean) });
    return this;
  }
  insert(r: Row | Row[]) { this.op = "insert"; this.payload = Array.isArray(r) ? r : [r]; return this; }
  upsert(r: Row | Row[]) { this.op = "upsert"; this.payload = Array.isArray(r) ? r : [r]; return this; }
  update(v: Row) { this.op = "update"; this.values = v; return this; }
  eq(k: string, v: unknown) { this.filters.push(r => r[k] === v); return this; }
  neq(k: string, v: unknown) { this.filters.push(r => r[k] !== v); return this; }
  in(k: string, vs: unknown[]) { this.filters.push(r => vs.includes(r[k])); return this; }
  is(k: string, v: unknown) { this.filters.push(r => (r[k] ?? null) === v); return this; }
  not(k: string, _op: string, v: unknown) { this.filters.push(r => (r[k] ?? null) !== v); return this; }
  ilike(k: string, p: string) { const re = like(p); this.filters.push(r => re.test(String(r[k] ?? ""))); return this; }
  or(_s: string) { return this; }
  order() { return this; }
  limit(n: number) { this.lim = n; return this; }
  range(from: number, to: number) { this.off = from; this.lim = to - from + 1; return this; }
  single() { this.one = "single"; return this; }
  maybeSingle() { this.one = "maybe"; return this; }
  then<A, B>(ok?: ((v: { data: unknown; error: null | { message: string } }) => A | PromiseLike<A>) | null, bad?: ((e: unknown) => B | PromiseLike<B>) | null) {
    return Promise.resolve(this.run()).then(ok, bad);
  }
  private run(): { data: unknown; error: null | { message: string } } {
    const t = (this.db.tables[this.table] ||= []);
    let rows: Row[];
    if (this.op === "insert" || this.op === "upsert") {
      rows = this.payload.map(p => ({ id: this.db.id(), created_at: new Date().toISOString(), ...p }));
      t.push(...rows);
      this.db.inserts.push({ table: this.table, rows });
    } else if (this.op === "update") {
      rows = t.filter(r => this.filters.every(f => f(r)));
      rows.forEach(r => Object.assign(r, this.values));
      this.db.updates.push({ table: this.table, values: this.values });
    } else {
      rows = t.filter(r => this.filters.every(f => f(r))).slice(this.off, this.off + this.lim);
      if (this.table === "contacts" && this.embeds.length) {
        rows = rows.map(r => {
          const e: Row = { ...r };
          for (const em of this.embeds) e[em.table] = (this.db.tables[em.table] || []).filter(x => x.contact_id === r.id).map(x => Object.fromEntries(em.cols.map(c => [c, x[c] ?? null])));
          return e;
        });
      }
    }
    if (this.one === "single") return rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { message: `expected one row, got ${rows.length}` } };
    if (this.one === "maybe") return { data: rows[0] ?? null, error: null };
    void this.selected;
    return { data: rows, error: null };
  }
}
