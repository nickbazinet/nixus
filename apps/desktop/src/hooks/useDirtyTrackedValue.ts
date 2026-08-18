import { useEffect, useState } from "react";

export interface DirtyTrackedValue<T> {
  value: T;
  setValue: (next: T) => void;
  dirty: boolean;
  reset: () => void;
}

/**
 * Tracks a value that mirrors a derived input until the caller explicitly sets one — at which
 * point it goes "dirty" and stops re-syncing, so a derived value that settles late (e.g. an
 * async query resolving) never overwrites a choice the user is mid-exploration on. `reset`
 * clears the override and snaps the value back to whatever the derived input currently is.
 */
export function useDirtyTrackedValue<T>(
  derivedValue: T,
): DirtyTrackedValue<T> {
  const [value, setValueState] = useState(derivedValue);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!dirty) setValueState(derivedValue);
  }, [derivedValue, dirty]);

  function setValue(next: T) {
    setValueState(next);
    setDirty(true);
  }

  function reset() {
    setValueState(derivedValue);
    setDirty(false);
  }

  return { value, setValue, dirty, reset };
}
