import type { ComponentChildren } from 'preact';

/**
 * Minimal, safe markdown for pretalx abstracts. Abstracts arrive with light
 * markdown — `_italic_`, `**bold**`, `[label](url)`, bare urls, and paragraph
 * breaks. Feed authors also produce malformed links like
 * `[label]([url](https://real))` (a markdown link nested in the url slot); we
 * recover the real url from those rather than dumping the raw text.
 *
 * We parse to Preact vnodes (never innerHTML), so text becomes text nodes and
 * link hrefs are scheme-checked (http/https/mailto only) — no HTML injection is
 * possible. Anything we don't recognise stays literal text. Not a full
 * CommonMark parser; just the inline forms that actually appear in the feed.
 */

export type InlineToken =
  | { kind: 'text'; text: string }
  | { kind: 'em'; text: string }
  | { kind: 'strong'; text: string }
  | { kind: 'link'; text: string; href: string };

// Order: bold before italic; the `[label](target)` link allows ONE level of
// balanced parens in the target (so Wikipedia `..._(x)` urls and the feed's
// malformed `[label]([url](real))` typos parse whole); a bare http(s) url is the
// last alternative so plain pasted links auto-link too.
const INLINE_RE =
  /\*\*([^*]+)\*\*|__([^_]+)__|_([^_]+)_|\*([^*\n]+)\*|\[([^\]]+)\]\(((?:[^()]|\([^()]*\))*)\)|(https?:\/\/[^\s<>]+)/g;

/** Allow only web + mail links; everything else renders as literal text. */
export function safeHref(url: string): string | null {
  return /^(https?:\/\/|mailto:)/i.test(url.trim()) ? url.trim() : null;
}

/**
 * Pull a usable href out of a link's target. Handles a clean url directly, a
 * nested `[..](url)` (the feed's typo), or any bare url embedded in junk.
 */
export function extractHref(target: string): string | null {
  const direct = safeHref(target);
  if (direct) return direct;
  const nested = /\]\(\s*(https?:\/\/[^)\s]+)/i.exec(target);
  if (nested?.[1]) return safeHref(nested[1]);
  const bare = /https?:\/\/[^)\s]+/i.exec(target);
  return bare ? safeHref(bare[0]) : null;
}

/** Split a bare url off its trailing sentence punctuation (`.`, `)`, `,`, …). */
function splitTrailingPunct(url: string): { url: string; trailing: string } {
  const m = /[.,;:!?)\]}'"]+$/.exec(url);
  if (!m) return { url, trailing: '' };
  return { url: url.slice(0, m.index), trailing: m[0] };
}

/** Parse one line into inline tokens (bold / italic / link / text). */
export function parseInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let last = 0;
  INLINE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = INLINE_RE.exec(text)) !== null) {
    if (m.index > last) tokens.push({ kind: 'text', text: text.slice(last, m.index) });

    const bold = m[1] ?? m[2];
    const italic = m[3] ?? m[4];
    if (bold !== undefined) tokens.push({ kind: 'strong', text: bold });
    else if (italic !== undefined) tokens.push({ kind: 'em', text: italic });
    else if (m[5] !== undefined && m[6] !== undefined) {
      const href = extractHref(m[6]);
      tokens.push(href ? { kind: 'link', text: m[5], href } : { kind: 'text', text: m[0] });
    } else if (m[7] !== undefined) {
      // Bare url: link it, but return trailing punctuation to the text stream.
      const { url, trailing } = splitTrailingPunct(m[7]);
      const href = safeHref(url);
      tokens.push(href ? { kind: 'link', text: url, href } : { kind: 'text', text: url });
      if (trailing) tokens.push({ kind: 'text', text: trailing });
    }
    last = INLINE_RE.lastIndex;
  }
  if (last < text.length) tokens.push({ kind: 'text', text: text.slice(last) });
  return tokens;
}

/**
 * Split into paragraphs: each non-blank line is its own paragraph. The pretalx
 * feed separates logical paragraphs (e.g. the "_Hosted by …_" line from the
 * body) with a single newline and does not hard-wrap, so per-line splitting —
 * not blank-line splitting — matches the source's paragraph semantics.
 */
export function splitBlocks(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function renderToken(tok: InlineToken, key: number): ComponentChildren {
  switch (tok.kind) {
    case 'text':
      return tok.text;
    case 'em':
      return <em key={key}>{tok.text}</em>;
    case 'strong':
      return <strong key={key}>{tok.text}</strong>;
    case 'link':
      return (
        <a key={key} href={tok.href} target="_blank" rel="noopener noreferrer">
          {tok.text}
          <span class="visually-hidden"> (opens in a new tab)</span>
        </a>
      );
  }
}

/** Render abstract markdown as paragraphs of safe inline vnodes. */
export function Markdown({ text }: { text: string }) {
  return (
    <>
      {splitBlocks(text).map((block, i) => (
        <p key={i} class="md-p">
          {parseInline(block).map((tok, j) => renderToken(tok, j))}
        </p>
      ))}
    </>
  );
}
