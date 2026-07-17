/**
 * A small circular initial badge for a crew member. The colour is a stable,
 * deterministic function of the Telegram userId, so the same person is always
 * the same colour across the roster and the "also going" chips. Colours are
 * fixed (not theme tokens) with dark text, so contrast holds in both themes.
 *
 * Decorative only: `aria-hidden` — the member's name is always rendered as text
 * beside it, so the avatar must not double-announce.
 */

const AVATAR_COLORS = ['#e0b352', '#7fc0e8', '#5cc79b', '#ee8a7d', '#b3a6e0'] as const;

/** Stable palette colour for a userId. */
export function avatarColor(userId: number): string {
  return AVATAR_COLORS[Math.abs(userId) % AVATAR_COLORS.length]!;
}

/** First character of a name, upper-cased; '?' for an empty/blank name. */
export function avatarInitial(name: string): string {
  const first = [...name.trim()][0];
  return first ? first.toUpperCase() : '?';
}

export function Avatar({
  userId,
  name,
  size = 'md',
}: {
  userId: number;
  name: string;
  size?: 'sm' | 'md';
}) {
  return (
    <span
      class={`avatar avatar-${size}`}
      style={{ background: avatarColor(userId) }}
      aria-hidden="true"
    >
      {avatarInitial(name)}
    </span>
  );
}
