// The Linear provider: GraphQL reads and writes for one team (LINEAR_TEAM_KEY), webhook verification,
// and the mapping between Linear's vocabulary and Harold's.
//
//   state type   backlog | unstarted -> pending, started -> in_progress, completed -> completed, canceled -> cancelled
//   priority     1 (urgent), 2 -> high; 3 -> medium; 4, 0 (none) -> low.  Harold high -> 2, medium -> 3, low -> 4.
//   project      via ProjectMap (linear_project in the map entry, else name / aliases, case-insensitive)

import { createHmac, timingSafeEqual } from "node:crypto";
import type { FetchLike } from "../identity.js";
import type { ProviderEntry, SyncProvider } from "./provider.js";
import type { ProjectMap } from "./projectmap.js";
import type { ExternalItem, HaroldFields, Priority, Status, VerifyResult, WebhookAction, WebhookEvent } from "./types.js";

export const LINEAR_GRAPHQL = "https://api.linear.app/graphql";
export const WEBHOOK_MAX_AGE_MS = 60_000;

export interface LinearSyncConfig { key: string; team: string; webhookSecret: string }

export function linearSyncFromEnv(): LinearSyncConfig | null {
  const key = (process.env.LINEAR_API_KEY || "").trim();
  const team = (process.env.LINEAR_TEAM_KEY || "").trim();
  if (!key || !team) return null;
  return { key, team, webhookSecret: (process.env.LINEAR_WEBHOOK_SECRET || "").trim() };
}

// ───────────── mapping ─────────────

export function statusFromLinear(type: string | null | undefined): Status {
  switch (type) {
    case "started": return "in_progress";
    case "completed": return "completed";
    case "canceled": return "cancelled";
    default: return "pending"; // backlog, unstarted, triage
  }
}

/** The Linear state type to move to for a Harold status (pending prefers unstarted, i.e. Todo). */
export function stateTypeFor(status: Status): string {
  return { pending: "unstarted", in_progress: "started", completed: "completed", cancelled: "canceled" }[status];
}

export function priorityFromLinear(p: number | null | undefined): Priority {
  if (p === 1 || p === 2) return "high";
  if (p === 3) return "medium";
  return "low";
}

export function priorityToLinear(p: Priority | null): number | null {
  return p === "high" ? 2 : p === "medium" ? 3 : p === "low" ? 4 : null;
}

export interface LinearIssue {
  id: string; identifier: string; url: string; title: string; description?: string | null;
  priority?: number | null; dueDate?: string | null; updatedAt: string;
  state?: { type: string; name?: string } | null; project?: { name: string } | null; team?: { key: string } | null;
  trashed?: boolean | null;
}

export const ISSUE_FIELDS = "id identifier url title description priority dueDate updatedAt trashed state { type name } project { name } team { key }";

export function issueToItem(i: LinearIssue, map: ProjectMap): ExternalItem {
  const providerProject = i.project?.name?.trim() || null;
  const project = map.fromProvider("linear", providerProject);
  return {
    externalId: i.id, externalKey: i.identifier, externalUrl: i.url, updatedAt: i.updatedAt,
    fields: {
      title: i.title, notes: i.description?.trim() ? i.description : null,
      status: statusFromLinear(i.state?.type), priority: priorityFromLinear(i.priority),
      due: i.dueDate ? i.dueDate.slice(0, 10) : null, project,
    },
    providerProject, projectUnmapped: !!providerProject && !project, teamKey: i.team?.key ?? null, removed: !!i.trashed,
  };
}

// ───────────── webhook ─────────────

/** HMAC-SHA256 of the raw body with the webhook secret, hex, compared in constant time. */
export function linearSignatureOk(rawBody: string, header: string | null, secret: string): boolean {
  if (!header || !secret) return false;
  const want = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  let got: Buffer;
  try { got = Buffer.from(header.trim(), "hex"); } catch { return false; }
  return got.length === want.length && timingSafeEqual(got, want);
}

