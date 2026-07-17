import { describe, it, expect } from 'vitest';
import { avatarColor, avatarInitial } from './Avatar';

describe('avatarColor', () => {
  it('is deterministic — the same userId always maps to the same colour', () => {
    expect(avatarColor(12345)).toBe(avatarColor(12345));
  });

  it('always returns a valid hex colour', () => {
    for (const id of [0, 1, 2, 3, 4, 5, 6, 999, -42, 1_000_000]) {
      expect(avatarColor(id)).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe('avatarInitial', () => {
  it('is the first character, upper-cased', () => {
    expect(avatarInitial('Alice')).toBe('A');
    expect(avatarInitial('bob')).toBe('B');
  });

  it('trims and handles multi-word / emoji names', () => {
    expect(avatarInitial('  moss ')).toBe('M');
    expect(avatarInitial('🦊 Foxy')).toBe('🦊');
  });

  it('falls back to "?" for an empty or blank name', () => {
    expect(avatarInitial('')).toBe('?');
    expect(avatarInitial('   ')).toBe('?');
  });
});
