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
    onChapterNavigateIntent,
  }: {
    pendingChapter?: {
      targetVideoDocumentId: string
      title: string | null
      posterUrl: string | null
    } | null
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
      onClick={() => {
        onChapterNavigateIntent?.({
          href: "/child-2.html/english.html",
          languageSlug: "english",
          sourceVideoDocumentId: "video-1",
          targetVideoDocumentId: "child-2",
          title: "Clicked Child",
          slug: "child-2",
          label: "SEGMENT",
          posterUrl: "https://cdn.test/clicked.jpg",
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
  scheduleWatchInteractionWarmup: vi.fn(() => vi.fn()),
}))

import { WatchPageClient } from "@/components/watch/WatchPageClient"
import type { MergedWatchBlock } from "@/lib/content"

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
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

describe("WatchPageClient chapter navigation", () => {
  it("validates pending chapter state and self-invalidates after route commit", () => {
    renderWatchPage()

    const renderer = () =>
      container.querySelector('[data-testid="watch-section-renderer"]')

    expect(renderer()?.getAttribute("data-pending-title")).toBe("")

    act(() => {
      ;(renderer() as HTMLButtonElement).click()
    })

    expect(renderer()?.getAttribute("data-pending-target")).toBe("child-2")
    expect(renderer()?.getAttribute("data-pending-title")).toBe("Clicked Child")
    expect(renderer()?.getAttribute("data-pending-poster")).toBe(
      "https://cdn.test/clicked.jpg",
    )

    renderWatchPage(makeVideo("child-2", "Clicked Child"))

    expect(renderer()?.getAttribute("data-pending-target")).toBe("")
    expect(renderer()?.getAttribute("data-pending-title")).toBe("")
    expect(renderer()?.getAttribute("data-pending-poster")).toBe("")
  })
})
