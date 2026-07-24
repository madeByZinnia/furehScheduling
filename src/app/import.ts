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
 * Which favourites-paste dialect a con uses to encode its codes:
 *  - `pretalx-paste` (Fureh): 6-char uppercase submission codes in JSON.
 *  - `cookie-paste`  (ToS):   a comma-separated list of numeric activity ids
 *    (the ToS occurrence `code`s), from a `HOWL_24` browser cookie value.
 */
export type CodeParseMode = 'pretalx-paste' | 'cookie-paste';

/**
 * The extraction regex per dialect. `pretalx-paste` keeps the original
 * `\b[A-Z0-9]{6}\b` (standalone 6-char uppercase codes); `cookie-paste` grabs
 * every run of digits from the ISOLATED cookie value (see below).
 */
const MODE_RE: Record<CodeParseMode, RegExp> = {
  'pretalx-paste': /\b[A-Z0-9]{6}\b/g,
  'cookie-paste': /\d+/g,
};

/**
 * For cookie-paste, isolate the target cookie's VALUE before pulling digits.
 * This is what prevents an over-match: a whole `document.cookie` string like
 * `HOWL_24=2,3,17; year=2026` must NOT yield `24` (from the cookie NAME) or
 * `2026` (another cookie) — both of which could be real ToS codes and would then
 * be wrongly starred. When the named cookie isn't found (the user pasted just the
 * bare value `2,3,17`), fall back to the whole text.
 */
function cookieValue(text: string, cookieName: string): string {
  const escaped = cookieName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(?:^|[;\\s])${escaped}=([^;]*)`).exec(text);
  return m === null ? text : m[1]!;
}

/**
 * Extract candidate codes from arbitrary pasted text, per the con's dialect.
 *
 * Defaults to `pretalx-paste` for back-compat with the original single-con call
 * sites. Deduped, first-seen order. Case-SENSITIVE upper for the pretalx dialect
 * (a lowercase `abcdef` is ignored); numeric-only for the cookie dialect, scoped
 * to the named cookie's value.
 */
export function parseCodes(
  text: string,
  mode: CodeParseMode = 'pretalx-paste',
  cookieName?: string,
): string[] {
  const source =
    mode === 'cookie-paste' && cookieName !== undefined ? cookieValue(text, cookieName) : text;
  const re = MODE_RE[mode];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of source.matchAll(re)) {
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
