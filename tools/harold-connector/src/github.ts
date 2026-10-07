// The Harold repository (HAROLD_REPO), through the GitHub REST API, as the signed-in user.

import { commitAuthor } from "./config.js";
import { GITHUB_API, UA, type FetchLike } from "./identity.js";
import { BINARY_EXT, isProbablyBinary, secretScan } from "./text.js";
import { sha256 } from "./crypto.js";

export class GithubError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export type RepoFile =
  | { kind: "file"; path: string; sha: string; size: number; text: string }
  | { kind: "binary"; path: string; sha: string; size: number }
  | { kind: "dir"; path: string; entries: DirEntry[] };

export interface DirEntry { name: string; path: string; type: string; size: number }

const encPath = (p: string) => p.split("/").map(encodeURIComponent).join("/");

/** Normalise a repo-relative path and refuse anything that tries to climb out or is absolute. */
export function cleanPath(p: string): string {
  const s = String(p || "").trim().replace(/\\/g, "/").replace(/^\.?\/+/, "").replace(/\/+$/, "");
  if (s.split("/").some(seg => seg === ".." || seg === ".")) throw new GithubError(400, "Path may not contain . or .. segments");
  if (/^[A-Za-z]:/.test(s) || s.startsWith("~")) throw new GithubError(400, "Use a path relative to the Harold repo root, e.g. vault/people/Jane Doe.md");
  return s;
}

const treeCache = new Map<string, { at: number; paths: { path: string; size: number }[] }>();

export class HaroldRepo {
  constructor(private token: string, public repo: string, public branch: string, private fetchImpl: FetchLike = fetch) {}

