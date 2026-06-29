/**
 * @vitest-environment jsdom
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next/dynamic", () => ({
  default: () => () => null,
}))

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}))

const { routerPushMock, routerPrefetchMock } = vi.hoisted(() => ({
  routerPrefetchMock: vi.fn(),
  routerPushMock: vi.fn(),
}))

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
    onChapterNavigateIntent,
  }: {
    pendingChapter?: {
      targetVideoDocumentId: string
      title: string | null
      posterUrl: string | null
    } | null
    coverBlackoutKey?: string | null
    onChapterNavigateIntent?: (intent: {
      href: string
      languageSlug: string
      sourceVideoDocumentId: string
      targetVideoDocumentId: string
      title: string | null
      slug: string
      label: string | null
      posterUrl: string | null
    }) => void
  }) => (
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
  ),
}))

vi.mock("@/lib/watch-interaction-loader", () => ({
  getCachedWatchLanguageOptions: () => null,
  loadWatchInteraction: vi.fn(async () => undefined),
  loadWatchLanguageOptionsForVideo: vi.fn(async () => []),
}))

import { WatchPageClient } from "@/components/watch/WatchPageClient"
import { WATCH_CHAPTER_CAROUSEL_PRESERVE_KEY } from "@/components/watch/chapter-navigation"
import type { MergedWatchBlock } from "@/lib/content"

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  routerPushMock.mockClear()
  routerPrefetchMock.mockClear()
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

function renderWatchPage(video = makeVideo()) {
  act(() => {
    root.render(
      <WatchPageClient
        mergedBlocks={makeBlocks()}
        variant={makeVariant()}
        video={video}
        languageSlug="english"
      />,
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
      "/parent.html/child-2/english.html?autoplay=1",
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
      "/parent.html/child-2/english.html?autoplay=1",
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
      "/parent.html/child-2/english.html?autoplay=1",
      {
        scroll: false,
      },
    )
  })
})
