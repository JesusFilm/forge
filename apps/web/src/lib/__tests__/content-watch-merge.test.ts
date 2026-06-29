import { describe, expect, it } from "vitest"

import {
  buildBibleQuotesBlock,
  buildHeroBlock,
  buildShareBlock,
  buildSiblingCarouselBlock,
  buildStudyQuestionsBlock,
  buildWatchBodyBlock,
  isWatchBlock,
  mergeWatchExperience,
  WatchVideoError,
} from "@/lib/content"

// Test helpers — minimal shapes mirroring the Strapi fragment projections.
// We deliberately use `as never` casts to avoid coupling tests to gql.tada's
// generated types; the merge logic only reads a small subset of fields and
// the runtime shape is what matters for these unit tests.
function makeChild(documentId: string, slug: string, title: string) {
  return {
    documentId,
    slug,
    title,
    label: null,
    images: [{ url: `https://cdn.example/${slug}.jpg` }],
    durationSeconds: null,
    muxPlaybackId: null,
    muxThumbnailBlurDataUrl: null,
  }
}

function makeVariant(overrides: Record<string, unknown> = {}) {
  return {
    documentId: "variant-1",
    slug: "en",
    published: true,
    hls: "https://cdn.example/jesus.m3u8",
    duration: 7674,
    language: {
      coreId: "529",
      bcp47: "en",
      slug: "english",
      name: "English",
      nativeName: null,
    },
    downloads: [],
    muxVideo: { playbackId: "playback-id-123" },
    ...overrides,
  }
}

function makeParent(
  overrides: Partial<{
    documentId: string
    slug: string
    title: string
    children: ReturnType<typeof makeChild>[]
  }> = {},
) {
  return {
    documentId: "parent-1",
    slug: "jesus-collection",
    title: "Jesus Collection",
    children: [],
    ...overrides,
  }
}

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
    // videos (e.g. JESUS with 61 chapter segments). Default empty so the
    // builder falls back to canonicalParent.children — matching the existing
    // tests' assumption that the carousel is fed from sibling content.
    children: [],
    childDubLanguages: [],
    variants: [],
    subtitles: [],
    studyQuestions: [],
    bibleCitations: [],
    ...overrides,
  }
}

// `as never` to satisfy gql.tada's strict result types without dragging in
// the entire schema for unit tests; the merge function only inspects a thin
// surface (typename, slug, children length, etc.).
function asArgs(args: {
  video: ReturnType<typeof makeVideo>
  variant: ReturnType<typeof makeVariant>
  canonicalParent: ReturnType<typeof makeParent>
  experience?: { blocks?: unknown[] } | null
}) {
  return args as never
}

