import { vi } from "vitest";

/**
 * jsdom's `localStorage` arrives here as a method-less stub, so every suite touching storage
 * installs this in-memory Storage instead. Returns the mock so callers can spy on it.
 */
export function installLocalStorageMock() {
  let store: Record<string, string> = {};

  const mock = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };

  vi.stubGlobal("localStorage", mock);

  return mock;
}
