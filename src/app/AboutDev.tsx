/**
 * A quiet "About the dev" section at the very bottom of the Me tab — collapsed by
 * default (a native <details>), so it stays out of the way until opened. Contact
 * links open externally.
 */
export function AboutDev() {
  return (
    <details class="about-dev">
      <summary>About the dev</summary>
      <div class="about-dev-body">
        <p>Questions, bugs, or ideas? Say hi:</p>
        <ul class="about-dev-links">
          <li>
            Telegram:{' '}
            <a href="https://t.me/rpg_soundsystem" target="_blank" rel="noopener noreferrer">
              @rpg_soundsystem
            </a>
          </li>
          <li>
            GitHub:{' '}
            <a href="https://github.com/madeByZinnia" target="_blank" rel="noopener noreferrer">
              madeByZinnia
            </a>
          </li>
        </ul>
      </div>
    </details>
  );
}
