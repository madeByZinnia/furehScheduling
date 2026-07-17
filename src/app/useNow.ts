import { useEffect, useState } from 'preact/hooks';
import { now, isTimeTravelling } from './now';

/**
 * The current instant, re-rendering on each minute boundary so the "now"
 * separator and header clock advance during a live con day. Under a `?now=`
 * time-travel override the instant is fixed, so we skip the timer entirely.
 */
export function useNow(): Date {
  const [current, setCurrent] = useState(() => now());

  useEffect(() => {
    if (isTimeTravelling()) return; // fixed instant — nothing to tick
    let interval: ReturnType<typeof setInterval> | undefined;
    const tick = () => setCurrent(now());
    // Align the first tick to the next minute boundary, then every 60s.
    const timeout = setTimeout(
      () => {
        tick();
        interval = setInterval(tick, 60_000);
      },
      60_000 - (Date.now() % 60_000),
    );
    return () => {
      clearTimeout(timeout);
      if (interval !== undefined) clearInterval(interval);
    };
  }, []);

  return current;
}
