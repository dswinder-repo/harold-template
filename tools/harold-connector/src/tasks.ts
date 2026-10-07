// The owner's task manager, for task_create and task_list: Linear's GraphQL API, the same calls
// bin/harold-linear makes (team looked up by its key, project by name, due date, priority, description).
// Configured with LINEAR_API_KEY and LINEAR_TEAM_KEY in the connector's environment. Without them both
// tools say so plainly and point at crm_task, so a commitment is never dropped silently.

import type { FetchLike } from "./identity.js";
import { secretScan } from "./text.js";

export interface TaskResult { text: string; isError?: boolean }
export interface LinearConfig { key: string; team: string }

export const LINEAR_URL = "https://api.linear.app/graphql";

export function linearFromEnv(): LinearConfig | null {
  const key = (process.env.LINEAR_API_KEY || "").trim();
  const team = (process.env.LINEAR_TEAM_KEY || "").trim();
  if (!key || !team) return null;
  return { key, team };
}

export const NOT_CONFIGURED: TaskResult = {
  text: "No task manager is configured on this connector (LINEAR_API_KEY and LINEAR_TEAM_KEY are not set), so no task was created or read. "
    + "For a follow-up tied to a contact, use crm_task instead. For anything else, list it in the note's Action items with \"(no task: no task manager configured)\" "
    + "so a workspace session can create it.",
  isError: true,
};

export const PRIORITIES = ["urgent", "high", "medium", "low"] as const;
export type Priority = typeof PRIORITIES[number];
const PRI_NUM: Record<Priority, number> = { urgent: 1, high: 2, medium: 3, low: 4 };
const PRI_NAME: Record<number, string> = { 0: "no priority", 1: "urgent", 2: "high", 3: "medium", 4: "low" };

const err = (text: string): TaskResult => ({ text, isError: true });

interface Issue {
  identifier: string; title: string; url: string; dueDate?: string | null; priority?: number;
  state?: { name: string; type: string } | null; project?: { name: string } | null;
}
const ISSUE_FIELDS = "identifier title url dueDate priority state { name type } project { name }";

async function gql<T>(fetchImpl: FetchLike, cfg: LinearConfig, query: string, variables: Record<string, unknown>): Promise<T> {
  const r = await fetchImpl(LINEAR_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: cfg.key },
    body: JSON.stringify({ query, variables }),
  });
  let j: { data?: T; errors?: { message: string }[] } = {};
  try { j = await r.json() as typeof j; } catch { /* not JSON */ }
  if (j.errors?.length) throw new Error(`Linear: ${j.errors.map(e => e.message).join("; ")}`);
  if (!r.ok || !j.data) throw new Error(`Linear answered HTTP ${r.status}${r.status === 401 || r.status === 400 ? " (check LINEAR_API_KEY)" : ""}`);
  return j.data;
}

async function team(fetchImpl: FetchLike, cfg: LinearConfig) {
  const d = await gql<{ teams: { nodes: { id: string; name: string; projects: { nodes: { id: string; name: string; state: string }[] } }[] } }>(
    fetchImpl, cfg,
    "query($team:String!){ teams(filter:{key:{eq:$team}}){ nodes { id name projects(first: 100) { nodes { id name state } } } } }",
    { team: cfg.team });
  const t = d.teams.nodes[0];
  if (!t) throw new Error(`Linear team with key "${cfg.team}" not found (LINEAR_TEAM_KEY is the issue prefix, e.g. ENG for ENG-123)`);
  return t;
}

async function openIssues(fetchImpl: FetchLike, cfg: LinearConfig, opts: { text?: string; title?: string; limit: number }): Promise<Issue[]> {
  const filter: Record<string, unknown> = { team: { key: { eq: cfg.team } }, state: { type: { nin: ["completed", "canceled"] } } };
  if (opts.title) filter.title = { eqIgnoreCase: opts.title };
  else if (opts.text) filter.or = [{ title: { containsIgnoreCase: opts.text } }, { description: { containsIgnoreCase: opts.text } }];
  const d = await gql<{ issues: { nodes: Issue[] } }>(fetchImpl, cfg,
    `query($filter: IssueFilter, $first: Int){ issues(first: $first, filter: $filter, orderBy: updatedAt) { nodes { ${ISSUE_FIELDS} } } }`,
    { filter, first: opts.limit });
  return d.issues.nodes;
}