export function verifyLinearWebhook(rawBody: string, header: string | null, secret: string, now: number): VerifyResult {
  if (!secret) return { ok: false, status: 503, reason: "LINEAR_WEBHOOK_SECRET is not set" };
  if (!linearSignatureOk(rawBody, header, secret)) return { ok: false, status: 401, reason: "bad signature" };
  let p: { action?: string; type?: string; data?: Record<string, unknown>; webhookTimestamp?: number; updatedFrom?: unknown };
  try { p = JSON.parse(rawBody); } catch { return { ok: false, status: 400, reason: "body is not JSON" }; }
  const t = Number(p.webhookTimestamp);
  if (!Number.isFinite(t) || Math.abs(now - t) > WEBHOOK_MAX_AGE_MS) return { ok: false, status: 401, reason: "stale or missing webhookTimestamp" };
  if (p.type !== "Issue" || !p.data || typeof p.data.id !== "string") return { ok: true, events: [] };
  const action = p.action as WebhookAction;
  if (!["create", "update", "remove"].includes(action)) return { ok: true, events: [] };
  const d = p.data as { id: string; updatedAt?: string; team?: { key?: string } | null };
  const ev: WebhookEvent = { action, externalId: d.id, updatedAt: d.updatedAt ?? null, teamKey: d.team?.key ?? null };
  return { ok: true, events: [ev] };
}

// ───────────── provider ─────────────

interface TeamInfo { id: string; states: { id: string; name: string; type: string; position?: number }[]; projects: { id: string; name: string }[] }

/** Linear in the provider registry: verification needs only the webhook secret. */
export function linearEntry(cfg: LinearSyncConfig, fetchImpl: FetchLike, now: () => number = Date.now): ProviderEntry {
  return {
    name: "linear", scope: cfg.team,
    verifyWebhook: (req, raw) => verifyLinearWebhook(raw, req.headers.get("linear-signature"), cfg.webhookSecret, now()),
    build: map => new LinearProvider(cfg, map, fetchImpl, now),
  };
}

export class LinearProvider implements SyncProvider {
  readonly name = "linear";
  readonly displayName = "Linear";
  readonly itemNoun = "issue";
  readonly callerChosenIds = true;
  private teamInfo?: Promise<TeamInfo>;
  constructor(private cfg: LinearSyncConfig, private map: ProjectMap, private fetchImpl: FetchLike, private now: () => number = Date.now) {}

  async verifyWebhook(req: Request, rawBody: string): Promise<VerifyResult> {
    return verifyLinearWebhook(rawBody, req.headers.get("linear-signature"), this.cfg.webhookSecret, this.now());
  }

