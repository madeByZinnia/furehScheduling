/**
 * Branded ID types. The occurrence bug (208 slots vs 178 codes) is guarded by
 * the *compiler* here, not only by runtime asserts: passing an ItemCode where an
 * OccurrenceId is expected is a compile error.
 *
 *  - ItemCode      — a pretalx submission code (e.g. "CZKVLN"). One per session,
 *                    NOT per time slot. 178 of them.
 *  - OccurrenceId  — one scheduled slot: `${code}@${startISO}`. 208 of them.
 *                    Keyed on code + start so it is STABLE across schedule
 *                    updates (a cancelled slot must not renumber the rest).
 */

declare const brand: unique symbol;
type Brand<T, B> = T & { readonly [brand]: B };

export type ItemCode = Brand<string, 'ItemCode'>;
export type OccurrenceId = Brand<string, 'OccurrenceId'>;

export function itemCode(raw: string): ItemCode {
  return raw as ItemCode;
}

/** Stable occurrence id from a submission code and its slot start time. */
export function occurrenceId(code: ItemCode, startISO: string): OccurrenceId {
  return `${code}@${startISO}` as OccurrenceId;
}
