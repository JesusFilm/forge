import { vi } from "vitest"
import enMessages from "./messages/en.json"
import ruMessages from "./messages/ru.json"

const { createTranslator } =
  await vi.importActual<typeof import("next-intl")>("next-intl")

process.env.CI ??= "1"
process.env.STRAPI_PREVIEW_SECRET ??= "test-strapi-preview-secret"
process.env.REVALIDATION_SECRET ??= "test-revalidation-secret"
process.env.ADMIN_GRAPHQL_URL ??= "http://localhost:1437/admin/api/graphql"
process.env.WEB_ADMIN_API_KEYS ??= "test-admin-bearer-key"

// next-intl provider context isn't set up in route-render tests. Reuse the
// production translator so the hook/server mocks still exercise real ICU and
// rich-text behavior without wrapping every test in a provider.
const catalogs: Record<string, Record<string, Record<string, string>>> = {
  en: enMessages,
  ru: ruMessages,
}
let activeLocale = "en"

function makeT(namespace: string, locale = activeLocale) {
  return createTranslator({
    locale,
    namespace,
    messages: catalogs[locale] ?? catalogs.en,
    onError() {},
    getMessageFallback({ namespace: fallbackNamespace, key }) {
      return `${fallbackNamespace}.${key}`
    },
  })
}

vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => makeT(namespace),
  useFormatter: () => ({
    dateTime: (value: Date, options?: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat(activeLocale, options).format(value),
    number: (value: number) =>
      new Intl.NumberFormat(activeLocale).format(value),
  }),
  NextIntlClientProvider: ({ children }: { children: unknown }) => children,
}))

vi.mock("next-intl/server", () => ({
  setRequestLocale: vi.fn((locale: string) => {
    activeLocale = locale
  }),
  getLocale: vi.fn(async () => activeLocale),
  getTranslations: vi.fn(
    async (request: string | { locale?: string; namespace: string }) => {
      const namespace =
        typeof request === "string" ? request : request.namespace
      const locale = typeof request === "string" ? activeLocale : request.locale
      return makeT(namespace, locale ?? activeLocale)
    },
  ),
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
