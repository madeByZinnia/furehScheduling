/**
 * Source-adapter contract for the multi-con schedule ingest.
 *
 * Every con's feed — however it is shaped upstream — is normalized by its
 * adapter into the same flat `{ slots, talks }` pair that `expandOccurrences`
 * consumes. fetch-schedule.ts picks the adapter by `con.source.kind` / `shape`
 * and stays feed-agnostic from there on.
 */

import type { RawSlot, RawTalk } from '../../src/data/expand.ts';
import type { ConConfig } from '../../src/data/cons.ts';

export interface AdapterContext {
  con: ConConfig;
  /** When set, adapters read this local JSON instead of hitting the network. */
  fixturePath?: string;
}

export type SourceAdapter = (
  ctx: AdapterContext,
) => Promise<{ slots: RawSlot[]; talks: RawTalk[] }>;
