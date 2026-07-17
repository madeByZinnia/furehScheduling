import type { ComponentChildren } from 'preact';

/**
 * Minimal, safe markdown for pretalx abstracts. Abstracts arrive with light
 * markdown — `_italic_`, `**bold**`, `[label](url)`, and paragraph breaks.
 *
 * We parse to Preact vnodes (never innerHTML), so text becomes text nodes and
 * link hrefs are scheme-checked — no HTML injection is possible. Anything we
 * don't recognise stays literal text. Not a full CommonMark parser; just the
 * handful of inline forms that actually appear in the feed.
 */

export type InlineToken =
  | { kind: 'text'; text: string }
  | { kind: 'em'; text: string }
  | { kind: 'strong'; text: string }
  | { kind: 'link'; text: string; href: string };

// Order matters: ** before * / __ before _ so bold wins over italic.
const INLINE_RE = /\*\*([^*]+)\*\*|__([^_]+)__|_([^_]+)_|\*([^*\n]+)\*|\[([^\]]+)\]\(([^)\s]+)\)/g;

/** Allow only web + mail links; everything else renders as literal text. */
export function safeHref(url: string): string | null {
  return /^(https?:\/\/|mailto:)/i.test(url.trim()) ? url.trim() : null;
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
      const href = safeHref(m[6]);
      tokens.push(href ? { kind: 'link', text: m[5], href } : { kind: 'text', text: m[0] });
    }
    last = INLINE_RE.lastIndex;
  }
  if (last < text.length) tokens.push({ kind: 'text', text: text.slice(last) });
  return tokens;
}

/** Split into paragraph blocks on line breaks; blank lines separate. */
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
