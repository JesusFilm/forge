/**
 * @vitest-environment jsdom
 *
 * U4 — WatchSectionRenderer dispatch tests.
 *
 * Verifies:
 * - Synthetic blocks render placeholder stubs with correct `data-block-type`.
 * - Strapi blocks delegate to `ExperienceSectionRenderer` (mocked here so we
 *   don't depend on the upstream renderer's full type surface).
 * - Synthetic blocks deliberately do NOT enter `ExperienceSectionRenderer`'s
 *   switch — verified by asserting the mock is only called for Strapi blocks.
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Stub the admin Apollo client so the jsdom test environment doesn't trip
// t3-env's server-only guard on `WEB_ADMIN_API_KEYS` when content.ts loads.
vi.mock("@/lib/admin-client", () => ({
  default: { query: vi.fn() },
}))

const {
  experienceSectionRendererMock,
  heroPlayerMock,
  siblingCarouselMock,
  watchBodyMock,
  watchStudyQuestionsMock,
  bibleQuotesSectionMock,
} = vi.hoisted(() => ({
  experienceSectionRendererMock: vi.fn(
    ({ section }: { section: { __typename?: string } }) =>
      `STRAPI:${section.__typename ?? "unknown"}`,
  ),
  // U5 — `WatchSectionRenderer` now mounts the real `<HeroPlayer>` instead of
  // a `data-block-type="HeroPlayer"` placeholder div. We mock it here so this
  // dispatch test stays focused on the switch behavior; HeroPlayer's own
  // tests live in `HeroPlayer.test.tsx`.
  heroPlayerMock: vi.fn(
    ({
      block,
      optimisticVisual,
      onShareClick,
    }: {
      block: {
        variant: {
          muxVideo?: { playbackId?: string } | null
          hls?: string | null
        }
        video: { documentId: string }
      }
      optimisticVisual?: {
        title: string | null
        label: string | null
        posterUrl: string | null
        loading?: boolean
        transitionKey?: string | null
      } | null
      onShareClick?: () => void
    }) => {
      // Mirror the original placeholder's data attributes so the renderer
      // contract assertions below (data-block-type + data-content JSON
      // shape) still hold for the dispatch test.
      const content = JSON.stringify({
        videoDocumentId: block.video.documentId,
        playbackId: block.variant.muxVideo?.playbackId ?? null,
        hls: block.variant.hls ?? null,
        optimisticVisual: optimisticVisual ?? null,
      })
      return (
        <div data-block-type="HeroPlayer" data-content={content}>
          HeroPlayer mock
          {onShareClick ? (
            <button
              type="button"
              data-testid="hero-player-share-proxy"
              onClick={onShareClick}
            >
              Share
            </button>
          ) : null}
        </div>
      )
    },
  ),
  // U6 — Same pattern as HeroPlayer: SiblingCarousel mounts embla, which
  // jsdom can't drive (no matchMedia). The dispatch test only cares that
  // the wrapper carries `data-block-type="SiblingCarousel"`; SiblingCarousel's
  // own behavior is covered in `SiblingCarousel.test.tsx`.
  siblingCarouselMock: vi.fn(
    ({
      block,
      languageSlug,
      pendingNavigation,
    }: {
      block: {
        canonicalParent: {
          slug: string
          children?: Array<unknown> | null
        }
        currentVideoDocumentId: string
      }
      languageSlug?: string
      pendingNavigation?: { targetVideoDocumentId: string } | null
    }) => {
      const content = JSON.stringify({
        parentSlug: block.canonicalParent.slug,
        currentVideoDocumentId: block.currentVideoDocumentId,
        childCount: (block.canonicalParent.children ?? []).length,
        languageSlug: languageSlug ?? null,
        pendingTargetVideoDocumentId:
          pendingNavigation?.targetVideoDocumentId ?? null,
      })
      return (
        <div data-block-type="SiblingCarousel" data-content={content}>
          SiblingCarousel mock
        </div>
      )
    },
  ),
  // U7 — WatchBody renders a two-column layout that pulls in next/image-free
  // primitives, but the integration assertion only cares that the slot
  // produced a `data-block-type="WatchBody"` element (and that
  // studyQuestions were threaded in). A thin mock keeps this dispatch test
  // focused; full WatchBody behavior lives in `WatchBody.test.tsx`.
  watchBodyMock: vi.fn(
    ({
      block,
      studyQuestions,
      optimisticTitle,
    }: {
      block: { video: { documentId: string; title?: string | null } }
      studyQuestions: { studyQuestions: Array<unknown> } | null
      optimisticTitle?: string | null
    }) => {
      const content = JSON.stringify({
        videoDocumentId: block.video.documentId,
        title: block.video.title ?? null,
        optimisticTitle: optimisticTitle ?? null,
        studyQuestionCount: studyQuestions?.studyQuestions.length ?? 0,
      })
      return (
        <div data-block-type="WatchBody" data-content={content}>
          WatchBody mock
        </div>
      )
    },
  ),
  // U7 — WatchStudyQuestions has its own test file. Mocked here so the
  // dispatch test doesn't depend on its internal markup.
  watchStudyQuestionsMock: vi.fn(() => (
    <div data-block-type="WatchStudyQuestionsInline">WSQ mock</div>
  )),
  // U8 — BibleQuotesSection mounts the real `<ShareButton>` (and would
  // run `formatCitation()` per item). Mocked here so the dispatch test
  // stays focused on the switch behavior; its own behavior is covered
  // in `BibleQuotesSection.test.tsx`. The mock mirrors the original
  // placeholder's `data-block-type` and `data-content` shape so the
  // U4 contract assertions still hold.
  bibleQuotesSectionMock: vi.fn(
    ({
      bibleCitations,
      passages = [],
    }: {
      bibleCitations: Array<unknown>
      onShareClick: () => void
      passages?: Array<unknown>
    }) => {
      const content = JSON.stringify({
        count: bibleCitations.length,
        passageCount: passages.length,
      })
      return (
        <div data-block-type="BibleQuotes" data-content={content}>
          BibleQuotesSection mock
        </div>
      )
    },
  ),
}))

vi.mock("@/components/sections", () => ({
  ExperienceSectionRenderer: experienceSectionRendererMock,
}))

vi.mock("@/components/watch/HeroPlayer", () => ({
  HeroPlayer: heroPlayerMock,
}))

vi.mock("@/components/watch/SiblingCarousel", () => ({
  SiblingCarousel: siblingCarouselMock,
}))

vi.mock("@/components/watch/WatchBody", () => ({
  WatchBody: watchBodyMock,
}))

vi.mock("@/components/watch/WatchStudyQuestions", () => ({
  WatchStudyQuestions: watchStudyQuestionsMock,
}))

vi.mock("@/components/watch/BibleQuotesSection", () => ({
  BibleQuotesSection: bibleQuotesSectionMock,
}))

import {
  buildBibleQuotesBlock,
  buildHeroBlock,
  buildShareBlock,
  buildSiblingCarouselBlock,
  buildStudyQuestionsBlock,
  buildWatchBodyBlock,
  type MergedWatchBlock,
} from "@/lib/content"

import { WatchSectionRenderer } from "@/components/watch/WatchSectionRenderer"

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  experienceSectionRendererMock.mockClear()
  heroPlayerMock.mockClear()
  siblingCarouselMock.mockClear()
  watchBodyMock.mockClear()
  watchStudyQuestionsMock.mockClear()
  bibleQuotesSectionMock.mockClear()
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

function makeVideo(overrides: Record<string, unknown> = {}) {
  return {
    documentId: "video-1",
    slug: "jesus",
    title: "Jesus",
    snippet: "snippet",
    description: "description",
    noIndex: false,
    label: null,
    imageAlt: null,
    images: [],
    primaryLanguage: { coreId: "529", bcp47: "en" },
    parents: [],
    // Top-level `children` powers the SiblingCarousel for parent/collection
    // videos (e.g. JESUS). Default empty so the builder falls back to the
    // canonicalParent.children path — mirrors content-watch-merge.test.ts.
    children: [],
    variants: [],
    studyQuestions: [],
    bibleCitations: [],
    ...overrides,
  } as never
}

function makeVariant() {
  return {
    documentId: "variant-1",
    slug: "en",
    published: true,
    hls: "https://cdn.example/jesus.m3u8",
    language: { coreId: "529", bcp47: "en", slug: "english", name: "English" },
    downloads: [],
    muxVideo: { playbackId: "playback-id-123" },
  } as never
}

function makeParent(childrenCount = 2) {
  return {
    documentId: "parent-1",
    slug: "jesus-collection",
    title: "Jesus Collection",
    children: Array.from({ length: childrenCount }, (_, i) => ({
      documentId: `child-${i + 1}`,
      slug: `child-${i + 1}`,
      title: `Child ${i + 1}`,
      label: null,
      images: [],
    })),
  } as never
}

describe("WatchSectionRenderer — synthetic block dispatch", () => {
  it("renders all 6 synthetic block-types with correct data-block-type attributes", () => {
    const video = makeVideo({
      studyQuestions: [{ documentId: "sq-1", value: "Q?", order: 1 }],
      bibleCitations: [
        {
          documentId: "bc-1",
          chapterStart: 1,
          chapterEnd: null,
          verseStart: 1,
          verseEnd: 5,
          order: 1,
          osisId: "John.1.1",
          bibleBook: { documentId: "bb-1", name: "John" },
          passage: {
            citationDocumentId: "bc-1",
            content: "Server passage text.",
            copyright: "Required attribution.",
            humanReference: "John 1:1",
            provider: "youversion",
            publisherUrl: null,
            reference: "JHN.1.1",
            versionAbbreviation: "BSB",
            versionId: 3034,
            versionTitle: "Berean Standard Bible",
          },
        },
      ],
    })
    const variant = makeVariant()
    const parent = makeParent(3)

    const blocks: MergedWatchBlock[] = [
      buildHeroBlock(video, variant),
      buildSiblingCarouselBlock(parent, video)!,
      buildWatchBodyBlock(video, variant),
      buildStudyQuestionsBlock(
        (video as { studyQuestions?: unknown[] }).studyQuestions as never,
      )!,
      buildBibleQuotesBlock(
        (video as { bibleCitations?: unknown[] }).bibleCitations as never,
      ),
      buildShareBlock(video),
    ]

    act(() => {
      root.render(
        <WatchSectionRenderer blocks={blocks} languageSlug="english" />,
      )
    })

    const rendered = Array.from(
      container.querySelectorAll("[data-block-type]"),
    ).map((el) => el.getAttribute("data-block-type"))
    // SiblingCarousel is dispatched again (the prior `return null` was
    // reverted once the chapter-children data path was wired up). The block
    // is still emitted by `mergeWatchExperience` and now produces DOM.
    expect(rendered).toEqual([
      "HeroPlayer",
      "SiblingCarousel",
      "WatchBody",
      "StudyQuestions",
      "BibleQuotes",
      "Share",
    ])
    // The block IS still emitted by `mergeWatchExperience` — protect that
    // contract so a future change to the merge layer doesn't silently drop it.
    expect(
      blocks.some((b) => "kind" in b && b.kind === "SiblingCarousel"),
    ).toBe(true)

    // Synthetic types must NOT delegate to ExperienceSectionRenderer.
    expect(experienceSectionRendererMock).not.toHaveBeenCalled()

    // SiblingCarousel must live INSIDE the watch-body-zone (the
    // frosted-glass body wrapper), not as a top-level sibling alongside
    // the sticky HeroPlayer. The carousel was originally rendered in the
    // top zone; demoting it into the body zone keeps it in normal flow
    // beneath the hero instead of scrolling over it. Guard that move
    // here so a future refactor doesn't silently regress.
    const bodyZone = container.querySelector("[data-testid='watch-body-zone']")
    expect(bodyZone).not.toBeNull()
    const bodyBackdrop = bodyZone!.querySelector(
      "[data-testid='watch-body-backdrop']",
    )
    expect(bodyBackdrop?.getAttribute("class")).toContain("w-full")
    expect(bodyBackdrop?.getAttribute("class")).toContain("overflow-visible")
    expect(bodyBackdrop?.getAttribute("class")).toContain("md:overflow-hidden")
    expect(bodyBackdrop?.getAttribute("class")).not.toContain("max-w-[1920px]")
    const siblingInsideBody = bodyZone!.querySelector(
      "[data-block-type='SiblingCarousel']",
    )
    expect(siblingInsideBody).not.toBeNull()
    const bodyTexture = bodyZone!.querySelector(
      "[data-testid='watch-body-texture']",
    )
    expect(bodyTexture?.getAttribute("class")).toContain("opacity-30")
    expect(bodyTexture?.getAttribute("style")).toContain(
      "/watch/images/overlay.svg",
    )
    const siblingEl = container.querySelector(
      '[data-block-type="SiblingCarousel"]',
    )
    const siblingContent = JSON.parse(
      siblingEl?.getAttribute("data-content") ?? "{}",
    )
    expect(siblingContent.languageSlug).toBe("english")
    const bibleQuotesEl = container.querySelector(
      '[data-block-type="BibleQuotes"]',
    )
    const bibleQuotesContent = JSON.parse(
      bibleQuotesEl?.getAttribute("data-content") ?? "{}",
    )
    expect(bibleQuotesContent).toEqual({
      count: 1,
      passageCount: 1,
    })
  })

  it("HeroPlayer placeholder serializes playbackId and hls into data-content", () => {
    const video = makeVideo()
    const variant = makeVariant()
    const block = buildHeroBlock(video, variant)

    act(() => {
      root.render(<WatchSectionRenderer blocks={[block]} />)
    })

    const heroEl = container.querySelector('[data-block-type="HeroPlayer"]')
    expect(heroEl).not.toBeNull()
    const content = JSON.parse(heroEl!.getAttribute("data-content") ?? "{}")
    expect(content.playbackId).toBe("playback-id-123")
    expect(content.hls).toBe("https://cdn.example/jesus.m3u8")
    expect(content.videoDocumentId).toBe("video-1")
  })

  it("passes the page Share modal callback to HeroPlayer", () => {
    const openShare = vi.fn()

    act(() => {
      root.render(
        <WatchSectionRenderer
          blocks={[buildHeroBlock(makeVideo(), makeVariant())]}
          modalCallbacks={{
            closeModal: vi.fn(),
            openDownload: vi.fn(),
            openLanguage: vi.fn(),
            openShare,
          }}
        />,
      )
    })

    const share = container.querySelector(
      '[data-testid="hero-player-share-proxy"]',
    ) as HTMLButtonElement
    expect(share).not.toBeNull()
    share.click()
    expect(openShare).toHaveBeenCalledTimes(1)
  })

  it("passes a pending chapter projection to hero, carousel, and body surfaces", () => {
    const video = makeVideo()
    const variant = makeVariant()
    const parent = makeParent(3)
    const blocks: MergedWatchBlock[] = [
      buildHeroBlock(video, variant),
      buildSiblingCarouselBlock(parent, video)!,
      buildWatchBodyBlock(video, variant),
    ]
    const pendingChapter = {
      href: "/child-2.html/english.html",
      languageSlug: "english",
      sourceVideoDocumentId: "video-1",
      targetVideoDocumentId: "child-2",
      title: "Clicked Child",
      slug: "child-2",
      label: "SEGMENT",
      posterUrl: "https://cdn.test/clicked.jpg",
    }

    act(() => {
      root.render(
        <WatchSectionRenderer
          blocks={blocks}
          languageSlug="english"
          pendingChapter={pendingChapter}
          onChapterNavigateIntent={vi.fn()}
        />,
      )
    })

    const heroContent = JSON.parse(
      container
        .querySelector('[data-block-type="HeroPlayer"]')
        ?.getAttribute("data-content") ?? "{}",
    )
    const carouselContent = JSON.parse(
      container
        .querySelector('[data-block-type="SiblingCarousel"]')
        ?.getAttribute("data-content") ?? "{}",
    )
    const bodyContent = JSON.parse(
      container
        .querySelector('[data-block-type="WatchBody"]')
        ?.getAttribute("data-content") ?? "{}",
    )

    expect(heroContent.optimisticVisual).toEqual({
      title: "Clicked Child",
      label: "SEGMENT",
      posterUrl: "https://cdn.test/clicked.jpg",
      posterBlurDataUrl: null,
      loading: true,
      transitionKey: "child-2",
    })
    expect(carouselContent.pendingTargetVideoDocumentId).toBe("child-2")
    expect(bodyContent.optimisticTitle).toBe("Clicked Child")
    expect(bodyContent.title).toBe("Jesus")
  })

  it("skips the synthetic BibleQuotes section when the watch hide flag is active", () => {
    const video = makeVideo({
      bibleCitations: [
        {
          bibleBook: { documentId: "bb-john", name: "John" },
          chapterEnd: null,
          chapterStart: 1,
          documentId: "bc-1",
          order: 1,
          osisId: "John.1.1",
          verseEnd: null,
          verseStart: 1,
        },
      ],
    })
    const blocks: MergedWatchBlock[] = [
      buildBibleQuotesBlock(
        (video as { bibleCitations?: unknown[] }).bibleCitations as never,
      ),
      buildShareBlock(video),
    ]

    act(() => {
      root.render(<WatchSectionRenderer blocks={blocks} hideBibleQuotes />)
    })

    expect(bibleQuotesSectionMock).not.toHaveBeenCalled()
    expect(
      container.querySelector('[data-block-type="BibleQuotes"]'),
    ).toBeNull()
    expect(container.querySelector('[data-block-type="Share"]')).not.toBeNull()
  })
})

describe("WatchSectionRenderer — Strapi block delegation", () => {
  it("delegates Strapi-typed blocks (e.g. PromoBanner) to ExperienceSectionRenderer", () => {
    const promo = {
      __typename: "ComponentSectionsPromoBanner",
      id: "promo-1",
    } as never

    act(() => {
      root.render(<WatchSectionRenderer blocks={[promo]} />)
    })

    expect(experienceSectionRendererMock).toHaveBeenCalledTimes(1)
    expect(experienceSectionRendererMock.mock.calls[0]?.[0]?.section).toBe(
      promo,
    )
    // The mock returns a marker string we can find in the DOM.
    expect(container.textContent).toContain(
      "STRAPI:ComponentSectionsPromoBanner",
    )
  })

  it("renders a mixed array — synthetic + Strapi — preserving order", () => {
    const video = makeVideo()
    const variant = makeVariant()
    const promo = {
      __typename: "ComponentSectionsPromoBanner",
      id: "promo-1",
    } as never

    const blocks: MergedWatchBlock[] = [
      buildHeroBlock(video, variant),
      buildWatchBodyBlock(video, variant),
      promo,
    ]

    act(() => {
      root.render(<WatchSectionRenderer blocks={blocks} />)
    })

    // 2 synthetic placeholders rendered.
    const synthetic = container.querySelectorAll("[data-block-type]")
    expect(synthetic.length).toBe(2)

    // 1 delegated Strapi call.
    expect(experienceSectionRendererMock).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain(
      "STRAPI:ComponentSectionsPromoBanner",
    )
  })
})
