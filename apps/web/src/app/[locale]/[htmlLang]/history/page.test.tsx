/**
 * @vitest-environment jsdom
 */
import { renderToString } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
}))

vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT")
  }),
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

import { redirect } from "next/navigation"

import WatchHistoryPage from "@/app/[locale]/[htmlLang]/history/page"
import { verifyAuthSession } from "@/lib/auth-session"
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

  it("sends a signed-out visitor to sign-in without doubling the basePath", async () => {
    vi.mocked(verifyAuthSession).mockResolvedValueOnce({
      authenticated: false,
    } as Awaited<ReturnType<typeof verifyAuthSession>>)

    await expect(
      WatchHistoryPage({ params: Promise.resolve({ locale: "en" }) }),
    ).rejects.toThrow("NEXT_REDIRECT")

    // Next's `redirect()` adds the `/watch` basePath; a `/watch/...` target
    // became `/watch/watch/api/auth/login` and rendered the not-found page in
    // production (2026-10-20). `returnTo` is read as a full public path.
    expect(redirect).toHaveBeenCalledWith(
      "/api/auth/login?returnTo=%2Fwatch%2Fhistory",
    )
  })
})