const line = (i: Issue) => `- ${i.identifier} · ${i.title} · ${i.project?.name || "no project"} · ${i.state?.name || "?"} · due ${i.dueDate || "none"} · ${PRI_NAME[i.priority ?? 0] || "no priority"}\n  ${i.url}`;

export interface ListArgs { query?: string; limit?: number }

export async function listTasks(fetchImpl: FetchLike, cfg: LinearConfig | null, a: ListArgs): Promise<TaskResult> {
  if (!cfg) return NOT_CONFIGURED;
  const issues = await openIssues(fetchImpl, cfg, { text: a.query?.trim() || undefined, limit: a.limit ?? 50 });
  const what = a.query ? ` matching "${a.query}"` : "";
  if (!issues.length) return { text: `No open tasks in team ${cfg.team}${what}.` };
  return { text: `Open tasks in team ${cfg.team}${what} (${issues.length}, most recently updated first):\n${issues.map(line).join("\n")}` };
}

export interface CreateArgs { title: string; description?: string; due_date?: string; project?: string; priority?: Priority }

export async function createTask(fetchImpl: FetchLike, cfg: LinearConfig | null, a: CreateArgs): Promise<TaskResult> {
  if (!cfg) return NOT_CONFIGURED;
  const title = a.title.trim();
  if (!title) return err("title is required");
  const hit = secretScan(`${title}\n${a.description || ""}`);
  if (hit) return err(`Refused: the task looks like it contains a secret (pattern ${hit}). Secrets never go into a task; remove it and try again.`);
  if (a.due_date && !/^\d{4}-\d{2}-\d{2}$/.test(a.due_date)) return err(`due_date must be YYYY-MM-DD, got "${a.due_date}"`);

  // The same title already open: return it instead of creating a duplicate.
  const same = await openIssues(fetchImpl, cfg, { title, limit: 5 });
  if (same.length) return { text: `Already open, not created again: ${same[0].identifier} ${same[0].title} (due ${same[0].dueDate || "none"})\n${same[0].url}` };

  const t = await team(fetchImpl, cfg);
  let project: { id: string; name: string } | undefined;
  if (a.project?.trim()) {
    const want = a.project.trim().toLowerCase();
    const ps = t.projects.nodes;
    project = ps.find(p => p.name.toLowerCase() === want) || ps.find(p => p.name.toLowerCase().includes(want)) || ps.find(p => want.includes(p.name.toLowerCase()));
    if (!project) return err(`Project "${a.project}" not found in team ${cfg.team}. Projects: ${ps.map(p => p.name).join(", ") || "(none)"}. Pass one of these, or leave project out.`);
  }
  const input: Record<string, unknown> = { teamId: t.id, title, priority: PRI_NUM[a.priority || "medium"] };
  if (project) input.projectId = project.id;
  if (a.due_date) input.dueDate = a.due_date;
  if (a.description?.trim()) input.description = a.description.trim();
  const d = await gql<{ issueCreate: { success: boolean; issue: { identifier: string; url: string } | null } }>(fetchImpl, cfg,
    "mutation($in: IssueCreateInput!){ issueCreate(input: $in){ success issue { identifier url } } }", { in: input });
  if (!d.issueCreate.success || !d.issueCreate.issue) return err("Linear did not create the task (issueCreate returned success: false)");
  const i = d.issueCreate.issue;
  return { text: `Created ${i.identifier}${project ? ` in ${project.name}` : ""}, due ${a.due_date || "none"}: ${title}\n${i.url}${a.due_date ? "" : "\nNo due date: add one if the owner gave or implied one."}` };
}
