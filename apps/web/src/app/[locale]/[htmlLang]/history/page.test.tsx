/**
 * @vitest-environment jsdom
 */
import { renderToString } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
}))

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}))

vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
  setRequestLocale: vi.fn(),
}))

vi.mock("@/components/watch/WatchHistoryClient", () => ({
  WatchHistoryClient: () => <div data-testid="watch-history-client" />,
}))

vi.mock("@/lib/auth-session", () => ({
  verifyAuthSession: vi.fn(async () => ({ authenticated: true })),
}))

vi.mock("@/i18n/client-messages", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/i18n/client-messages")>()
  return {
    ...actual,
    loadClientMessages: vi.fn(async () => ({})),
  }
})

import WatchHistoryPage from "@/app/[locale]/[htmlLang]/history/page"
import { WATCH_PAGE_CONTENT_CLASSES } from "@/lib/content-width"

describe("/history route", () => {
  it("uses the shared Watch content rail for authenticated history", async () => {
    const page = await WatchHistoryPage({
      params: Promise.resolve({ locale: "en" }),
    })
    const html = renderToString(page)

    for (const className of WATCH_PAGE_CONTENT_CLASSES.split(" ")) {
      expect(html).toContain(className)
    }
    expect(html).toContain('data-testid="watch-history-client"')
  })
})
