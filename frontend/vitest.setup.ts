import "@testing-library/jest-dom/vitest";

function makeMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
}

const testStorage = makeMemoryStorage();
Object.defineProperty(window, "localStorage", {
  value: testStorage,
  configurable: true,
});
Object.defineProperty(globalThis, "localStorage", {
  value: testStorage,
  configurable: true,
});

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
