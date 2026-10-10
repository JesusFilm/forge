// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { loadHistoryMock } = vi.hoisted(() => ({
  loadHistoryMock: vi.fn(),
}))

vi.mock("next/image", () => ({ default: () => null }))
vi.mock("@/lib/watch-progress-client", () => ({
  getWatchProgressRatio: () => 0.5,
  loadWatchProgressHistory: loadHistoryMock,
}))

import { WatchHistoryClient } from "./WatchHistoryClient"

describe("WatchHistoryClient video thumbnails", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    const updatedAt = Date.now()
    loadHistoryMock.mockResolvedValue({
      entries: [
        {
          videoId: "linked",
          positionSeconds: 30,
          durationSeconds: 60,
          updatedAt,
        },
        {
          videoId: "static",
          positionSeconds: 30,
          durationSeconds: 60,
          updatedAt,
        },
      ],
      videos: [
        {
          videoId: "linked",
          title: "Linked History",
          label: "Short film",
          href: "/linked.html",
          imageUrl: null,
          imageAlt: "Linked History",
          durationLabel: "1:00",
        },
        {
          videoId: "static",
          title: "Static History",
          label: "Short film",
          href: null,
          imageUrl: null,
          imageAlt: "Static History",
          durationLabel: "1:00",
        },
      ],
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.clearAllMocks()
  })

  it("shows the shared frame and play affordance only on routable rows", async () => {
    await act(async () => {
      root.render(<WatchHistoryClient />)
      await Promise.resolve()
    })

    const frame = container.querySelector<HTMLElement>(
      '[data-testid="watch-history-thumbnail-frame"]',
    )
    const linkedRow = frame?.closest("a")
    expect(linkedRow?.className).toContain("group")
    expect(linkedRow?.className).toContain("focus-visible:outline-none")
    expect(frame?.className).toContain("border-white")
    expect(frame?.className).toContain("group-hover:opacity-100")
    expect(frame?.className).toContain("group-focus-visible:opacity-100")

    const staticTitle = Array.from(container.querySelectorAll("h3")).find(
      (element) => element.textContent === "Static History",
    )
    const staticRow = staticTitle?.parentElement?.parentElement?.parentElement
    expect(staticTitle?.closest("a")).toBeNull()
    expect(staticRow?.className).not.toContain("hover:bg")
    expect(
      staticRow?.querySelector('[data-testid="watch-history-thumbnail-frame"]'),
    ).toBeNull()
    expect(staticRow?.querySelector("svg")).toBeNull()
  })
})
