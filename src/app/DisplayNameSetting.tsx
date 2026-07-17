import { getTelegramSession } from './telegram-session';
import { useDisplayName, setDisplayName } from './profile';

/**
 * Lets a member choose the name their crew sees (roster + "also going" chips).
 * Blank falls back to the verified Telegram name (the Worker sanitizes and, when
 * blank, uses the Telegram name). The change rides the normal debounced crew sync.
 */
export function DisplayNameSetting() {
  const name = useDisplayName();
  const user = getTelegramSession().user;
  const tgName =
    user !== null ? [user.firstName, user.lastName].filter((p) => p).join(' ') : '';
  const fallback = tgName !== '' ? tgName : 'your Telegram name';

  return (
    <section class="me-section" aria-labelledby="display-name-heading">
      <h2 id="display-name-heading">Display name</h2>
      <label class="field">
        <span class="field-label">How your crew sees you</span>
        <input
          class="field-input"
          type="text"
          value={name}
          placeholder={fallback}
          maxLength={40}
          onInput={(e) => setDisplayName(e.currentTarget.value)}
        />
      </label>
      <p class="me-note">
        Leave blank to use {fallback}. Your crew sees this name in the roster and on sessions
        you’ve starred.
      </p>
    </section>
  );
}
