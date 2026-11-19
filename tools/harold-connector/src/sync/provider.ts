// A task provider (Linear, Todoist, Asana, Notion): the one surface the sync engine talks to. Mapping to and from
// Harold's vocabulary happens inside the provider, so the engine only ever sees HaroldFields.

import type { ProjectMap } from "./projectmap.js";
import type { SyncStore } from "./store.js";
import type { ExternalItem, HaroldFields, VerifyResult } from "./types.js";

/** What a provider's webhook check may need beyond the request: the store, for a provider that keeps a secret the
 *  provider itself issued (Asana's per-webhook secret). Lazy, so a delivery that needs no database never opens one. */
export interface WebhookContext { store: () => SyncStore | null }

/** Items plus the provider's own cursor to store for next time (providers that keep an opaque cursor). */
export interface ChangeBatch { items: ExternalItem[]; cursor: string | null }

export interface SyncProvider {
  readonly name: string;
  /** How the provider names itself and its items in log text, e.g. "Linear" / "issue". */
  readonly displayName?: string;
  readonly itemNoun?: string;
  /**
   * Whether `create` accepts a caller-chosen id (Linear does). Default true. When false, the engine writes the link
   * row first under a placeholder id, passes that placeholder to `create` as an idempotency key, and re-keys the
   * link to the real id once the item exists (see SyncEngine.createExternal).
   */
  readonly callerChosenIds?: boolean;
  /**
   * The provider's updatedAt is coarse (Notion rounds last_edited_time to the minute), so an edit made in the same
   * minute as the last sync keeps the same timestamp. With this set, the engine also counts the item as changed when
   * its timestamp equals the last agreed one but its fields differ from the agreed values (link.synced_fields).
   */
  readonly coarseTimestamps?: boolean;
  /** Checks the signature and freshness of a webhook delivery and returns the events it carries. */
  verifyWebhook(req: Request, rawBody: string, ctx?: WebhookContext): Promise<VerifyResult>;
  /** Every item in scope updated after `cursor`, an ISO timestamp (all pages). */
  listChangedSince(cursor: string): Promise<ExternalItem[]>;
  /**
   * Providers that keep their own opaque cursor (Todoist's sync_token) implement this instead of being driven by a
   * timestamp: `cursor` is what the last call returned (null on the first run, when only items updated at or after
   * `lookbackSince` are returned). When present, the engine uses it for catchup and stores the cursor it returns.
   */
  listChanges?(cursor: string | null, lookbackSince: string): Promise<ChangeBatch>;
  /** The first import: every open item, plus those completed within `completedWithinDays`. A provider with its own
   *  cursor returns a ChangeBatch so the import also seeds that cursor. */
  listForImport(completedWithinDays: number): Promise<ExternalItem[] | ChangeBatch>;
  getOne(externalId: string): Promise<ExternalItem | null>;
  /** Creates the item. With callerChosenIds, `externalId` becomes the item's id (so the link row can exist before the
   *  provider's webhook fires); without, it is an idempotency key: the same key must not create a second item. */
  create(fields: HaroldFields, externalId: string): Promise<ExternalItem>;
  /** Changes only the fields whose mapped value differs from `current`; returns the item as it is afterwards. */
  update(current: ExternalItem, fields: HaroldFields): Promise<{ item: ExternalItem; changed: string[] }>;
}

/**
 * One configured provider in the registry (src/sync/registry.ts). Webhook verification needs only the provider's
 * own secret, so it runs before anything else (no database or GitHub call for a forged delivery); `build` makes
 * the provider once the project map has been loaded.
 */
export interface ProviderEntry {
  readonly name: string;
  /** The team / workspace / project the engine keeps to (EngineOptions.teamKey), or null for no restriction. */
  readonly scope: string | null;
  verifyWebhook(req: Request, rawBody: string, ctx?: WebhookContext): Promise<VerifyResult> | VerifyResult;
  /**
   * For a provider whose configuration lives in the database (Notion's setup): loads what `build` needs. Returns null
   * when the provider can run, or the reason it cannot; the sync routes then skip it with that reason (the other
   * providers run as usual).
   */
  prepare?(store: SyncStore): Promise<string | null>;
  build(map: ProjectMap): SyncProvider;
}
