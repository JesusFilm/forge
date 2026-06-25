/**
 * Bible Project headline acceptance test for admin keyword-first mode.
 *
 * The user-facing acceptance criterion: typing `"the bible project"`
 * should surface Bible Project videos in the top-N — not random
 * "project" or "bible" videos that happened to score high on
 * semantic similarity. This is the headline win of keyword-first mode
 * over R4 hybrid.
 *
 * Implemented as an orchestrator-level test against mocked retrievers
 * (matches cms feat-109's `search.bible-project.test.ts` pattern). Real-DB
 * verification against seeded fixtures is deferred to R0 readiness, same
 * posture as R4 + R5.
 */

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("./hybrid-search-retrievers", () => ({
  searchVideoSemantic: vi.fn(),
  searchVideoKeyword: vi.fn(),
  searchExperienceSemantic: vi.fn(),
  searchExperienceKeyword: vi.fn(),
}))

vi.mock("./hybrid-search-keyword-first-retrievers", () => ({
  searchByKeywordWeighted: vi.fn(),
  searchByTrigram: vi.fn(),
  searchByExactTitle: vi.fn(),
  MAX_EXACT_TITLE_TOKENS: 16,
  tokenizeForExactTitle: (q: string) =>
    q
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((t) => t.length > 0),
}))

import {
  searchVideoSemantic,
  searchVideoKeyword,
  searchExperienceSemantic,
  searchExperienceKeyword,
} from "./hybrid-search-retrievers"
import {
  searchByKeywordWeighted,
  searchByTrigram,
  searchByExactTitle,
} from "./hybrid-search-keyword-first-retrievers"
import { __resetSearchHealthForTest } from "./hybrid-search-health"
import {
  HybridSearchService,
  type QueryEmbedder,
} from "./hybrid-search.service"

