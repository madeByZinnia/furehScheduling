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
