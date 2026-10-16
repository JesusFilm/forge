/** @vitest-environment jsdom */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next/dynamic", () => ({
  default: () =>
    function Panel({ state }: { state: { status: string } }) {
      return <div data-testid="deferred-seo-panel">{state.status}</div>
    },
}))

import { WatchSeoAdminBoundary } from "@/components/watch/WatchSeoAdminBoundary"
import {
  publishWatchAccountSessionSignal,
  resetWatchAccountSessionSignalForTests,
} from "@/lib/watch-account-session-signal"

describe("WatchSeoAdminBoundary", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    resetWatchAccountSessionSignalForTests()
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  it("does no SEO IO and renders no gap before AccountControl reports sign-in", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    await act(async () => {
      root.render(
        <WatchSeoAdminBoundary
          videoSlug="jesus"
          locale="en"
          languageSlug="english"
        />,
      )
    })
    publishWatchAccountSessionSignal({ status: "unauthenticated" })

    expect(container.innerHTML).toBe("")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("checks capability after sign-in and defers evidence until tab selection", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ canViewWatchSeo: true }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
    vi.stubGlobal("fetch", fetchMock)

    await act(async () => {
      root.render(
        <WatchSeoAdminBoundary
          videoSlug="jesus"
          locale="en"
          languageSlug="english"
        />,
      )
      publishWatchAccountSessionSignal({ status: "authenticated" })
    })

    const tab = await vi.waitFor(() => {
      const element = container.querySelector<HTMLButtonElement>('[role="tab"]')
      expect(element?.textContent).toContain("SEO & Marketing")
      return element!
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/watch/api/watch-seo/capability")
    expect(container.querySelector("[role=tabpanel]")).toBeNull()

    await act(async () => tab.click())

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain(
      "/watch/api/watch-seo/page?",
    )
    await vi.waitFor(() =>
      expect(
        container.querySelector('[data-testid="deferred-seo-panel"]')
          ?.textContent,
      ).toBe("error"),
    )
  })
})
