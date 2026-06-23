// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { AnchorVideoPicker } from "./anchor-video-picker"
import type { VideoLibraryItem } from "./block-helpers"
;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

function makeVideo(overrides: Partial<VideoLibraryItem>): VideoLibraryItem {
  return {
    key: "video-1",
    title: "Untitled",
    description: null,
    id: "core-1",
    label: null,
    labelLabel: null,
    sourceLabel: "Core",
    sourceTone: "success",
    dubs: "1 dub",
    updated: "2026-06-01T00:00:00.000Z",
    duration: "10:00",
    durationSeconds: 600,
    previewImageUrl: null,
    previewStreamUrl: null,
    hasGrounding: false,
    ...overrides,
  }
}

function mount(node: React.ReactNode) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root: Root = createRoot(container)
  act(() => {
    root.render(node)
  })
  return {
    container,
    cleanup() {
      act(() => root.unmount())
      container.remove()
    },
  }
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set
  act(() => {
    setter?.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
    input.dispatchEvent(new Event("change", { bubbles: true }))
  })
}

function rowKeys(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll('[data-testid="anchor-video-picker-row"]'),
  ).map((el) => el.getAttribute("data-video-key") ?? "")
}

describe("AnchorVideoPicker", () => {
  let cleanup: (() => void) | null = null

  beforeEach(() => {
    cleanup = null
  })

  afterEach(() => {
    cleanup?.()
    cleanup = null
  })

  it("renders nothing when closed", () => {
    const view = mount(
      <AnchorVideoPicker
        videoLibrary={[makeVideo({})]}
        open={false}
        onClose={vi.fn()}
        onSelect={vi.fn()}
      />,
    )
    cleanup = view.cleanup
    expect(
      view.container.querySelector('[data-testid="anchor-video-picker"]'),
    ).toBeNull()
  })

  it("badges ready videos and sorts them ahead of non-ready ones (Covers AE2)", () => {
    const library = [
      makeVideo({
        key: "not-ready",
        title: "Plain Clip",
        previewStreamUrl: null,
        hasGrounding: false,
      }),
      makeVideo({
        key: "ready",
        title: "Grounded Film",
        previewStreamUrl: "https://example.com/v.m3u8",
        hasGrounding: true,
      }),
      makeVideo({
        key: "playable-only",
        title: "Playable Only",
        previewStreamUrl: "https://example.com/p.m3u8",
        hasGrounding: false,
      }),
    ]
    const view = mount(
      <AnchorVideoPicker
        videoLibrary={library}
        open
        onClose={vi.fn()}
        onSelect={vi.fn()}
      />,
    )
    cleanup = view.cleanup

    // Ready video sorts first even though it was listed second.
    expect(rowKeys(view.container)).toEqual([
      "ready",
      "not-ready",
      "playable-only",
    ])

    const badges = view.container.querySelectorAll(
      '[data-testid="anchor-video-picker-ready-badge"]',
    )
    expect(badges).toHaveLength(1)

    const readyRow = view.container.querySelector(
      '[data-video-key="ready"]',
    ) as HTMLElement
    expect(readyRow.getAttribute("data-ready")).toBe("true")
    const playableRow = view.container.querySelector(
      '[data-video-key="playable-only"]',
    ) as HTMLElement
    // Playable but not grounded is NOT ready.
    expect(playableRow.getAttribute("data-ready")).toBe("false")
  })

  it("filters by title and Core ID as the query changes", () => {
    const library = [
      makeVideo({ key: "a", title: "Resurrection", id: "core-aaa" }),
      makeVideo({ key: "b", title: "Nativity", id: "core-bbb" }),
    ]
    const view = mount(
      <AnchorVideoPicker
        videoLibrary={library}
        open
        onClose={vi.fn()}
        onSelect={vi.fn()}
      />,
    )
    cleanup = view.cleanup

    const search = view.container.querySelector(
      '[data-testid="anchor-video-picker-search"]',
    ) as HTMLInputElement

    setInputValue(search, "nativ")
    expect(rowKeys(view.container)).toEqual(["b"])

    setInputValue(search, "core-aaa")
    expect(rowKeys(view.container)).toEqual(["a"])
  })

  it("calls onSelect with the row item and then onClose when a row is clicked", () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()
    const target = makeVideo({ key: "pick-me", title: "Pick Me" })
    const view = mount(
      <AnchorVideoPicker
        videoLibrary={[target]}
        open
        onClose={onClose}
        onSelect={onSelect}
      />,
    )
    cleanup = view.cleanup

    const row = view.container.querySelector(
      '[data-video-key="pick-me"]',
    ) as HTMLButtonElement
    act(() => {
      row.click()
    })

    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect.mock.calls[0][0]).toMatchObject({ key: "pick-me" })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("lets a non-ready video be selected (badge is advisory, not a gate — supports R5)", () => {
    const onSelect = vi.fn()
    const target = makeVideo({
      key: "bare",
      previewStreamUrl: null,
      hasGrounding: false,
    })
    const view = mount(
      <AnchorVideoPicker
        videoLibrary={[target]}
        open
        onClose={vi.fn()}
        onSelect={onSelect}
      />,
    )
    cleanup = view.cleanup

    const row = view.container.querySelector(
      '[data-video-key="bare"]',
    ) as HTMLButtonElement
    expect(row.getAttribute("data-ready")).toBe("false")
    act(() => {
      row.click()
    })
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it("shows an empty state when the library is empty", () => {
    const view = mount(
      <AnchorVideoPicker
        videoLibrary={[]}
        open
        onClose={vi.fn()}
        onSelect={vi.fn()}
      />,
    )
    cleanup = view.cleanup
    expect(
      view.container.querySelector('[data-testid="anchor-video-picker-empty"]'),
    ).not.toBeNull()
    expect(rowKeys(view.container)).toEqual([])
  })
})