  private async api(method: string, url: string, body?: unknown, accept = "application/vnd.github+json"): Promise<Response> {
    const r = await this.fetchImpl(url.startsWith("http") ? url : `${GITHUB_API}${url}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`, Accept: accept, "User-Agent": UA, "X-GitHub-Api-Version": "2022-11-28",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return r;
  }

  private async fail(r: Response, what: string): Promise<never> {
    let msg = "";
    try { msg = ((await r.json()) as { message?: string }).message || ""; } catch { /* ignore */ }
    throw new GithubError(r.status, `${what}: GitHub ${r.status}${msg ? ` ${msg}` : ""}`);
  }

  async get(path: string): Promise<RepoFile | null> {
    const p = cleanPath(path);
    const r = await this.api("GET", `/repos/${this.repo}/contents/${encPath(p)}?ref=${encodeURIComponent(this.branch)}`);
    if (r.status === 404) return null;
    if (!r.ok) await this.fail(r, `read ${p}`);
    const j = (await r.json()) as unknown;
    if (Array.isArray(j)) {
      return { kind: "dir", path: p, entries: j.map((e: Record<string, unknown>) => ({ name: String(e.name), path: String(e.path), type: String(e.type), size: Number(e.size) || 0 })) };
    }
    const f = j as { type: string; sha: string; size: number; content?: string; encoding?: string; path: string };
    if (f.type !== "file") return { kind: "binary", path: p, sha: f.sha, size: f.size }; // symlink/submodule: not readable text
    let buf: Buffer;
    if (f.encoding === "base64" && f.content) buf = Buffer.from(f.content, "base64");
    else if (f.size === 0) buf = Buffer.alloc(0);
    else {
      // Files over 1 MB come back without content; fetch the raw bytes instead.
      const raw = await this.api("GET", `/repos/${this.repo}/contents/${encPath(p)}?ref=${encodeURIComponent(this.branch)}`, undefined, "application/vnd.github.raw+json");
      if (!raw.ok) await this.fail(raw, `read ${p}`);
      buf = Buffer.from(await raw.arrayBuffer());
    }
    if (BINARY_EXT.test(p) || isProbablyBinary(buf)) return { kind: "binary", path: p, sha: f.sha, size: f.size };
    return { kind: "file", path: p, sha: f.sha, size: f.size, text: buf.toString("utf8") };
  }

  async getText(path: string): Promise<{ text: string; sha: string } | null> {
    const f = await this.get(path);
    if (!f) return null;
    if (f.kind !== "file") throw new GithubError(400, `${path} is not a text file`);
    return { text: f.text, sha: f.sha };
  }

  async tree(): Promise<{ path: string; size: number }[]> {
    const key = `${this.repo}@${this.branch}#${sha256(this.token).slice(0, 12)}`;
    const hit = treeCache.get(key);
    if (hit && Date.now() - hit.at < 60_000) return hit.paths;
    const r = await this.api("GET", `/repos/${this.repo}/git/trees/${encodeURIComponent(this.branch)}?recursive=1`);
    if (!r.ok) await this.fail(r, "list repository tree");
    const j = (await r.json()) as { tree: { path: string; type: string; size?: number }[] };
    const paths = j.tree.filter(t => t.type === "blob").map(t => ({ path: t.path, size: t.size || 0 }));
    treeCache.set(key, { at: Date.now(), paths });
    return paths;
  }

  async searchCode(terms: string, perPage = 20): Promise<{ path: string; fragments: string[] }[]> {
    const q = `${terms} repo:${this.repo}`;
    const r = await this.api("GET", `/search/code?q=${encodeURIComponent(q)}&per_page=${perPage}`, undefined, "application/vnd.github.text-match+json");
    if (!r.ok) await this.fail(r, "code search");
    const j = (await r.json()) as { items?: { path: string; text_matches?: { fragment: string }[] }[] };
    return (j.items || []).map(i => ({ path: i.path, fragments: (i.text_matches || []).map(m => m.fragment) }));
  }

  async put(path: string, text: string, message: string, sha?: string): Promise<{ commit: string; sha: string }> {
    const p = cleanPath(path);
    const author = commitAuthor();
    const r = await this.api("PUT", `/repos/${this.repo}/contents/${encPath(p)}`, {
      message, content: Buffer.from(text, "utf8").toString("base64"), branch: this.branch,
      author, committer: author, ...(sha ? { sha } : {}),
    });
    if (!r.ok) await this.fail(r, `write ${p}`);
    const j = (await r.json()) as { commit: { sha: string }; content: { sha: string } };
    treeCache.clear();
    return { commit: j.commit.sha, sha: j.content.sha };
  }

  /**
   * Read-modify-write one file with the file's current sha. On a conflict (409/422: someone else
   * committed first) it re-reads and re-applies `mutate`, up to 3 retries. Refuses to commit
   * anything that looks like a secret.
   */
  async commit(path: string, mutate: (current: { text: string; sha: string } | null) => { text: string } | { refuse: string }, message: string):
    Promise<{ ok: true; commit: string; attempts: number; text: string } | { ok: false; reason: string }> {
    for (let attempt = 1; attempt <= 4; attempt++) {
      const cur = await this.getText(path);
      const out = mutate(cur);
      if ("refuse" in out) return { ok: false, reason: out.refuse };
      const hit = secretScan(out.text);
      if (hit) return { ok: false, reason: `Refused: the content looks like it contains a secret (pattern ${hit}). Secrets never go into the knowledge base; remove it and try again.` };
      try {
        const res = await this.put(path, out.text, message, cur?.sha);
        return { ok: true, commit: res.commit, attempts: attempt, text: out.text };
      } catch (e) {
        if (e instanceof GithubError && (e.status === 409 || e.status === 422) && attempt < 4) continue;
        throw e;
      }
    }
    return { ok: false, reason: "Gave up after 3 retries: the file kept changing underneath" };
  }

  /** The newest commit on the branch that touches `path` (a file or a folder), or null when there is none. */
  async lastCommit(path: string): Promise<{ date: string; message: string } | null> {
    const p = cleanPath(path);
    const r = await this.api("GET", `/repos/${this.repo}/commits?sha=${encodeURIComponent(this.branch)}&path=${encodeURIComponent(p)}&per_page=1`);
    if (r.status === 404 || r.status === 409) return null; // 409: an empty repository
    if (!r.ok) await this.fail(r, `list commits for ${p}`);
    const j = (await r.json()) as { commit?: { committer?: { date?: string }; message?: string } }[];
    const c = Array.isArray(j) ? j[0] : undefined;
    const date = c?.commit?.committer?.date;
    return date ? { date, message: c?.commit?.message || "" } : null;
  }

  // ── used by the write tests (throwaway branches only) ──
  async branchSha(branch: string): Promise<string> {
    const r = await this.api("GET", `/repos/${this.repo}/git/ref/heads/${encodeURIComponent(branch)}`);
    if (!r.ok) await this.fail(r, `read branch ${branch}`);
    return ((await r.json()) as { object: { sha: string } }).object.sha;
  }
  async createBranch(branch: string, fromSha: string): Promise<void> {
    const r = await this.api("POST", `/repos/${this.repo}/git/refs`, { ref: `refs/heads/${branch}`, sha: fromSha });
    if (!r.ok) await this.fail(r, `create branch ${branch}`);
  }
  async deleteBranch(branch: string): Promise<void> {
    if (branch === "main" || branch === "master") throw new Error("refusing to delete a main branch");
    const r = await this.api("DELETE", `/repos/${this.repo}/git/refs/heads/${encodeURIComponent(branch)}`);
    if (!r.ok && r.status !== 404 && r.status !== 422) await this.fail(r, `delete branch ${branch}`);
  }
  async commits(branch: string, since?: string): Promise<{ sha: string; message: string; author: string; email: string; files?: string[] }[]> {
    const r = await this.api("GET", `/repos/${this.repo}/commits?sha=${encodeURIComponent(branch)}&per_page=20${since ? `&since=${since}` : ""}`);
    if (!r.ok) await this.fail(r, "list commits");
    const j = (await r.json()) as { sha: string; commit: { message: string; author: { name: string; email: string } } }[];
    return j.map(c => ({ sha: c.sha, message: c.commit.message, author: c.commit.author.name, email: c.commit.author.email }));
  }
}
