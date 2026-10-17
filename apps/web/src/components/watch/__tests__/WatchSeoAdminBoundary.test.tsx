/** @vitest-environment jsdom */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next/dynamic", () => ({
  default: () =>
    function Panel({
      id,
      labelledBy,
      state,
    }: {
      id: string
      labelledBy: string
      state: { status: string }
    }) {
      return (
        <div
          id={id}
          role="tabpanel"
          aria-labelledby={labelledBy}
          data-testid="deferred-seo-panel"
        >
          {state.status}
        </div>
      )
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
    sessionStorage.clear()
    window.history.replaceState({}, "", "/watch/jesus.html")
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

  it("shows sample evidence from a development-only URL preview flag without sign-in", async () => {
    window.history.replaceState({}, "", "/watch/jesus.html?seoAdminPreview=1")
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

    const tab = await vi.waitFor(() => {
      const element = container.querySelector<HTMLButtonElement>('[role="tab"]')
      expect(element).not.toBeNull()
      return element!
    })
    await import("@/components/watch/seo/sample-data")
    await act(async () => {
      tab.click()
      await Promise.resolve()
    })
    await vi.waitFor(() => expect(container.textContent).toContain("ready"))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(sessionStorage.getItem("watch-seo-admin-preview-v1")).toBe("1")
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
    expect(tab.hasAttribute("aria-controls")).toBe(false)

    await act(async () => tab.click())

    expect(tab.getAttribute("aria-controls")).toBe(
      container.querySelector('[role="tabpanel"]')?.id,
    )

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

  it("keeps ready evidence and makes no extra requests when the selected tab is activated again", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ canViewWatchSeo: true }))
      .mockResolvedValueOnce(
        Response.json({
          data: { schemaVersion: "watch-seo-marketing-v1" },
          adminOrigin: "https://admin.example.org",
          adminConfirmationUrl:
            "https://admin.example.org/dashboard/seo/proposals/confirm",
        }),
      )
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
      const button = container.querySelector<HTMLButtonElement>('[role="tab"]')
      expect(button).not.toBeNull()
      return button!
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(
      container.querySelector('[data-testid="deferred-seo-panel"]'),
    ).toBeNull()
    await act(async () => tab.click())
    await vi.waitFor(() => expect(container.textContent).toContain("ready"))
    await act(async () => {
      tab.click()
      // Native button keyboard activation arrives as a click with detail 0.
      tab.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }))
    })
    expect(tab.getAttribute("aria-selected")).toBe("true")
    expect(
      container.querySelector('[data-testid="deferred-seo-panel"]')
        ?.textContent,
    ).toBe("ready")
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("reuses a short-lived denied capability across Watch navigation", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ canViewWatchSeo: false }))
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
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    await act(async () => root.unmount())
    resetWatchAccountSessionSignalForTests()
    root = createRoot(container)
    await act(async () => {
      root.render(
        <WatchSeoAdminBoundary
          videoSlug="jesus-2"
          locale="en"
          languageSlug="english"
        />,
      )
      publishWatchAccountSessionSignal({ status: "authenticated" })
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(container.querySelector('[role="tab"]')).toBeNull()
  })
})