describe("mergeWatchExperience — auto-template fallback (Experience absent)", () => {
  it("emits all 6 synthetic slots when video has populated study questions and bible citations and >=2 siblings", () => {
    const video = makeVideo({
      studyQuestions: [
        { documentId: "sq-1", value: "Q1?", order: 1 },
        { documentId: "sq-2", value: "Q2?", order: 2 },
      ],
      bibleCitations: [
        {
          documentId: "bc-1",
          chapterStart: 1,
          chapterEnd: null,
          verseStart: 1,
          verseEnd: 5,
          order: 1,
          osisId: "John.1.1-John.1.5",
          bibleBook: { documentId: "bb-1", name: "John" },
        },
      ],
    })
    const variant = makeVariant()
    const canonicalParent = makeParent({
      children: [
        makeChild("video-1", "jesus", "Jesus"),
        makeChild("video-2", "the-beginning", "The Beginning"),
      ],
    })

    const merged = mergeWatchExperience(
      asArgs({ video, variant, canonicalParent }),
    )

    expect(merged.map((b) => isWatchBlock(b) && b.kind)).toEqual([
      "HeroPlayer",
      "SiblingCarousel",
      "WatchBody",
      "StudyQuestions",
      "BibleQuotes",
      "Share",
    ])
  })

  it("omits the SiblingCarousel block when canonicalParent has fewer than 2 children", () => {
    const video = makeVideo()
    const variant = makeVariant()
    const canonicalParent = makeParent({
      children: [makeChild("video-1", "jesus", "Jesus")],
    })

    const merged = mergeWatchExperience(
      asArgs({ video, variant, canonicalParent }),
    )

    expect(
      merged.some((b) => isWatchBlock(b) && b.kind === "SiblingCarousel"),
    ).toBe(false)
    // HeroPlayer + WatchBody + BibleQuotes (always-on promo) + Share are
    // present even with empty data — only SiblingCarousel + StudyQuestions
    // are omitted when their source data is missing.
    const kinds = merged
      .filter(isWatchBlock)
      .map((b) => (b as { kind: string }).kind)
    expect(kinds).toEqual(["HeroPlayer", "WatchBody", "BibleQuotes", "Share"])
  })

  it("omits the StudyQuestions block when video has empty studyQuestions[]", () => {
    const video = makeVideo({ studyQuestions: [] })
    const variant = makeVariant()
    const canonicalParent = makeParent({
      children: [
        makeChild("video-1", "jesus", "Jesus"),
        makeChild("video-2", "the-beginning", "The Beginning"),
      ],
    })

    const merged = mergeWatchExperience(
      asArgs({ video, variant, canonicalParent }),
    )

    expect(
      merged.some((b) => isWatchBlock(b) && b.kind === "StudyQuestions"),
    ).toBe(false)
  })

  it("always emits a BibleQuotes block (with empty citations) so the carousel's always-on promo card surfaces on every video page", () => {
    const video = makeVideo({ bibleCitations: [] })
    const variant = makeVariant()
    const canonicalParent = makeParent()

    const merged = mergeWatchExperience(
      asArgs({ video, variant, canonicalParent }),
    )

    const block = merged.find(
      (b) => isWatchBlock(b) && b.kind === "BibleQuotes",
    )
    expect(block).toBeDefined()
    expect(
      isWatchBlock(block!) && block.kind === "BibleQuotes"
        ? block.bibleCitations
        : null,
    ).toEqual([])
  })
})