  private async gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const r = await this.fetchImpl(LINEAR_GRAPHQL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: this.cfg.key },
      body: JSON.stringify({ query, variables }),
    });
    let j: { data?: T; errors?: { message: string }[] } = {};
    try { j = await r.json() as typeof j; } catch { /* not JSON */ }
    if (j.errors?.length) throw new Error(`Linear: ${j.errors.map(e => e.message).join("; ")} (in: ${query.replace(/\s+/g, " ").slice(0, 48)})`);
    if (!r.ok || !j.data) throw new Error(`Linear answered HTTP ${r.status}`);
    return j.data;
  }

  private team(): Promise<TeamInfo> {
    this.teamInfo ||= this.gql<{ teams: { nodes: { id: string; states: { nodes: TeamInfo["states"] }; projects: { nodes: TeamInfo["projects"] } }[] } }>(
      "query($team:String!){ teams(first: 1, filter:{key:{eq:$team}}){ nodes { id states(first: 50) { nodes { id name type position } } projects(first: 100) { nodes { id name } } } } }",
      { team: this.cfg.team },
    ).then(d => {
      const t = d.teams.nodes[0];
      if (!t) throw new Error(`Linear team with key "${this.cfg.team}" not found`);
      return { id: t.id, states: t.states.nodes, projects: t.projects.nodes };
    });
    return this.teamInfo;
  }

  private async paginate(filter: Record<string, unknown>): Promise<ExternalItem[]> {
    const out: ExternalItem[] = [];
    let after: string | null = null;
    for (let page = 0; page < 50; page++) {
      const d: { issues: { nodes: LinearIssue[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } = await this.gql(
        `query($filter: IssueFilter, $after: String){ issues(first: 100, after: $after, filter: $filter) { nodes { ${ISSUE_FIELDS} } pageInfo { hasNextPage endCursor } } }`,
        { filter, after });
      out.push(...d.issues.nodes.map(i => issueToItem(i, this.map)));
      if (!d.issues.pageInfo.hasNextPage || !d.issues.pageInfo.endCursor) break;
      after = d.issues.pageInfo.endCursor;
    }
    return out;
  }

  listChangedSince(cursor: string): Promise<ExternalItem[]> {
    return this.paginate({ team: { key: { eq: this.cfg.team } }, updatedAt: { gt: cursor } });
  }

  listForImport(completedWithinDays: number): Promise<ExternalItem[]> {
    const since = new Date(this.now() - completedWithinDays * 86_400_000).toISOString();
    return this.paginate({
      team: { key: { eq: this.cfg.team } },
      or: [{ state: { type: { nin: ["completed", "canceled"] } } }, { completedAt: { gt: since } }],
    });
  }

  async getOne(externalId: string): Promise<ExternalItem | null> {
    try {
      const d = await this.gql<{ issue: LinearIssue | null }>(`query($id: String!){ issue(id: $id) { ${ISSUE_FIELDS} } }`, { id: externalId });
      return d.issue ? issueToItem(d.issue, this.map) : null;
    } catch (e) {
      if (/not found|Entity not found/i.test(e instanceof Error ? e.message : "")) return null;
      throw e;
    }
  }

  private stateId(t: TeamInfo, status: Status): string | undefined {
    const type = stateTypeFor(status);
    const pick = t.states.filter(s => s.type === type).sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    if (status === "completed") return (pick.find(s => s.name.toLowerCase() === "done") || pick[0])?.id;
    if (status === "cancelled") return (pick.find(s => /^cancel+ed$/i.test(s.name)) || pick[0])?.id;
    if (status === "pending") return (pick.find(s => s.name.toLowerCase() === "todo") || pick[0])?.id;
    return pick[0]?.id;
  }

  private projectId(t: TeamInfo, haroldProject: string | null): string | undefined {
    const want = this.map.toProvider("linear", haroldProject)?.toLowerCase();
    if (!want) return undefined;
    return t.projects.find(p => p.name.toLowerCase() === want)?.id;
  }

  async create(fields: HaroldFields, externalId: string): Promise<ExternalItem> {
    const t = await this.team();
    const input: Record<string, unknown> = { id: externalId, teamId: t.id, title: fields.title };
    if (fields.notes) input.description = fields.notes;
    const pr = priorityToLinear(fields.priority); if (pr !== null) input.priority = pr;
    if (fields.due) input.dueDate = fields.due;
    const st = this.stateId(t, fields.status); if (st) input.stateId = st;
    const pj = this.projectId(t, fields.project); if (pj) input.projectId = pj;
    const d = await this.gql<{ issueCreate: { success: boolean; issue: LinearIssue | null } }>(
      `mutation($in: IssueCreateInput!){ issueCreate(input: $in){ success issue { ${ISSUE_FIELDS} } } }`, { in: input });
    if (!d.issueCreate.success || !d.issueCreate.issue) throw new Error("Linear issueCreate returned success: false");
    return issueToItem(d.issueCreate.issue, this.map);
  }

  async update(current: ExternalItem, fields: HaroldFields): Promise<{ item: ExternalItem; changed: string[] }> {
    const c = current.fields;
    const input: Record<string, unknown> = {};
    const changed: string[] = [];
    if (fields.title !== c.title) { input.title = fields.title; changed.push("title"); }
    if ((fields.notes || null) !== (c.notes || null)) { input.description = fields.notes || ""; changed.push("notes"); }
    if (fields.due !== c.due) { input.dueDate = fields.due; changed.push("due"); }
    if (fields.priority !== null && fields.priority !== c.priority) { input.priority = priorityToLinear(fields.priority); changed.push("priority"); }
    const needTeam = fields.status !== c.status || projectDiffers(current, fields.project);
    if (needTeam) {
      const t = await this.team();
      if (fields.status !== c.status) { const st = this.stateId(t, fields.status); if (st) { input.stateId = st; changed.push("status"); } }
      if (projectDiffers(current, fields.project)) {
        if (fields.project === null) { input.projectId = null; changed.push("project"); }
        else { const pj = this.projectId(t, fields.project); if (pj) { input.projectId = pj; changed.push("project"); } }
      }
    }
    if (!changed.length) return { item: current, changed };
    const d = await this.gql<{ issueUpdate: { success: boolean; issue: LinearIssue | null } }>(
      `mutation($id: String!, $in: IssueUpdateInput!){ issueUpdate(id: $id, input: $in){ success issue { ${ISSUE_FIELDS} } } }`,
      { id: current.externalId, in: input });
    if (!d.issueUpdate.success || !d.issueUpdate.issue) throw new Error(`Linear issueUpdate ${current.externalKey} returned success: false`);
    return { item: issueToItem(d.issueUpdate.issue, this.map), changed };
  }
}

/** Project differs, except that a Linear project unknown to Harold is never treated as "Harold has none". */
export function projectDiffers(item: ExternalItem, haroldProject: string | null): boolean {
  if (haroldProject === null && item.projectUnmapped) return false;
  return (haroldProject || "").toLowerCase() !== (item.fields.project || "").toLowerCase();
}
