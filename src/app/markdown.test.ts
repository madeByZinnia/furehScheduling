import { describe, it, expect } from 'vitest';
import { parseInline, splitBlocks, safeHref } from './markdown';

describe('parseInline', () => {
  it('parses italics (_x_ and *x*)', () => {
    expect(parseInline('_Hosted by Cielle_')).toEqual([{ kind: 'em', text: 'Hosted by Cielle' }]);
    expect(parseInline('a *b* c')).toEqual([
      { kind: 'text', text: 'a ' },
      { kind: 'em', text: 'b' },
      { kind: 'text', text: ' c' },
    ]);
  });

  it('parses bold before italic', () => {
    expect(parseInline('**loud**')).toEqual([{ kind: 'strong', text: 'loud' }]);
  });

  it('parses safe links and rejects unsafe schemes', () => {
    expect(parseInline('see [Twitch](https://twitch.tv/x)')).toEqual([
      { kind: 'text', text: 'see ' },
      { kind: 'link', text: 'Twitch', href: 'https://twitch.tv/x' },
    ]);
    // javascript: is not a safe scheme → no link node, content preserved as text.
    const unsafe = parseInline('[x](javascript:alert(1))');
    expect(unsafe.some((t) => t.kind === 'link')).toBe(false);
    expect(unsafe.map((t) => t.text).join('')).toBe('[x](javascript:alert(1))');
  });

  it('recovers the real url from a malformed nested link', () => {
    // Real feed typo: a markdown link nested inside the url slot.
    expect(
      parseInline('[TwistedTailsEscape.com]([url](https://www.twistedtailsescape.com/))'),
    ).toEqual([
      { kind: 'link', text: 'TwistedTailsEscape.com', href: 'https://www.twistedtailsescape.com/' },
    ]);
  });

  it('keeps balanced parens inside a link url (e.g. Wikipedia)', () => {
    expect(parseInline('[Fox](https://en.wikipedia.org/wiki/Fox_(animal))')).toEqual([
      { kind: 'link', text: 'Fox', href: 'https://en.wikipedia.org/wiki/Fox_(animal)' },
    ]);
  });

  it('auto-links bare urls and returns trailing punctuation to the text', () => {
    expect(parseInline('visit https://fur-eh.ca today')).toEqual([
      { kind: 'text', text: 'visit ' },
      { kind: 'link', text: 'https://fur-eh.ca', href: 'https://fur-eh.ca' },
      { kind: 'text', text: ' today' },
    ]);
    expect(parseInline('see (https://fur-eh.ca).')).toEqual([
      { kind: 'text', text: 'see (' },
      { kind: 'link', text: 'https://fur-eh.ca', href: 'https://fur-eh.ca' },
      { kind: 'text', text: ').' },
    ]);
    // Bracket-wrapped bare url: the trailing ']' is split back to text.
    expect(parseInline('[https://fur-eh.ca]')).toEqual([
      { kind: 'text', text: '[' },
      { kind: 'link', text: 'https://fur-eh.ca', href: 'https://fur-eh.ca' },
      { kind: 'text', text: ']' },
    ]);
    // A balanced ')' inside a BARE url is kept; only trailing punctuation is split.
    expect(parseInline('at https://en.wikipedia.org/wiki/Fox_(animal).')).toEqual([
      { kind: 'text', text: 'at ' },
      {
        kind: 'link',
        text: 'https://en.wikipedia.org/wiki/Fox_(animal)',
        href: 'https://en.wikipedia.org/wiki/Fox_(animal)',
      },
      { kind: 'text', text: '.' },
    ]);
  });

  it('bails to plain text on pathological over-length input (ReDoS guard)', () => {
    const huge = '['.repeat(5000);
    const out = parseInline(huge);
    expect(out).toEqual([{ kind: 'text', text: huge }]);
  });

  it('leaves plain text untouched', () => {
    expect(parseInline('just words')).toEqual([{ kind: 'text', text: 'just words' }]);
  });
});

describe('safeHref', () => {
  it('allows http(s) and mailto only', () => {
    expect(safeHref('https://a.com')).toBe('https://a.com');
    expect(safeHref('http://a.com')).toBe('http://a.com');
    expect(safeHref('mailto:a@b.com')).toBe('mailto:a@b.com');
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('data:text/html,x')).toBeNull();
  });
});

describe('splitBlocks', () => {
  it('splits on newlines and drops blank lines', () => {
    expect(splitBlocks('_Hosted by Moon_\r\nA cozy space.\r\n\r\nCome by!')).toEqual([
      '_Hosted by Moon_',
      'A cozy space.',
      'Come by!',
    ]);
  });
});