describe("mergeWatchExperience — Experience overrides", () => {
  it("uses Experience-supplied synthetic HeroPlayer override + 5 auto-template slots", () => {
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
          osisId: "John.1.1-John.1.5",
          bibleBook: { documentId: "bb-1", name: "John" },
        },
      ],
    })
    const variant = makeVariant()
    const canonicalParent = makeParent({
      children: [
        makeChild("video-1", "jesus", "Jesus"),
        makeChild("video-2", "the-beginning", "The Beginning"),
      ],
    })

    const customHero = {
      kind: "HeroPlayer" as const,
      video: { ...video, title: "Custom Hero" },
      variant,
    }

    const merged = mergeWatchExperience(
      asArgs({
        video,
        variant,
        canonicalParent,
        experience: { blocks: [customHero] },
      }),
    )

    const heroBlock = merged.find(
      (b): b is typeof customHero =>
        isWatchBlock(b) && (b as { kind: string }).kind === "HeroPlayer",
    )
    expect(heroBlock).toBeDefined()
    expect(heroBlock?.video.title).toBe("Custom Hero")
    // All 6 slots still present.
    expect(merged).toHaveLength(6)
  })

  it("fills the BibleQuotes slot via delegation when Experience supplies ComponentSectionsBibleQuotesCarousel", () => {
    const video = makeVideo({
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
        },
      ],
    })
    const variant = makeVariant()
    const canonicalParent = makeParent()
    const customQuotes = {
      __typename: "ComponentSectionsBibleQuotesCarousel",
      id: "bqc-1",
      sectionKey: "custom-quotes",
      heading: "Custom heading",
      quotes: [],
    }

    const merged = mergeWatchExperience(
      asArgs({
        video,
        variant,
        canonicalParent,
        experience: { blocks: [customQuotes] },
      }),
    )

    // No synthetic BibleQuotes block — the Strapi override took its slot.
    expect(
      merged.some((b) => isWatchBlock(b) && b.kind === "BibleQuotes"),
    ).toBe(false)
    // The override is in the merged array.
    const overrideEntry = merged.find(
      (b) =>
        !isWatchBlock(b) &&
        (b as { __typename?: string }).__typename ===
          "ComponentSectionsBibleQuotesCarousel",
    )
    expect(overrideEntry).toBeDefined()
  })

  it("sparse Experience supplying only RelatedQuestions wins StudyQuestions slot; auto-template fills the other 5", () => {
    const video = makeVideo({
      studyQuestions: [
        { documentId: "sq-1", value: "Q1?", order: 1 },
        { documentId: "sq-2", value: "Q2?", order: 2 },
      ],
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
        },
      ],
    })
    const variant = makeVariant()
    const canonicalParent = makeParent({
      children: [
        makeChild("video-1", "jesus", "Jesus"),
        makeChild("video-2", "the-beginning", "The Beginning"),
      ],
    })
    const relatedQuestions = {
      __typename: "ComponentSectionsRelatedQuestions",
      id: "rq-1",
      sectionKey: "related",
      heading: "Related",
      ctaLabel: null,
      ctaLink: null,
      questions: [],
    }

    const merged = mergeWatchExperience(
      asArgs({
        video,
        variant,
        canonicalParent,
        experience: { blocks: [relatedQuestions] },
      }),
    )

    // Synthetic StudyQuestions is suppressed by the Experience override.
    expect(
      merged.some((b) => isWatchBlock(b) && b.kind === "StudyQuestions"),
    ).toBe(false)
    // RelatedQuestions occupies the StudyQuestions slot, in slot-order
    // position 4 (HeroPlayer, SiblingCarousel, WatchBody, StudyQuestions=RQ,
    // BibleQuotes, Share).
    expect((merged[3] as { __typename?: string }).__typename).toBe(
      "ComponentSectionsRelatedQuestions",
    )
    // All 6 slots still represented.
    expect(merged).toHaveLength(6)
  })

  it("appends non-slot Strapi blocks (e.g. PromoBanner) after the 6 watch slots", () => {
    const video = makeVideo()
    const variant = makeVariant()
    const canonicalParent = makeParent()
    const promo = {
      __typename: "ComponentSectionsPromoBanner",
      id: "promo-1",
    }

    const merged = mergeWatchExperience(
      asArgs({
        video,
        variant,
        canonicalParent,
        experience: { blocks: [promo] },
      }),
    )

    // 4 always-present synthetic blocks (HeroPlayer + WatchBody + BibleQuotes
    // + Share) + 1 passthrough Strapi block.
    expect(merged).toHaveLength(5)
    expect(
      (merged[merged.length - 1] as { __typename?: string }).__typename,
    ).toBe("ComponentSectionsPromoBanner")
  })
})

describe("mergeWatchExperience — HeroPlayer slot type-restriction", () => {
  it.each([
    "ComponentSectionsVideoHero",
    "ComponentSectionsVideo",
    "ComponentSectionsVideoCarousel",
  ])(
    "throws WatchVideoError(INVALID_HERO_PLAYER_BLOCK) when Experience supplies %s",
    (typename) => {
      const video = makeVideo()
      const variant = makeVariant()
      const canonicalParent = makeParent()
      const block = { __typename: typename, id: "x" }

      expect(() =>
        mergeWatchExperience(
          asArgs({
            video,
            variant,
            canonicalParent,
            experience: { blocks: [block] },
          }),
        ),
      ).toThrowError(WatchVideoError)

      try {
        mergeWatchExperience(
          asArgs({
            video,
            variant,
            canonicalParent,
            experience: { blocks: [block] },
          }),
        )
      } catch (err) {
        expect(err).toBeInstanceOf(WatchVideoError)
        expect((err as WatchVideoError).code).toBe("INVALID_HERO_PLAYER_BLOCK")
        expect((err as WatchVideoError).message).toContain(
          "HeroPlayer slot accepts only the watch-page Mux Player",
        )
      }
    },
  )
})

