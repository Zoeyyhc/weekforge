import "@testing-library/jest-dom/vitest";

// jsdom doesn't implement IntersectionObserver, which the landing's Reveal
// component uses for scroll-triggered entrances. Provide a no-op stub so those
// components render in tests without throwing.
if (typeof globalThis.IntersectionObserver === "undefined") {
  class MockIntersectionObserver implements IntersectionObserver {
    readonly root = null;
    readonly rootMargin = "";
    readonly thresholds = [];
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }
  globalThis.IntersectionObserver =
    MockIntersectionObserver as unknown as typeof IntersectionObserver;
}
