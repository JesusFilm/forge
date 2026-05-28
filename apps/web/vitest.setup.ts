import { vi } from "vitest"
import enMessages from "./messages/en.json"

process.env.CI ??= "1"
process.env.STRAPI_PREVIEW_SECRET ??= "test-strapi-preview-secret"
process.env.REVALIDATION_SECRET ??= "test-revalidation-secret"
process.env.ADMIN_GRAPHQL_URL ??= "http://localhost:1437/admin/api/graphql"
process.env.WEB_ADMIN_API_KEYS ??= "test-admin-bearer-key"

// next-intl provider context isn't set up in route-render tests. Mock
// useTranslations to look up keys in messages/en.json so existing
// assertions on user-visible English copy keep working. ICU interpolation
// supports the simple `{name}` placeholder pattern; component code passes
// values via t(key, {name: value}).
vi.mock("next-intl", () => {
  const messages = enMessages as Record<string, Record<string, string>>
  function lookup(namespace: string, key: string): string {
    const ns = messages[namespace]
    if (!ns) return `${namespace}.${key}`
    return ns[key] ?? `${namespace}.${key}`
  }
  function interpolate(template: string, values?: Record<string, unknown>) {
    if (!values) return template
    return template.replace(/\{(\w+)\}/g, (_, name) =>
      name in values ? String(values[name]) : `{${name}}`,
    )
  }
  function useTranslations(namespace: string) {
    return (key: string, values?: Record<string, unknown>) =>
      interpolate(lookup(namespace, key), values)
  }
  return {
    useTranslations,
    NextIntlClientProvider: ({ children }: { children: unknown }) => children,
  }
})

vi.mock("next-intl/server", () => ({
  setRequestLocale: vi.fn(),
  getLocale: vi.fn(async () => "en"),
  getTranslations: vi.fn(async (namespace: string) => {
    const messages = enMessages as Record<string, Record<string, string>>
    return (key: string, values?: Record<string, unknown>) => {
      const template = messages[namespace]?.[key] ?? `${namespace}.${key}`
      if (!values) return template
      return template.replace(/\{(\w+)\}/g, (_, name) =>
        name in values ? String(values[name]) : `{${name}}`,
      )
    }
  }),
}))

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
