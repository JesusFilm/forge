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
  setRequestLocale: vi.fn(),
}))

vi.mock("@/lib/auth-session", () => ({
  verifyAuthSession: vi.fn(async () => ({ authenticated: true })),
}))

vi.mock("@/components/watch/WatchHistoryClient", () => ({
  WatchHistoryClient: () => <div data-testid="watch-history-client" />,
}))

import WatchHistoryPage from "@/app/[locale]/[htmlLang]/history/page"

function maxWidthTokens(element: Element | null): string[] {
  return Array.from(element?.classList ?? []).filter((token) =>
    token.includes("max-w-"),
  )
}

describe("Watch history page", () => {
  it("uses the canonical public Watch frame", async () => {
    const page = await WatchHistoryPage({
      params: Promise.resolve({ locale: "en" }),
    })
    document.body.innerHTML = renderToString(page)

    expect(maxWidthTokens(document.querySelector("main > div"))).toEqual([
      "max-w-[1920px]",
    ])
    expect(document.body.innerHTML).not.toContain("max-w-5xl")
  })
})
