process.env.CI ??= "1"
process.env.INTERNAL_GRAPHQL_URL ??= "http://localhost:1437/graphql"
process.env.NEXT_PUBLIC_GRAPHQL_URL ??= "http://localhost:1437/graphql"
process.env.STRAPI_API_TOKEN ??= "test-strapi-api-token"
process.env.STRAPI_PREVIEW_SECRET ??= "test-strapi-preview-secret"
process.env.REVALIDATION_SECRET ??= "test-revalidation-secret"

// Required for React 19 + react-dom/client `act` under vitest jsdom environment.
// Mirrors packages/video-player/vitest.setup.ts so .tsx tests can use act().
;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

if (!globalThis.requestAnimationFrame) {
  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) =>
    setTimeout(
      () => callback(performance.now()),
      0,
    )) as typeof requestAnimationFrame
}

if (!globalThis.cancelAnimationFrame) {
  globalThis.cancelAnimationFrame = ((handle: number) =>
    clearTimeout(handle)) as typeof cancelAnimationFrame
}

// Embla (used by Carousel) reads matchMedia / IntersectionObserver /
// ResizeObserver during init. jsdom omits all three; the stubs below let
// the carousel mount without throwing in `// @vitest-environment jsdom`
// tests. node-environment tests retain the missing globals — the guards
// only install when nothing is already there.
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList
}

if (typeof globalThis !== "undefined" && !globalThis.IntersectionObserver) {
  class MockIntersectionObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords(): IntersectionObserverEntry[] {
      return []
    }
  }
  ;(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver =
    MockIntersectionObserver as unknown as typeof IntersectionObserver
}

if (typeof globalThis !== "undefined" && !globalThis.ResizeObserver) {
  class MockResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver =
    MockResizeObserver as unknown as typeof ResizeObserver
}