const mockPrisma = {
  video: {
    // Default to empty hydration so card-pill enrichment (post-fusion
    // `prisma.video.findMany`) doesn't crash these tests.
    findMany: vi.fn().mockResolvedValue([]),
  },
  videoLocale: {
    findMany: vi.fn().mockResolvedValue([]),
  },
  $queryRaw: vi.fn().mockResolvedValue([]),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any
const successEmbedder = (): QueryEmbedder =>
  vi.fn().mockResolvedValue([0.1, 0.2, 0.3])

/**
 * Fixture set: 5 Bible Project videos, 3 unrelated "project" videos,
 * and 3 Bible-themed videos with the word "bible" only in description.
 *
 * Hybrid mode (concatenated tsvector) lets all 11 jockey on equal
 * tsvector footing; semantic similarity shuffles the order. The
 * dilution cap kicks in for keyword-first because there's a clear
 * lexical winner — "The Bible Project" titles satisfy
 * `tokenizeForExactTitle("the bible project")`.
 */

type Fixture = {
  resultId: string
  videoCoreId: string
  videoSlug: string
  videoTitle: string
  description: string
}

const BIBLE_PROJECT_VIDEOS: Fixture[] = [
  {
    resultId: "bp-1",
    videoCoreId: "bp-1-core",
    videoSlug: "bp-genesis",
    videoTitle: "The Bible Project: Genesis Overview",
    description: "Animated overview of Genesis",
  },
  {
    resultId: "bp-2",
    videoCoreId: "bp-2-core",
    videoSlug: "bp-exodus",
    videoTitle: "The Bible Project: Exodus Overview",
    description: "Animated overview of Exodus",
  },
  {
    resultId: "bp-3",
    videoCoreId: "bp-3-core",
    videoSlug: "bp-gospel",
    videoTitle: "The Bible Project: Gospel of Mark",
    description: "Animated overview of Mark",
  },
  {
    resultId: "bp-4",
    videoCoreId: "bp-4-core",
    videoSlug: "bp-john",
    videoTitle: "The Bible Project: Gospel of John",
    description: "Animated overview of John",
  },
  {
    resultId: "bp-5",
    videoCoreId: "bp-5-core",
    videoSlug: "bp-romans",
    videoTitle: "The Bible Project: Romans",
    description: "Animated overview of Romans",
  },
]

const PROJECT_VIDEOS: Fixture[] = [
  {
    resultId: "pj-1",
    videoCoreId: "pj-1-core",
    videoSlug: "school-project",
    videoTitle: "School Project Tips",
    description: "How to do a school project",
  },
  {
    resultId: "pj-2",
    videoCoreId: "pj-2-core",
    videoSlug: "code-project",
    videoTitle: "Code Project Walkthrough",
    description: "Walking through a code project",
  },
  {
    resultId: "pj-3",
    videoCoreId: "pj-3-core",
    videoSlug: "art-project",
    videoTitle: "Art Project Showcase",
    description: "Showcasing student art projects",
  },
]

const BIBLE_DESC_ONLY: Fixture[] = [
  {
    resultId: "bd-1",
    videoCoreId: "bd-1-core",
    videoSlug: "story-time",
    videoTitle: "Story Time",
    description: "A bible story for kids",
  },
  {
    resultId: "bd-2",
    videoCoreId: "bd-2-core",
    videoSlug: "lessons",
    videoTitle: "Sunday School Lessons",
    description: "Bible lessons for Sunday school",
  },
  {
    resultId: "bd-3",
    videoCoreId: "bd-3-core",
    videoSlug: "history",
    videoTitle: "Ancient History",
    description: "Ancient bible-era history overview",
  },
]

const ALL_FIXTURES = [
  ...BIBLE_PROJECT_VIDEOS,
  ...PROJECT_VIDEOS,
  ...BIBLE_DESC_ONLY,
]

function asKeywordWeighted(f: Fixture, rank: number) {
  return {
    resultType: "video" as const,
    resultId: f.resultId,
    videoCoreId: f.videoCoreId,
    videoSlug: f.videoSlug,
    videoTitle: f.videoTitle,
    imageUrl: null,
    description: f.description,
    rank,
  }
}

function asTrigram(f: Fixture, similarity: number) {
  return {
    resultType: "video" as const,
    resultId: f.resultId,
    videoCoreId: f.videoCoreId,
    videoSlug: f.videoSlug,
    videoTitle: f.videoTitle,
    imageUrl: null,
    description: f.description,
    similarity,
  }
}

function asExactTitle(f: Fixture, titleLength: number) {
  return {
    resultType: "video" as const,
    resultId: f.resultId,
    videoCoreId: f.videoCoreId,
    videoSlug: f.videoSlug,
    videoTitle: f.videoTitle,
    imageUrl: null,
    description: f.description,
    titleLength,
  }
}

function asSemantic(f: Fixture, similarity: number) {
  return {
    resultType: "video" as const,
    resultId: f.resultId,
    videoCoreId: f.videoCoreId,
    videoSlug: f.videoSlug,
    videoTitle: f.videoTitle,
    imageUrl: null,
    sceneDescription: `scene from ${f.videoTitle}`,
    startSeconds: 0,
    playbackId: `mux-${f.resultId}`,
    similarity,
    embeddingText: `[${Array.from({ length: 32 }, (_, j) =>
      f.resultId.charCodeAt(0) + j === j ? 1 : 0,
    ).join(",")}]`,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  __resetSearchHealthForTest()
  vi.mocked(searchExperienceSemantic).mockResolvedValue([])
  vi.mocked(searchExperienceKeyword).mockResolvedValue([])
  // Restore default hydration stub after clearAllMocks wipes it.
  mockPrisma.video.findMany.mockResolvedValue([])
  mockPrisma.videoLocale.findMany.mockResolvedValue([])
  mockPrisma.$queryRaw.mockResolvedValue([])
})

describe("Bible Project headline (keyword-first mode)", () => {
  it("returns Bible Project videos in the top results for q='the bible project'", async () => {
    // Semantic-video: noisy ranking — bible-desc-only and project-only
    // videos score reasonably alongside Bible Project videos.
    vi.mocked(searchVideoSemantic).mockResolvedValue([
      asSemantic(BIBLE_DESC_ONLY[0]!, 0.88),
      asSemantic(PROJECT_VIDEOS[0]!, 0.85),
      asSemantic(BIBLE_PROJECT_VIDEOS[0]!, 0.82),
      asSemantic(BIBLE_PROJECT_VIDEOS[1]!, 0.81),
      asSemantic(BIBLE_DESC_ONLY[1]!, 0.79),
      asSemantic(BIBLE_PROJECT_VIDEOS[2]!, 0.78),
      asSemantic(PROJECT_VIDEOS[1]!, 0.76),
    ])
    // Keyword-weighted (websearch_to_tsquery + weighted tsvector):
    // Bible Project videos clearly outrank because all three tokens
    // hit title (weight A) on every BP entry.
    vi.mocked(searchByKeywordWeighted).mockResolvedValue(
      BIBLE_PROJECT_VIDEOS.map((f, i) => asKeywordWeighted(f, 1 - i * 0.05)),
    )
    // Trigram (vl.title %>): same ranking — all BP titles share trigrams
    // with "the bible project".
    vi.mocked(searchByTrigram).mockResolvedValue(
      BIBLE_PROJECT_VIDEOS.map((f, i) => asTrigram(f, 0.6 - i * 0.05)),
    )
    // Exact title (tokens-in-title): only Bible Project rows satisfy
    // "the AND bible AND project" all in title.
    vi.mocked(searchByExactTitle).mockResolvedValue(
      BIBLE_PROJECT_VIDEOS.map((f, i) =>
        asExactTitle(f, f.videoTitle.length + i),
      ),
    )

    const service = new HybridSearchService({
      prisma: mockPrisma,
      embedder: successEmbedder(),
      logger: { warn: vi.fn(), error: vi.fn() },
    })

    const result = await service.search({
      query: "the bible project",
      locale: "en",
      mode: "keyword-first",
      contentTypes: ["video"],
      limit: 10,
    })

    const titles = result.results.map((r) => r.title)

    // 1) The top 3 results are all Bible Project videos.
    const bibleProjectMatches = (title: string) =>
      /bible\s*project/i.test(title)
    expect(titles.slice(0, 3).every(bibleProjectMatches)).toBe(true)

    // 2) At least 4 of the first 5 results are Bible Project videos
    //    (some semantic-only Bible-themed videos may surface in the
    //    list but should not crowd out the lexical winners).
    const top5BpCount = titles.slice(0, 5).filter(bibleProjectMatches).length
    expect(top5BpCount).toBeGreaterThanOrEqual(4)

    // 3) No interleaving — every BP result outranks every non-BP result.
    //    Anchor: the LAST BP rank in the list must come before the FIRST
    //    non-BP rank. (Earlier framing — `firstBpRank < lastNonBpRank+1`
    //    — was vacuously true given the top-3 check above; the
    //    interleaving guard is the assertion that actually fires when
    //    the cap or the rank fusion regresses.)
    const lastBpRank = titles
      .map((t, i) => (bibleProjectMatches(t) ? i : -1))
      .reduce((max, i) => Math.max(max, i), -1)
    const firstNonBpRank = titles.findIndex((t) => !bibleProjectMatches(t))
    if (firstNonBpRank !== -1 && lastBpRank !== -1) {
      expect(lastBpRank).toBeLessThan(firstNonBpRank)
    }
  })

  it("hybrid mode (mode=undefined) does NOT call the lexical retrievers — locked in by Unit 2 regression", async () => {
    vi.mocked(searchVideoSemantic).mockResolvedValue([])
    vi.mocked(searchVideoKeyword).mockResolvedValue([])

    const service = new HybridSearchService({
      prisma: mockPrisma,
      embedder: successEmbedder(),
      logger: { warn: vi.fn(), error: vi.fn() },
    })

    await service.search({
      query: "the bible project",
      locale: "en",
      contentTypes: ["video"],
      limit: 10,
    })

    expect(searchVideoKeyword).toHaveBeenCalledTimes(1)
    expect(searchByKeywordWeighted).not.toHaveBeenCalled()
    expect(searchByTrigram).not.toHaveBeenCalled()
    expect(searchByExactTitle).not.toHaveBeenCalled()
  })

  it("preserves searchMode='hybrid' even on the keyword-first branch when embedding succeeds", async () => {
    vi.mocked(searchVideoSemantic).mockResolvedValue([])
    vi.mocked(searchByKeywordWeighted).mockResolvedValue([])
    vi.mocked(searchByTrigram).mockResolvedValue([])
    vi.mocked(searchByExactTitle).mockResolvedValue([])

    const service = new HybridSearchService({
      prisma: mockPrisma,
      embedder: successEmbedder(),
      logger: { warn: vi.fn(), error: vi.fn() },
    })

    const result = await service.search({
      query: "the bible project",
      locale: "en",
      mode: "keyword-first",
    })

    expect(result.searchMode).toBe("hybrid")
  })

  it("surfaces attribution-matched videos in top-N when retrievers return them (post-0010 CamelCase + description-trigram fix)", async () => {
    // Models the post-0010 world: descriptions writing the brand as
    // joined-form `BibleProject` are now reachable via two paths —
    //   (a) `searchByKeywordWeighted` because the new generated columns
    //       CamelCase-split the input before tokenizing, so
    //       `bibleproject` lexes to `bible` + `project` and matches
    //       `websearch_to_tsquery('the bible project')`'s AND-of-tokens.
    //   (b) `searchByTrigram` because trigrams ignore token boundaries
    //       and now run over both title AND description (the new
    //       `video_locale_description_trgm_idx` from migration 0010).
    //
    // Live verification ran against the local DB on 2026-05-02 and
    // returned 25 keyword-weighted matches for the same query (vs 6
    // pre-fix). This test locks in that the orchestrator surfaces such
    // attribution-matched videos within top-15 once retrievers feed
    // them in — i.e., the recall improvement isn't lost in fusion.
    const ATTRIBUTION_VIDEOS: Fixture[] = [
      {
        resultId: "att-1",
        videoCoreId: "11_Sermon0710",
        videoSlug: "lords-prayer",
        videoTitle: "The Lord's Prayer",
        description: "Thanks to BibleProject for providing this series.",
      },
      {
        resultId: "att-2",
        videoCoreId: "11_Shema0106",
        videoSlug: "shema-listen",
        videoTitle: "Shema / Listen",
        description: "Animated breakdown by BibleProject.",
      },
      {
        resultId: "att-3",
        videoCoreId: "11_Shema0206",
        videoSlug: "yhwh-lord",
        videoTitle: "YHWH / LORD",
        description: "From the BibleProject Sermon on the Mount series.",
      },
      {
        resultId: "att-4",
        videoCoreId: "11_Sermon0210",
        videoSlug: "the-beatitudes",
        videoTitle: "The Beatitudes",
        description: "BibleProject overview of Matthew 5.",
      },
      {
        resultId: "att-5",
        videoCoreId: "11_Sermon0810",
        videoSlug: "wealth-and-worry",
        videoTitle: "Wealth and Worry",
        description: "BibleProject explainer for Matthew 6:25-34.",
      },
    ]

    vi.mocked(searchVideoSemantic).mockResolvedValue([])
    // Keyword-weighted: BP titles (5) + 5 attribution-matched
    // descriptions all clear the AND-of-tokens gate.
    vi.mocked(searchByKeywordWeighted).mockResolvedValue([
      ...BIBLE_PROJECT_VIDEOS.map((f, i) => asKeywordWeighted(f, 1 - i * 0.05)),
      ...ATTRIBUTION_VIDEOS.map((f, i) => asKeywordWeighted(f, 0.4 - i * 0.03)),
    ])
    // Trigram: title-side matches BP collection; description-side
    // matches the attribution videos (BibleProject as one word).
    vi.mocked(searchByTrigram).mockResolvedValue([
      ...BIBLE_PROJECT_VIDEOS.map((f, i) => asTrigram(f, 0.6 - i * 0.05)),
      ...ATTRIBUTION_VIDEOS.map((f, i) => asTrigram(f, 0.45 - i * 0.03)),
    ])
    // Exact-title: only BP titles satisfy "the AND bible AND project"
    // all in title.
    vi.mocked(searchByExactTitle).mockResolvedValue(
      BIBLE_PROJECT_VIDEOS.map((f, i) =>
        asExactTitle(f, f.videoTitle.length + i),
      ),
    )

    const service = new HybridSearchService({
      prisma: mockPrisma,
      embedder: successEmbedder(),
      logger: { warn: vi.fn(), error: vi.fn() },
    })

    const result = await service.search({
      query: "the bible project",
      locale: "en",
      mode: "keyword-first",
      contentTypes: ["video"],
      limit: 15,
    })

    const titles = result.results.map((r) => r.title)
    const attributionTitles = ATTRIBUTION_VIDEOS.map((v) => v.videoTitle)
    const attributionMatchedInTopN = titles.filter((t) =>
      attributionTitles.includes(t),
    )

    // ≥5 attribution-matched videos (Sermon on the Mount series, etc.)
    // appear within top-15. This is the recall floor that locks in the
    // 0010 fix at the orchestrator boundary.
    expect(attributionMatchedInTopN.length).toBeGreaterThanOrEqual(5)
  })

  // Reference fixture coverage marker so unused-export linting flags
  // don't fire on intentionally-shared fixtures.
  it("fixture coverage sanity — every fixture is reachable by ID", () => {
    const ids = new Set(ALL_FIXTURES.map((f) => f.resultId))
    expect(ids.size).toBe(ALL_FIXTURES.length)
  })
})