describe("buildSiblingCarouselBlock — virtualParent branch (parent/collection videos)", () => {
  it("synthesizes a virtual parent from video.children when video has >= 2 own children", () => {
    const ownChildren = [
      makeChild("chapter-1", "chapter-1", "Chapter 1"),
      makeChild("chapter-2", "chapter-2", "Chapter 2"),
      makeChild("chapter-3", "chapter-3", "Chapter 3"),
    ]
    const video = makeVideo({
      documentId: "jesus-parent",
      slug: "jesus",
      title: "JESUS",
      children: ownChildren,
    })

    const block = buildSiblingCarouselBlock(null, video as never)

    expect(block).not.toBeNull()
    // (a) canonicalParent identity comes from the current video.
    expect(block!.canonicalParent.documentId).toBe(video.documentId)
    // (b) canonicalParent.children matches video.children content. Deep
    // equality, not reference equality — the builder filters nulls out so
    // it allocates a fresh array even when no entries are dropped.
    expect(block!.canonicalParent.children).toEqual(ownChildren)
    expect(block!.canonicalParent.children).toHaveLength(ownChildren.length)
    // (c) currentVideoDocumentId === video.documentId — no child can match,
    // so the "Playing now" badge never fires for the parent-page view.
    expect(block!.currentVideoDocumentId).toBe(video.documentId)
    expect(
      ownChildren.some((c) => c.documentId === block!.currentVideoDocumentId),
    ).toBe(false)
  })

  it("prefers video.children over canonicalParent.children when both are populated", () => {
    const ownChildren = [
      makeChild("chapter-1", "chapter-1", "Chapter 1"),
      makeChild("chapter-2", "chapter-2", "Chapter 2"),
    ]
    const video = makeVideo({
      documentId: "jesus-parent",
      slug: "jesus",
      title: "JESUS",
      children: ownChildren,
    })
    const canonicalParent = makeParent({
      children: [
        makeChild("sibling-a", "sibling-a", "Sibling A"),
        makeChild("sibling-b", "sibling-b", "Sibling B"),
      ],
    })

    const block = buildSiblingCarouselBlock(
      canonicalParent as never,
      video as never,
    )

    expect(block).not.toBeNull()
    // The video's own children win — virtual-parent identity is video.documentId.
    expect(block!.canonicalParent.documentId).toBe(video.documentId)
    expect(block!.canonicalParent.children).toEqual(ownChildren)
  })
})

describe("Auto-template builders return null on empty data", () => {
  it("buildSiblingCarouselBlock returns null when children.length < 2", () => {
    const parent = makeParent({
      children: [makeChild("v", "v", "V")],
    })
    expect(
      buildSiblingCarouselBlock(parent as never, makeVideo() as never),
    ).toBe(null)
  })

  it("buildStudyQuestionsBlock returns null on empty array", () => {
    expect(buildStudyQuestionsBlock([] as never)).toBe(null)
    expect(buildStudyQuestionsBlock(null as never)).toBe(null)
  })

  it("buildBibleQuotesBlock always returns a block (empty citations array) so the always-on promo CTA surfaces", () => {
    const fromEmpty = buildBibleQuotesBlock([] as never)
    expect(fromEmpty).not.toBeNull()
    expect(fromEmpty?.kind).toBe("BibleQuotes")
    expect(fromEmpty?.bibleCitations).toEqual([])
    const fromNull = buildBibleQuotesBlock(null as never)
    expect(fromNull).not.toBeNull()
    expect(fromNull?.kind).toBe("BibleQuotes")
    expect(fromNull?.bibleCitations).toEqual([])
  })

  it("buildHeroBlock, buildWatchBodyBlock, buildShareBlock never return null", () => {
    const video = makeVideo()
    const variant = makeVariant()
    expect(buildHeroBlock(video as never, variant as never).kind).toBe(
      "HeroPlayer",
    )
    expect(buildWatchBodyBlock(video as never, variant as never).kind).toBe(
      "WatchBody",
    )
    expect(buildShareBlock(video as never).kind).toBe("Share")
  })
})
