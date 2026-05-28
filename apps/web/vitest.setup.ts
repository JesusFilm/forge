import { vi } from "vitest"
import enMessages from "./messages/en.json"

process.env.CI ??= "1"
process.env.STRAPI_PREVIEW_SECRET ??= "test-strapi-preview-secret"
process.env.REVALIDATION_SECRET ??= "test-revalidation-secret"
process.env.ADMIN_GRAPHQL_URL ??= "http://localhost:1437/admin/api/graphql"
process.env.WEB_ADMIN_API_KEYS ??= "test-admin-bearer-key"

// next-intl provider context isn't set up in route-render tests. Mock
// useTranslations / getTranslations to look up keys in messages/en.json
// so assertions on user-visible English copy keep working without a
// provider wrap. Minimal ICU formatter below covers the two shapes our
// catalogs use: simple `{name}` interpolation and `{count, plural, one
// {…} other {…}}` (with `#` → the count). NOT a full ICU engine — if a
// catalog grows select/selectordinal/nested-plural, swap this for the
// real intl-messageformat. Keep in sync across both next-intl exports.
const enCatalog = enMessages as Record<string, Record<string, string>>

function selectPlural(template: string, values: Record<string, unknown>) {
  // {var, plural, one {…} other {…}} — one nesting level of braces in arms.
  return template.replace(
    /\{(\w+),\s*plural,\s*((?:[^{}]|\{[^{}]*\})*)\}/g,
    (_, name: string, body: string) => {
      const n = Number(values[name])
      if (Number.isNaN(n)) return `{${name}}`
      const arms: Record<string, string> = {}
      const armRe = /(=\d+|zero|one|two|few|many|other)\s*\{([^{}]*)\}/g
      let m: RegExpExecArray | null
      while ((m = armRe.exec(body)) !== null) arms[m[1]] = m[2]
      const category = new Intl.PluralRules("en").select(n)
      const chosen = arms[`=${n}`] ?? arms[category] ?? arms.other ?? ""
      return chosen.replace(/#/g, String(n))
    },
  )
}

function formatIcu(template: string, values?: Record<string, unknown>) {
  if (!values) return template
  const withPlurals = selectPlural(template, values)
  // Simple {name} substitution (runs after plural so `#` inside arms is
  // already resolved and arm-local placeholders still interpolate).
  return withPlurals.replace(/\{(\w+)\}/g, (_, name: string) =>
    name in values ? String(values[name]) : `{${name}}`,
  )
}

function lookup(namespace: string, key: string): string {
  return enCatalog[namespace]?.[key] ?? `${namespace}.${key}`
}

function makeT(namespace: string) {
  return (key: string, values?: Record<string, unknown>) =>
    formatIcu(lookup(namespace, key), values)
}

vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => makeT(namespace),
  NextIntlClientProvider: ({ children }: { children: unknown }) => children,
}))

vi.mock("next-intl/server", () => ({
  setRequestLocale: vi.fn(),
  getLocale: vi.fn(async () => "en"),
  getTranslations: vi.fn(async (namespace: string) => makeT(namespace)),
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
