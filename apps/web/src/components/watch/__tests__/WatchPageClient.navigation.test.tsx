/**
 * @vitest-environment jsdom
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}))

const { routerPushMock, routerPrefetchMock, shareModalProps, watchPlayer } =
  vi.hoisted(() => ({
    routerPrefetchMock: vi.fn(),
    routerPushMock: vi.fn(),
    shareModalProps: [] as Array<{
      currentLanguageSlug: string
      onClose: () => void
      open: boolean
      videoSlug: string
    }>,
    watchPlayer: {
      paused: false,
      pause: vi.fn(),
      play: vi.fn(() => Promise.resolve()),
    },
  }))

vi.mock("next/dynamic", () => {
  let modalIndex = 0

  return {
    default: () => {
      const index = modalIndex++
      if (index !== 2) return () => null

      return (props: (typeof shareModalProps)[number]) => {
        shareModalProps.push(props)
        return props.open ? (
          <button
            type="button"
            data-testid="watch-share-modal"
            onClick={props.onClose}
          >
            Close Share
          </button>
        ) : null
      }
    },
  }
})

vi.mock("next/navigation", () => ({
  useRouter: () => ({ prefetch: routerPrefetchMock, push: routerPushMock }),
}))

vi.mock("@/components/FloatingSearchProvider", () => ({
  useFloatingSearchPinned: () => ({ searchOpen: false }),
}))

vi.mock("@/components/watch/SubtitleTranscript", () => ({
  SubtitleTranscript: () => null,
}))

vi.mock("@/components/watch/WatchQuestionPanel", () => ({
  WatchQuestionPanel: () => null,
}))

vi.mock("@/components/watch/WatchSectionRenderer", () => ({
  WatchSectionRenderer: ({
    pendingChapter,
    coverBlackoutKey,
    onPlayerActivated,
    onPlayerReady,
    onChapterNavigateIntent,
    modalCallbacks,
    shareHref,
  }: {
    pendingChapter?: {
      targetVideoDocumentId: string
      title: string | null
      posterUrl: string | null
    } | null
    coverBlackoutKey?: string | null
    onPlayerActivated?: () => void
    onPlayerReady?: (player: typeof watchPlayer) => void
    onChapterNavigateIntent?: (intent: {
      href: string
      languageSlug: string
      sourceVideoDocumentId: string
      targetVideoDocumentId: string
      title: string | null
      slug: string
      label: string | null
      posterUrl: string | null
      sourceCarouselIndex?: number | null
    }) => void
    modalCallbacks: { openShare: () => void }
    shareHref?: string
  }) => (
    <>
      <button
        type="button"
        data-testid="watch-section-renderer"
        data-pending-target={pendingChapter?.targetVideoDocumentId ?? ""}
        data-pending-title={pendingChapter?.title ?? ""}
        data-pending-poster={pendingChapter?.posterUrl ?? ""}
        data-cover-blackout-key={coverBlackoutKey ?? ""}
        onClick={() => {
          onChapterNavigateIntent?.({
            href: "/parent.html/child-2/english.html",
            languageSlug: "english",
            sourceVideoDocumentId: "video-1",
            targetVideoDocumentId: "child-2",
            title: "Clicked Child",
            slug: "child-2",
            label: "SEGMENT",
            posterUrl: "https://cdn.test/clicked.jpg",
            sourceCarouselIndex: 3,
          })
        }}
      >
        Renderer
      </button>
      <button
        type="button"
        data-testid="watch-section-renderer-selectable-parent"
        onClick={() => {
          onChapterNavigateIntent?.({
            href: "/second-parent.html/shared-child/english.html",
            languageSlug: "english",
            sourceVideoDocumentId: "video-1",
            targetVideoDocumentId: "shared-child",
            title: "Shared Child",
            slug: "shared-child",
            label: "SEGMENT",
            posterUrl: null,
            sourceCarouselIndex: 1,
          })
        }}
      >
        Selectable parent chapter
      </button>
      <button
        type="button"
        data-testid="activate-player"
        onClick={() => onPlayerActivated?.()}
      >
        Activate player
      </button>
      <button
        type="button"
        data-testid="set-watch-player"
        onClick={() => onPlayerReady?.(watchPlayer)}
      >
        Set player
      </button>
      <button
        type="button"
        data-testid="open-share"
        data-share-href={shareHref ?? ""}
        onClick={modalCallbacks.openShare}
      >
        Share
      </button>
    </>
  ),
}))

vi.mock("@/lib/watch-interaction-loader", () => ({
  getCachedWatchLanguageOptions: () => null,
  loadWatchInteraction: vi.fn(async () => undefined),
  loadWatchLanguageOptionsForVideo: vi.fn(async () => []),
}))

import { WatchPageClient } from "@/components/watch/WatchPageClient"
import {
  WATCH_MODAL_CLOSE_DELAY_MS,
  WatchModalActivityProvider,
  usePauseForWatchModal,
} from "@/components/watch/WatchModalActivityProvider"
import { WATCH_CHAPTER_CAROUSEL_PRESERVE_KEY } from "@/components/watch/chapter-navigation"
import type { MergedWatchBlock, WatchSiblingCarouselBlock } from "@/lib/content"

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  routerPushMock.mockClear()
  routerPrefetchMock.mockClear()
  shareModalProps.length = 0
  watchPlayer.pause.mockClear()
  watchPlayer.play.mockClear()
  Object.defineProperty(window, "fetch", {
    configurable: true,
    value: vi.fn(async () => ({
      text: vi.fn(async () => ""),
    })),
  })
  window.sessionStorage.clear()
  window.history.replaceState({}, "", "/watch/current-video.html/english.html")
  Object.defineProperty(window, "scrollY", {
    configurable: true,
    value: 0,
  })
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  vi.useRealTimers()
  act(() => {
    root.unmount()
  })
  container.remove()
})

function makeVariant() {
  return {
    documentId: "variant-1",
    duration: 60,
    downloads: [],
    language: { slug: "english", name: "English" },
    muxVideo: { playbackId: "playback-1" },
  } as never
}

function makeVideo(documentId = "video-1", title = "Current Video") {
  return {
    documentId,
    slug: "current-video",
    title,
    snippet: null,
    description: null,
    images: [],
    variants: [],
    subtitles: [],
  } as never
}

function makeBlocks(): MergedWatchBlock[] {
  return [
    {
      kind: "SiblingCarousel",
      currentVideoDocumentId: "video-1",
      canonicalParent: {
        documentId: "parent-1",
        slug: "parent",
        title: "Parent",
        children: [
          {
            documentId: "video-1",
            slug: "current-video",
            title: "Current Video",
            label: "SEGMENT",
            images: [],
          },
          {
            documentId: "child-2",
            slug: "child-2",
            title: "Clicked Child",
            label: "SEGMENT",
            images: [{ thumbnail: "https://cdn.test/clicked.jpg" }],
          },
        ],
      },
    } as never,
  ]
}

function makeSelectableBlocks(): MergedWatchBlock[] {
  const blocks = makeBlocks()
  const carousel = blocks[0] as WatchSiblingCarouselBlock
  const sharedChild = {
    documentId: "shared-child",
    slug: "shared-child",
    title: "Shared Child",
    label: "SEGMENT",
    images: [],
  }
  carousel.canonicalParent.children.push(sharedChild as never)
  carousel.selectableParents = [
    carousel.canonicalParent,
    {
      documentId: "parent-2",
      slug: "second-parent",
      title: "Second Parent",
      children: [carousel.canonicalParent.children[0]!, sharedChild as never],
    },
  ]
  return blocks
}

function SharedWatchPlayerOwner() {
  usePauseForWatchModal(watchPlayer)
  return null
}

function renderWatchPage(
  video = makeVideo(),
  mergedBlocks: MergedWatchBlock[] = makeBlocks(),
  collectionSlug: string | null = null,
) {
  act(() => {
    root.render(
      <WatchModalActivityProvider>
        <SharedWatchPlayerOwner />
        <WatchPageClient
          mergedBlocks={mergedBlocks}
          variant={makeVariant()}
          video={video}
          languageSlug="english"
          collectionSlug={collectionSlug}
        />
      </WatchModalActivityProvider>,
    )
  })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

async function clickChapterAndFlushNavigation() {
  const renderer = () =>
    container.querySelector('[data-testid="watch-section-renderer"]')

  act(() => {
    ;(renderer() as HTMLButtonElement).click()
  })
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe("WatchPageClient chapter navigation", () => {
  it("accepts an exact pending route from a non-default selectable parent", async () => {
    renderWatchPage(makeVideo(), makeSelectableBlocks())

    const renderer = () =>
      container.querySelector('[data-testid="watch-section-renderer"]')
    act(() => {
      ;(
        container.querySelector(
          '[data-testid="watch-section-renderer-selectable-parent"]',
        ) as HTMLButtonElement
      ).click()
    })

    expect(renderer()?.getAttribute("data-pending-target")).toBe("shared-child")
    expect(window.fetch).toHaveBeenCalledWith(
      "/second-parent.html/shared-child/english.html",
      expect.objectContaining({ credentials: "same-origin" }),
    )
    expect(routerPrefetchMock).toHaveBeenCalledWith(
      "/second-parent.html/shared-child/english.html",
    )

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(routerPushMock).toHaveBeenCalledWith(
      "/second-parent.html/shared-child/english.html",
      { scroll: false },
    )
  })

  it("validates pending chapter state and self-invalidates after route commit", async () => {
    renderWatchPage()

    const renderer = () =>
      container.querySelector('[data-testid="watch-section-renderer"]')

    expect(renderer()?.getAttribute("data-pending-title")).toBe("")
    expect(renderer()?.getAttribute("data-cover-blackout-key")).toBe("")

    act(() => {
      ;(renderer() as HTMLButtonElement).click()
    })

    expect(window.fetch).toHaveBeenCalledWith(
      "/parent.html/child-2/english.html",
      expect.objectContaining({ credentials: "same-origin" }),
    )
    expect(routerPrefetchMock).toHaveBeenCalledWith(
      "/parent.html/child-2/english.html",
    )
    expect(renderer()?.getAttribute("data-pending-target")).toBe("child-2")
    expect(renderer()?.getAttribute("data-pending-title")).toBe("Clicked Child")
    expect(renderer()?.getAttribute("data-pending-poster")).toBe(
      "https://cdn.test/clicked.jpg",
    )
    expect(renderer()?.getAttribute("data-cover-blackout-key")).toBe("")
    expect(routerPushMock).not.toHaveBeenCalled()

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(routerPushMock).toHaveBeenCalledWith(
      "/parent.html/child-2/english.html",
      {
        scroll: false,
      },
    )
    expect(
      JSON.parse(
        window.sessionStorage.getItem(WATCH_CHAPTER_CAROUSEL_PRESERVE_KEY) ??
          "{}",
      ),
    ).toEqual({
      languageSlug: "english",
      sourceVideoDocumentId: "video-1",
      targetVideoDocumentId: "child-2",
      sourceCarouselIndex: 3,
    })

    window.history.replaceState(
      {},
      "",
      "/watch/parent.html/child-2/english.html",
    )
    renderWatchPage(makeVideo("child-2", "Clicked Child"))

    expect(renderer()?.getAttribute("data-pending-target")).toBe("")
    expect(renderer()?.getAttribute("data-pending-title")).toBe("")
    expect(renderer()?.getAttribute("data-pending-poster")).toBe("")
  })

  it("waits for the background route warm before pushing", async () => {
    const response = deferred<{ text: () => Promise<string> }>()
    const body = deferred<string>()
    Object.defineProperty(window, "fetch", {
      configurable: true,
      value: vi.fn(() => response.promise),
    })
    renderWatchPage()

    const renderer = () =>
      container.querySelector('[data-testid="watch-section-renderer"]')

    act(() => {
      ;(renderer() as HTMLButtonElement).click()
    })

    expect(renderer()?.getAttribute("data-pending-target")).toBe("child-2")
    expect(renderer()?.getAttribute("data-cover-blackout-key")).toBe("")
    expect(routerPushMock).not.toHaveBeenCalled()

    await act(async () => {
      await Promise.resolve()
    })

    expect(routerPushMock).not.toHaveBeenCalled()

    response.resolve({ text: () => body.promise })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(routerPushMock).not.toHaveBeenCalled()

    body.resolve("")
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(routerPushMock).toHaveBeenCalledWith(
      "/parent.html/child-2/english.html",
      {
        scroll: false,
      },
    )
  })

  it("keeps scroll position stable for chapter clicks below the top", async () => {
    Object.defineProperty(window, "scrollY", {
      configurable: true,
      value: 240,
    })
    renderWatchPage()

    await clickChapterAndFlushNavigation()

    expect(routerPushMock).toHaveBeenCalledWith(
      "/parent.html/child-2/english.html",
      {
        scroll: false,
      },
    )
  })

  it("preserves autoplay across chapter clicks only after the player is activated", async () => {
    renderWatchPage()

    act(() => {
      ;(
        container.querySelector(
          '[data-testid="activate-player"]',
        ) as HTMLButtonElement
      ).click()
    })

    await clickChapterAndFlushNavigation()

    expect(routerPushMock).toHaveBeenCalledWith(
      "/parent.html/child-2/english.html?autoplay=1",
      {
        scroll: false,
      },
    )
  })

  it("opens Share through the page modal and restores active playback", () => {
    vi.useFakeTimers()
    renderWatchPage(makeVideo(), makeBlocks(), "parent")

    act(() => {
      ;(
        container.querySelector(
          '[data-testid="open-share"]',
        ) as HTMLButtonElement
      ).click()
    })

    const page = container.querySelector('[data-testid="watch-page-client"]')
    expect(page?.getAttribute("data-modal-state")).toBe("share")
    expect(watchPlayer.pause).toHaveBeenCalledTimes(1)
    expect(shareModalProps.at(-1)).toMatchObject({
      currentLanguageSlug: "english",
      open: true,
      videoSlug: "current-video",
    })
    expect(
      container
        .querySelector('[data-testid="open-share"]')
        ?.getAttribute("data-share-href"),
    ).toBe(
      "https://www.facebook.com/sharer/sharer.php?u=https%3A%2F%2Fwww.jesusfilm.org%2Fwatch%2Fcurrent-video.html%2Fenglish.html",
    )

    act(() => {
      ;(
        container.querySelector(
          '[data-testid="watch-share-modal"]',
        ) as HTMLButtonElement
      ).click()
    })
    act(() => {
      vi.advanceTimersByTime(WATCH_MODAL_CLOSE_DELAY_MS)
    })

    expect(page?.getAttribute("data-modal-state")).toBe("none")
    expect(watchPlayer.play).toHaveBeenCalledTimes(1)
  })
})
