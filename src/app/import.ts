/**
 * Paste-import from fur-eh favourites — pure, DOM-free parsing.
 *
 * Why paste and not fetch: the fur-eh favourites endpoint sends
 * `Access-Control-Allow-Origin: *` WITHOUT credentials (correct security), so a
 * browser can't read a logged-in user's favourites cross-origin. The flow is
 * therefore manual — the user copies the favourites JSON and pastes it in.
 *
 * A fur-eh favourite identifies a SUBMISSION CODE (a session), not one slot.
 * So a matched code stars EVERY occurrence of that code — a repeating session
 * (e.g. a lounge running four days) gets all its slots. We parse LIBERALLY and
 * intersect with the schedule's known codes, so over-matching random 6-char
 * tokens is harmless: unknown tokens are simply dropped.
 */

import type { Occurrence } from '../data/expand';
import type { ItemCode, OccurrenceId } from '../data/ids';

/**
 * Extract every `[A-Z0-9]{6}` token from arbitrary pasted text (JSON or not).
 *
 * Case-SENSITIVE upper: real submission codes are uppercase A-Z0-9, so a
 * lowercase token like `abcdef` is ignored. Deduped, first-seen order.
 */
export function parseCodes(text: string): string[] {
  // \b boundaries reject the 6-char run inside a longer alphanumeric token
  // (e.g. ABCDEFG or ABC1234), so only standalone 6-char codes match.
  const re = /\b[A-Z0-9]{6}\b/g;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of text.matchAll(re)) {
    const code = m[0];
    if (!seen.has(code)) {
      seen.add(code);
      out.push(code);
    }
  }
  return out;
}

export interface CodeMatch {
  /** Parsed codes that exist in the schedule. First-seen order. */
  matched: ItemCode[];
  /** Parsed codes NOT in the schedule — dropped, harmless. First-seen order. */
  unknown: string[];
  /** Every occurrence id whose code is matched — this is what gets starred. */
  occurrenceIds: OccurrenceId[];
  /** Distinct human titles of matched sessions, for the confirm list. */
  titles: string[];
}

/**
 * Intersect parsed codes with the codes present in `occurrences`.
 *
 * Deterministic: `matched`/`unknown` follow the parsed (first-seen) order;
 * `occurrenceIds` follow schedule order, grouped per matched code in first-seen
 * order; `titles` are distinct in that same order.
 */
export function matchKnownCodes(codes: string[], occurrences: Occurrence[]): CodeMatch {
  // Group occurrences by code once, preserving schedule order within each code.
  const byCode = new Map<string, Occurrence[]>();
  for (const occ of occurrences) {
    const list = byCode.get(occ.code);
    if (list) list.push(occ);
    else byCode.set(occ.code, [occ]);
  }

  const matched: ItemCode[] = [];
  const unknown: string[] = [];
  const occurrenceIds: OccurrenceId[] = [];
  const titles: string[] = [];
  const seenTitles = new Set<string>();

  for (const code of codes) {
    const occs = byCode.get(code);
    if (!occs) {
      unknown.push(code);
      continue;
    }
    matched.push(code as ItemCode);
    for (const occ of occs) {
      occurrenceIds.push(occ.id);
      if (occ.title && !seenTitles.has(occ.title)) {
        seenTitles.add(occ.title);
        titles.push(occ.title);
      }
    }
  }

  return { matched, unknown, occurrenceIds, titles };
}
