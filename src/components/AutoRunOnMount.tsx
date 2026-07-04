'use client';

import { useEffect } from 'react';

/**
 * Fires `run` once when `enabled` is true and `cardKey` hasn't been seen
 * before in `ranSet`. Backs the global auto-accept toggle: approval cards
 * (ADD_FACT, USE_TOOL, RUN_CODE, etc.) render normally either way, but when
 * auto-accept is on they execute themselves instead of waiting for a click.
 * `ranSet` must be a ref-held Set that outlives message re-renders, otherwise
 * a re-render (or remount) would re-trigger non-idempotent actions like tool
 * calls or sandbox runs.
 */
export default function AutoRunOnMount({
  cardKey,
  ranSet,
  enabled,
  run,
}: {
  cardKey: string;
  ranSet: Set<string>;
  enabled: boolean;
  run: () => void;
}) {
  useEffect(() => {
    if (enabled && !ranSet.has(cardKey)) {
      ranSet.add(cardKey);
      run();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, cardKey]);
  return null;
}
