import "@testing-library/jest-dom/vitest";

// jsdom doesn't implement matchMedia. next-themes calls it during mount
// to resolve the "system" preference, so stub it before any component
// imports the module.
if (typeof window !== "undefined" && !window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}
