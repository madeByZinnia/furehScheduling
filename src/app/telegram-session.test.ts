import { describe, it, expect } from 'vitest';
import { parseLaunchParams, getTelegramSession } from './telegram-session';

/**
 * Build a realistic synthetic launch hash. The signed initData is itself a
 * url-encoded query string; Telegram then url-encodes the WHOLE thing again as
 * the value of `tgWebAppData` in the fragment. Our parser must peel exactly ONE
 * layer, handing the Worker the initData string byte-for-byte.
 */
function buildInitData(user: object, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams();
  p.set('user', JSON.stringify(user));
  p.set('auth_date', '1752800000');
  p.set('hash', 'abc123');
  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  return p.toString();
}

function buildHash(initData: string, startParam?: string): string {
  let hash = `#tgWebAppData=${encodeURIComponent(initData)}&tgWebAppVersion=7.0`;
  if (startParam !== undefined) hash += `&tgWebAppStartParam=${startParam}`;
  return hash;
}

describe('parseLaunchParams — verbatim initData extraction', () => {
  it('returns tgWebAppData verbatim (round-trips the signed string)', () => {
    const initData = buildInitData({ id: 42, first_name: 'Ada' });
    const launch = parseLaunchParams(buildHash(initData, '-1001234567890'));

    // EXACT decoded value of the tgWebAppData param — not decode-then-reencode.
    expect(launch.initData).toBe(initData);
    // The signed hash survives the round-trip: re-read `hash` from what we return.
    expect(new URLSearchParams(launch.initData ?? '').get('hash')).toBe('abc123');
    expect(launch.startParam).toBe('-1001234567890');
  });

  it('parses the display-only user and auth_date from the embedded JSON', () => {
    const initData = buildInitData({
      id: 42,
      first_name: 'Ada',
      last_name: 'Lovelace',
      username: 'ada',
    });
    const launch = parseLaunchParams(buildHash(initData));

    expect(launch.user).toEqual({
      id: 42,
      firstName: 'Ada',
      lastName: 'Lovelace',
      username: 'ada',
    });
    expect(launch.authDate).toBe(1752800000);
  });

  it('omits optional user fields that are absent', () => {
    const initData = buildInitData({ id: 7, first_name: 'Grace' });
    const launch = parseLaunchParams(buildHash(initData));
    expect(launch.user).toEqual({ id: 7, firstName: 'Grace' });
    expect(launch.user).not.toHaveProperty('lastName');
    expect(launch.user).not.toHaveProperty('username');
  });

  it('preserves initData whose user JSON has spaces and emoji (encoding-sensitive)', () => {
    // A name with a space and emoji forces percent-encoding of the tgWebAppData
    // value. If extraction re-encoded the string the HMAC input would differ.
    const user = { id: 99, first_name: 'Ada 🚀 Byron' };
    const initData = buildInitData(user);
    const launch = parseLaunchParams(buildHash(initData, '-100999'));

    // Byte-for-byte the same string the Worker would HMAC.
    expect(launch.initData).toBe(initData);
    // And it is still internally well-formed.
    expect(new URLSearchParams(launch.initData ?? '').get('hash')).toBe('abc123');
    expect(JSON.parse(new URLSearchParams(launch.initData ?? '').get('user') ?? '{}')).toEqual(
      user,
    );
    expect(launch.user).toEqual({ id: 99, firstName: 'Ada 🚀 Byron' });
  });
});

describe('parseLaunchParams — safe non-Telegram fallbacks', () => {
  it('empty hash → null initData, no throw', () => {
    const launch = parseLaunchParams('');
    expect(launch.initData).toBeNull();
    expect(launch.startParam).toBeNull();
    expect(launch.user).toBeNull();
    expect(launch.authDate).toBeNull();
  });

  it('hash without tgWebAppData → null initData', () => {
    const launch = parseLaunchParams('#tgWebAppVersion=7.0&tgWebAppPlatform=tdesktop');
    expect(launch.initData).toBeNull();
    expect(launch.user).toBeNull();
  });

  it('present-but-empty tgWebAppData → null initData', () => {
    const launch = parseLaunchParams('#tgWebAppData=&tgWebAppStartParam=-100');
    expect(launch.initData).toBeNull();
    // A stray startParam still surfaces, but there is no session without initData.
    expect(launch.startParam).toBe('-100');
  });

  it('malformed user JSON → user null, no throw (auth_date still read)', () => {
    const initData = 'user=%7Bnot-json&auth_date=1752800000&hash=abc123';
    const launch = parseLaunchParams(buildHash(initData));
    expect(launch.initData).toBe(initData);
    expect(launch.user).toBeNull();
    expect(launch.authDate).toBe(1752800000);
  });

  it('user JSON missing required fields → user null', () => {
    const initData = buildInitData({ first_name: 'NoId' });
    const launch = parseLaunchParams(buildHash(initData));
    expect(launch.user).toBeNull();
  });

  it('non-numeric auth_date → authDate null', () => {
    const initData = 'user=%7B%22id%22%3A1%2C%22first_name%22%3A%22A%22%7D&auth_date=soon&hash=x';
    const launch = parseLaunchParams(buildHash(initData));
    expect(launch.authDate).toBeNull();
    expect(launch.user).toEqual({ id: 1, firstName: 'A' });
  });
});

describe('getTelegramSession — boot wrapper', () => {
  it('reports isTelegram based on captured initData (plain web → false)', () => {
    // Test env (happy-dom) boots with an empty location.hash, so the memoized
    // boot session is the safe non-Telegram fallback.
    const session = getTelegramSession();
    expect(session.isTelegram).toBe(false);
    expect(session.initData).toBeNull();
  });

  it('derives isTelegram === (initData != null) via parseLaunchParams', () => {
    const withData = parseLaunchParams(buildHash(buildInitData({ id: 1, first_name: 'A' })));
    expect(withData.initData !== null).toBe(true);
    const without = parseLaunchParams('');
    expect(without.initData !== null).toBe(false);
  });
});
