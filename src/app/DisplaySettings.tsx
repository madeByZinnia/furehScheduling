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

const SIZE_LABEL: Record<TextSize, string> = { s: 'S', m: 'M', l: 'L', xl: 'XL', xxl: 'XXL' };

/**
 * Display settings — Theme and Text size as two independent, labelled sections
 * of discrete stops (per the mockup-feedback revision). Segmented buttons give
 * fixed, snapping stops that a screen reader and high magnification handle more
 * reliably than a continuous range slider. (4cz.2 may refine the widget.)
 */
export function DisplaySettings() {
  const theme = useTheme();
  const textSize = useTextSize();

  return (
    <div class="display-settings">
      <fieldset>
        <legend>Text size</legend>
        <div class="seg" role="group" aria-label="Text size">
          {TEXT_SIZES.map((size) => (
            <button
              key={size}
              type="button"
              aria-pressed={textSize === size}
              onClick={() => setTextSize(size)}
            >
              {SIZE_LABEL[size]}
            </button>
          ))}
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
