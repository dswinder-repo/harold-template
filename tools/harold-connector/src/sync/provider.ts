// A task provider (Linear today): the one surface the sync engine talks to. Mapping to and from
// Harold's vocabulary happens inside the provider, so the engine only ever sees HaroldFields.

import type { ExternalItem, HaroldFields, VerifyResult } from "./types.js";

export interface SyncProvider {
  readonly name: string;
  /** Checks the signature and freshness of a webhook delivery and returns the events it carries. */
  verifyWebhook(req: Request, rawBody: string): Promise<VerifyResult>;
  /** Every item of the configured team updated after `cursor` (all pages). */
  listChangedSince(cursor: string): Promise<ExternalItem[]>;
  /** The first import: every open item, plus those completed within `completedWithinDays`. */
  listForImport(completedWithinDays: number): Promise<ExternalItem[]>;
  getOne(externalId: string): Promise<ExternalItem | null>;
  /** Creates the item with a caller-chosen id (so the link row can exist before the provider's webhook fires). */
  create(fields: HaroldFields, externalId: string): Promise<ExternalItem>;
  /** Changes only the fields whose mapped value differs from `current`; returns the item as it is afterwards. */
  update(current: ExternalItem, fields: HaroldFields): Promise<{ item: ExternalItem; changed: string[] }>;
}
