import { vi } from "vitest"
import arMessages from "./messages/ar.json"
import enMessages from "./messages/en.json"
import ruMessages from "./messages/ru.json"
import zhHansMessages from "./messages/zh-Hans.json"

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
  ar: arMessages,
  en: enMessages,
  ru: ruMessages,
  "zh-Hans": zhHansMessages,
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
  useLocale: () => activeLocale,
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

/**
 * Web Storage for DOM tests.
 *
 * Node 24+ defines an experimental `localStorage` global that stays
 * `undefined` unless the process was started with `--localstorage-file`.
 * The key existing on `globalThis` is enough to stop vitest's jsdom
 * environment installing jsdom's own Storage over it, so every DOM test sees
 * `window.localStorage === undefined` — a shape no browser has, and one that
 * sends storage-backed components down their "storage unavailable" branch
 * before a single assertion runs. Only installed when the DOM is present and
 * nothing real is there, so `environment: "node"` suites are untouched.
 */
if (typeof window !== "undefined" && !globalThis.localStorage) {
  class MemoryStorage implements Storage {
    #entries = new Map<string, string>()

    get length(): number {
      return this.#entries.size
    }
    key(index: number): string | null {
      return [...this.#entries.keys()][index] ?? null
    }
    getItem(key: string): string | null {
      return this.#entries.get(String(key)) ?? null
    }
    setItem(key: string, value: string): void {
      this.#entries.set(String(key), String(value))
    }
    removeItem(key: string): void {
      this.#entries.delete(String(key))
    }
    clear(): void {
      this.#entries.clear()
    }
  }

  for (const name of ["localStorage", "sessionStorage"] as const) {
    // `defineProperty`, not assignment: the Node global is a getter-only
    // accessor and assigning to it is a silent no-op.
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value: new MemoryStorage(),
    })
  }
}
