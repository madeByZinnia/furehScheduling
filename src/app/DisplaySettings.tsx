import {
  useTheme,
  setTheme,
  useTextSize,
  setTextSize,
  TEXT_SIZES,
  type Theme,
  type TextSize,
} from './settings';

const THEMES: { value: Theme; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
];

// Short visible chip (S · M · L · XL · XXL) shown beside the slider…
const SIZE_LABEL: Record<TextSize, string> = { s: 'S', m: 'M', l: 'L', xl: 'XL', xxl: 'XXL' };
// …and the spoken name, so a screen reader announces "Large", not the index "2".
const SIZE_NAME: Record<TextSize, string> = {
  s: 'Small',
  m: 'Medium',
  l: 'Large',
  xl: 'Extra large',
  xxl: 'Extra extra large',
};

/**
 * Display settings — Theme and Text size as two independent, labelled sections.
 *
 * Text size is a DISCRETE range slider (4cz.2): five snapping stops whose index
 * maps to TEXT_SIZES[index]. Telegram does NOT forward the OS text-size setting
 * into its webview, so this control is load-bearing. It carries an accessible
 * name + aria-valuetext (the spoken size name) so it announces "Large", not "2",
 * and a visible current-size chip. The native range is fully keyboard-operable
 * and has no motion-gated thumb animation (reduced-motion is respected for free).
 *
 * Theme stays as segmented toggle buttons — a small, fixed, unordered set.
 */
export function DisplaySettings() {
  const theme = useTheme();
  const textSize = useTextSize();
  const index = TEXT_SIZES.indexOf(textSize);

  return (
    <div class="display-settings">
      <fieldset>
        <legend>Text size</legend>
        <div class="size-slider">
          <input
            type="range"
            class="size-range"
            min={0}
            max={TEXT_SIZES.length - 1}
            step={1}
            value={index}
            aria-label="Text size"
            aria-valuetext={SIZE_NAME[textSize]}
            onInput={(e) => {
              const next = TEXT_SIZES[Number((e.target as HTMLInputElement).value)];
              if (next) setTextSize(next);
            }}
          />
          <output class="size-value" aria-hidden="true">
            {SIZE_LABEL[textSize]}
          </output>
        </div>
      </fieldset>

      <fieldset>
        <legend>Theme</legend>
        <div class="seg" role="group" aria-label="Theme">
          {THEMES.map((t) => (
            <button
              key={t.value}
              type="button"
              aria-pressed={theme === t.value}
              onClick={() => setTheme(t.value)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
