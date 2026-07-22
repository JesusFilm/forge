// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { MediaLibraryBrowserData } from "@/app/dashboard/media/media-library-browser-data"
import type { WatchHomeProgram, WatchHomePromoItem } from "@/domain/blocks"
import type { VideoLibraryItem } from "./block-helpers"
import {
  WatchHomeProgrammingEditor,
  hasWatchHomePromoMaterialChangeWithoutNewId,
} from "./watch-home-programming-editor"

const mediaLibrary: MediaLibraryBrowserData = {
  rootLabel: "Library",
  folders: [],
  images: [
    {
      id: "poster-asset",
      displayName: "Watch promo poster",
      altText: null,
      mimeType: "image/webp",
      byteSize: "10 KB",
      previewUrl: "/api/media-assets/poster-asset/preview",
      updated: "2026-07-22",
      folderId: null,
      pathLabel: "Library",
    },
  ],
}

const videoLibrary: VideoLibraryItem[] = [
  {
    key: "video-db-1",
    title: "JESUS",
    description: null,
    id: "1_jf-0-0",
    label: "FEATURE_FILM",
    labelLabel: "Feature Film",
    sourceLabel: "Core",
    sourceTone: "success",
    dubs: "1 dub",
    updated: "2026-07-22",
    duration: "02:00:00",
    durationSeconds: 7_200,
    previewImageUrl: null,
    previewStreamUrl: "https://example.com/jesus.m3u8",
    hasGrounding: true,
  },
]

function program(): WatchHomeProgram {
  return {
    buckets: [
      { kind: "video", id: "classics", label: "Classics", items: [] },
      {
        kind: "promo",
        id: "promos",
        label: "Promos",
        items: [
          {
            id: "join-us",
            playbackId: "mux-join-us",
            posterAssetId: "poster-asset",
            title: "Join us",
          },
        ],
      },
    ],
    rotation: ["classics", "promos", "classics"],
  }
}

function mount(
  initialProgram: WatchHomeProgram | undefined,
  onChangeProgram = vi.fn(),
) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root: Root = createRoot(container)
  act(() => {
    root.render(
      <WatchHomeProgrammingEditor
        program={initialProgram}
        videoLibrary={videoLibrary}
        mediaLibrary={mediaLibrary}
        onChangeProgram={onChangeProgram}
      />,
    )
  })
  return {
    container,
    onChangeProgram,
    cleanup() {
      act(() => root.unmount())
      container.remove()
    },
  }
}

function button(root: ParentNode, label: string) {
  const candidate = Array.from(root.querySelectorAll("button")).find(
    (item) =>
      item.textContent?.trim() === label ||
      item.getAttribute("aria-label") === label,
  )
  if (!(candidate instanceof HTMLButtonElement)) {
    throw new Error(`Button not found: ${label}`)
  }
  return candidate
}

describe("WatchHomeProgrammingEditor", () => {
  let cleanup: (() => void) | undefined

  beforeEach(() => {
    ;(
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => {
    cleanup?.()
    cleanup = undefined
    document.body.innerHTML = ""
  })

  it("keeps a placement-only block unchanged until Create is explicitly applied and Cancel restores it", () => {
    const view = mount(undefined)
    cleanup = view.cleanup

    expect(view.container.textContent).toContain("placement-only block")
    expect(view.onChangeProgram).not.toHaveBeenCalled()

    act(() => button(view.container, "Create programming").click())
    expect(view.container.textContent).toContain("Repeating rotation")
    expect(view.onChangeProgram).not.toHaveBeenCalled()

    act(() => button(view.container, "Cancel changes").click())
    expect(view.container.textContent).toContain("placement-only block")
    expect(view.onChangeProgram).not.toHaveBeenCalled()
  })

  it("names referenced slots before atomically deleting a bucket and its rotation references", () => {
    const view = mount(program())
    cleanup = view.cleanup

    act(() => button(view.container, "Delete Classics bucket").click())
    expect(document.body.textContent).toContain(
      "removes 2 referenced rotation slots",
    )

    act(() => button(document.body, "Delete bucket and slots").click())
    act(() => button(view.container, "Apply programming").click())

    expect(view.onChangeProgram).toHaveBeenCalledTimes(1)
    expect(view.onChangeProgram).toHaveBeenCalledWith(
      expect.objectContaining({
        buckets: [expect.objectContaining({ id: "promos" })],
        rotation: ["promos"],
      }),
    )
  })

  it("uses the individual video picker and applies a stable Admin video ID", () => {
    const view = mount({
      buckets: [
        { kind: "video", id: "classics", label: "Classics", items: [] },
      ],
      rotation: ["classics"],
    })
    cleanup = view.cleanup

    act(() => button(view.container, "Add individual video").click())
    const videoRow = document.body.querySelector(
      '[data-testid="anchor-video-picker-row"][data-video-key="video-db-1"]',
    )
    expect(videoRow).not.toBeNull()
    act(() => (videoRow as HTMLButtonElement).click())
    act(() => button(view.container, "Apply programming").click())

    expect(view.onChangeProgram).toHaveBeenCalledWith(
      expect.objectContaining({
        buckets: [
          expect.objectContaining({
            items: [expect.objectContaining({ videoId: "video-db-1" })],
          }),
        ],
      }),
    )
  })

  it("keeps generated promo identities unique across video items", () => {
    const view = mount({
      buckets: [
        {
          kind: "video",
          id: "classics",
          label: "Classics",
          items: [{ id: "welcome-intro", videoId: "video-db-1" }],
        },
      ],
      rotation: ["classics"],
    })
    cleanup = view.cleanup

    act(() => button(view.container, "Add intro").click())

    const introId = Array.from(view.container.querySelectorAll("label"))
      .find((label) => label.textContent?.includes("Stable promo ID"))
      ?.querySelector("input")
    expect((introId as HTMLInputElement | undefined)?.value).toBe(
      "welcome-intro-2",
    )
  })

  it("warns when playback or destination changes under the same promo identity", () => {
    const original: WatchHomePromoItem = {
      id: "join-us",
      playbackId: "mux-old",
      posterAssetId: "poster-asset",
      title: "Join us",
      primaryAction: { label: "Join", href: "/join" },
    }

    expect(
      hasWatchHomePromoMaterialChangeWithoutNewId(original, {
        ...original,
        title: "New copy only",
        posterAssetId: "new-poster",
      }),
    ).toBe(false)
    expect(
      hasWatchHomePromoMaterialChangeWithoutNewId(original, {
        ...original,
        playbackId: "mux-new",
      }),
    ).toBe(true)
    expect(
      hasWatchHomePromoMaterialChangeWithoutNewId(original, {
        ...original,
        id: "join-us-v2",
        primaryAction: { label: "Join", href: "/new-destination" },
      }),
    ).toBe(false)
  })
})
