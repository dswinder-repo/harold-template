// Shared shapes for the two-way task sync. Every column name of the Harold tables is named here and
// only here (see COLS), so a schema rename is a one-line change.

export const STATUSES = ["pending", "in_progress", "completed", "cancelled"] as const;
export type Status = typeof STATUSES[number];
export const PRIORITIES = ["high", "medium", "low"] as const;
export type Priority = typeof PRIORITIES[number];
export const OPEN_STATUSES: readonly Status[] = ["pending", "in_progress"];

/** The fields that travel between Harold and a provider. */
export interface HaroldFields {
  title: string;
  notes: string | null;
  status: Status;
  priority: Priority | null;
  /** YYYY-MM-DD, or null. */
  due: string | null;
  /** A project name from harold/projects.md, or null. */
  project: string | null;
}

/** Column names in public.tasks (migration 2026-11-18-task-list.sql). description is NOT NULL default '' (Harold's
 *  `notes` here, '' <-> null); due_date is timestamptz holding a calendar day as UTC midnight. */
export const COLS = {
  id: "id", ref: "ref", title: "title", notes: "description", status: "status", priority: "priority",
  due: "due_date", project: "project", source: "source", changedBy: "changed_by", updatedAt: "updated_at",
} as const;

export interface TaskRow extends HaroldFields {
  id: string;
  ref: string | null;
  source: string | null;
  changed_by: string | null;
  updated_at: string;
}

export interface LinkRow {
  task_id: string;
  provider: string;
  external_id: string;
  external_key: string | null;
  external_url: string | null;
  external_updated_at: string | null;
  /** null while a push that created the external item is still in flight. */
  synced_at: string | null;
  /** The mapped field values both sides last agreed on; null until the first sync that records them. */
  synced_fields?: HaroldFields | null;
}

export const FIELD_KEYS = ["title", "notes", "status", "priority", "due", "project"] as const;
export type FieldKey = typeof FIELD_KEYS[number];

export type LogKind = "conflict" | "error" | "import" | "push" | "pull" | "skip";

/** One item as the provider sees it, already mapped to Harold's vocabulary. */
export interface ExternalItem {
  externalId: string;
  externalKey: string;
  externalUrl: string;
  updatedAt: string;
  fields: HaroldFields;
  /** The provider's own project name, kept for logs when it maps to no Harold project. */
  providerProject: string | null;
  /** True when the item has a provider project that maps to no Harold project (then Harold's project is never cleared). */
  projectUnmapped: boolean;
  /** Team / workspace key, so items from other teams are ignored. */
  teamKey: string | null;
  /** Deleted (trashed) on the provider's side. */
  removed: boolean;
  /** Provider-specific state the provider needs back in update() (e.g. Todoist's labels); the engine never reads it. */
  extra?: Record<string, unknown>;
  /** Fields this provider cannot hold at all (Asana has no priority): the engine never pulls them and never counts a
   *  difference in them as a change, so Harold's own value is left alone. */
  unmapped?: FieldKey[];
}

export type WebhookAction = "create" | "update" | "remove";
export interface WebhookEvent { action: WebhookAction; externalId: string; updatedAt: string | null; teamKey: string | null }
/** `reply`: a webhook handshake the provider answers itself (Asana: 200 with the secret echoed in a header); the route
 *  sends it as is and runs no sync. */
export interface WebhookReply { status: number; headers: Record<string, string> }
export type VerifyResult = { ok: true; events: WebhookEvent[]; reply?: WebhookReply } | { ok: false; status: number; reason: string };

/** Milliseconds of a timestamp; Postgres' microseconds are cut to milliseconds. Missing -> -Infinity. */
export const ts = (s: string | null | undefined): number => {
  if (!s) return Number.NEGATIVE_INFINITY;
  const n = Date.parse(s.replace(/(\.\d{3})\d+/, "$1").replace(" ", "T"));
  return Number.isNaN(n) ? Number.NEGATIVE_INFINITY : n;
};

/** A due day (YYYY-MM-DD) as stored in tasks.due_date: UTC midnight, no time-zone conversion. */
export const dueToDb = (d: string | null): string | null => (d ? `${d.slice(0, 10)}T00:00:00Z` : null);
/** tasks.due_date back to a day: the first 10 characters of its UTC ISO string. */
export const dueFromDb = (v: unknown): string | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = ts(String(v));
  return Number.isFinite(n) ? new Date(n).toISOString().slice(0, 10) : String(v).slice(0, 10);
};
export const laterIso = (a: string | null | undefined, b: string | null | undefined): string | null =>
  ts(a) >= ts(b) ? (a ?? b ?? null) : (b ?? null);
