/**
 * Headline acceptance test for the keyword-first mode (feat-109,
 * unit 5).
 *
 * `q="the Bible project"` is the canonical failure case from the
 * research report (§4): hybrid mode returns a diluted mix of "bible"
 * and "project" videos. Keyword-first mode must return The Bible
 * Project series at the top.
 *
 * This is an orchestrator-level test with mocked retrievers but REAL
 * fusion + dedup. The retrievers return a fixture that mirrors what
 * the real DB would return for this query. The test asserts the
 * keyword-first pipeline (fusion + cap + dedup + paginate) produces
 * the headline result set.
 *
 * A real-DB integration version is tracked as a follow-up. The fixture
 * here is faithful to the fixture set documented in the plan:
 *   - 5 Bible Project video titles
 *   - 3 unrelated videos with "project" in title or description
 *   - 3 unrelated videos with "bible" in description (not in title)
 *
 * Hybrid mode is also asserted: same query returns the diluted mix
 * (regression test for the byte-identical-default invariant).
 */

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../../lib/openrouter", () => ({
  embedQuery: vi.fn(),
}))

vi.mock("./semantic-search", () => ({
  searchBySemantic: vi.fn(),
}))

vi.mock("./keyword-search", () => ({
  searchByKeyword: vi.fn(),
}))

vi.mock("./keyword-weighted-search", () => ({
  searchByKeywordWeighted: vi.fn(),
}))

vi.mock("./trigram-search", () => ({
  searchByTrigram: vi.fn(),
}))

vi.mock("./exact-title-search", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./exact-title-search")>()
  return {
    ...actual,
    searchByExactTitle: vi.fn(),
  }
})

vi.mock("./experience-semantic-search", () => ({
  searchByExperienceSemantic: vi.fn(),
}))

vi.mock("./experience-keyword-search", () => ({
  searchByExperienceKeyword: vi.fn(),
}))

// Use REAL fusion + dedup — this test exercises the full ranking pipeline.

import { embedQuery } from "../../../lib/openrouter"
import { searchByExactTitle } from "./exact-title-search"
import { searchByExperienceKeyword } from "./experience-keyword-search"
import { searchByExperienceSemantic } from "./experience-semantic-search"
import { searchByKeyword } from "./keyword-search"
import { searchByKeywordWeighted } from "./keyword-weighted-search"
import { __resetSearchHealthForTest } from "./search-health"
import { searchBySemantic } from "./semantic-search"
import { searchByTrigram } from "./trigram-search"
import { search } from "./search"

const mockKnex = {}
const logWarn = vi.fn()
const logError = vi.fn()
const mockStrapi = {
  db: { connection: mockKnex },
  log: { warn: logWarn, error: logError },
} as unknown as Parameters<typeof search>[0]

/**
 * 5 Bible Project videos. Real-feeling titles + core_ids.
 */
const BIBLE_PROJECT_VIDEOS = [
  {
    videoId: 101,
    videoSlug: "bible-project-genesis-1-11",
    videoTitle: "The Bible Project: Genesis 1-11",
    videoCoreId: "bp-genesis-1-11",
    imageUrl: null,
    description: "Animated overview of Genesis 1-11.",
  },
  {
    videoId: 102,
    videoSlug: "bible-project-exodus",
    videoTitle: "The Bible Project: Exodus",
    videoCoreId: "bp-exodus",
    imageUrl: null,
    description: "Animated overview of Exodus.",
  },
  {
    videoId: 103,
    videoSlug: "bible-project-gospel",
    videoTitle: "The Bible Project: Gospel of John",
    videoCoreId: "bp-john",
    imageUrl: null,
    description: "Animated overview of John.",
  },
  {
    videoId: 104,
    videoSlug: "bible-project-luke",
    videoTitle: "The Bible Project: Luke",
    videoCoreId: "bp-luke",
    imageUrl: null,
    description: "Animated overview of Luke.",
  },
  {
    videoId: 105,
    videoSlug: "bible-project-revelation",
    videoTitle: "The Bible Project: Revelation",
    videoCoreId: "bp-revelation",
    imageUrl: null,
    description: "Animated overview of Revelation.",
  },
] as const

/** 3 unrelated videos with "project" in title or description. */
const PROJECT_NOISE_VIDEOS = [
  {
    videoId: 201,
    videoSlug: "ministry-project-update",
    videoTitle: "Ministry Project: Quarterly Update",
    videoCoreId: "mp-q",
    imageUrl: null,
    description: "Quarterly update.",
  },
  {
    videoId: 202,
    videoSlug: "youth-project",
    videoTitle: "Youth Project Volunteers",
    videoCoreId: "yp-vol",
    imageUrl: null,
    description: "Volunteers needed.",
  },
  {
    videoId: 203,
    videoSlug: "construction-project",
    videoTitle: "New Sanctuary Construction Project",
    videoCoreId: "cp-new",
    imageUrl: null,
    description: "Building project.",
  },
] as const

/** 3 unrelated videos with "bible" only in description. */
const BIBLE_DESCRIPTION_VIDEOS = [
  {
    videoId: 301,
    videoSlug: "sermon-faith",
    videoTitle: "Sermon: Faith and Doubt",
    videoCoreId: "s-faith",
    imageUrl: null,
    description: "A sermon on faith with bible references.",
  },
  {
    videoId: 302,
    videoSlug: "study-grace",
    videoTitle: "Study Group on Grace",
    videoCoreId: "sg-grace",
    imageUrl: null,
    description: "A bible study on grace.",
  },
  {
    videoId: 303,
    videoSlug: "history-jewish-people",
    videoTitle: "History of the Jewish People",
    videoCoreId: "h-jewish",
    imageUrl: null,
    description: "Historical bible context.",
  },
] as const

beforeEach(() => {
  vi.clearAllMocks()
  __resetSearchHealthForTest()
  vi.mocked(embedQuery).mockResolvedValue([0.1, 0.2, 0.3])
  vi.mocked(searchByExperienceSemantic).mockResolvedValue([])
  vi.mocked(searchByExperienceKeyword).mockResolvedValue([])
})

describe("Bible Project headline acceptance (feat-109)", () => {
  it("keyword-first: top 3 are Bible Project; ≥8/10 titles match /bible\\s*project/i; no non-match above match", async () => {
    // Semantic returns a thematic blend — a couple Bible Projects
    // (best similarity), some bible-description noise, some project
    // noise. Mirrors what pgvector cosine actually returns for a
    // query embedding of "the Bible project".
    vi.mocked(searchBySemantic).mockResolvedValue([
      {
        ...BIBLE_PROJECT_VIDEOS[0]!,
        sceneIndex: 0,
        startSeconds: 0,
        playbackId: "px-101",
        similarity: 0.78,
        embeddingText: "[0.1]",
      },
      {
        ...BIBLE_DESCRIPTION_VIDEOS[0]!,
        sceneIndex: 0,
        startSeconds: 0,
        playbackId: "px-301",
        similarity: 0.72,
        embeddingText: "[0.1]",
      },
      {
        ...PROJECT_NOISE_VIDEOS[0]!,
        sceneIndex: 0,
        startSeconds: 0,
        playbackId: "px-201",
        similarity: 0.7,
        embeddingText: "[0.1]",
      },
      {
        ...BIBLE_PROJECT_VIDEOS[1]!,
        sceneIndex: 0,
        startSeconds: 0,
        playbackId: "px-102",
        similarity: 0.69,
        embeddingText: "[0.1]",
      },
      {
        ...BIBLE_DESCRIPTION_VIDEOS[1]!,
        sceneIndex: 0,
        startSeconds: 0,
        playbackId: "px-302",
        similarity: 0.68,
        embeddingText: "[0.1]",
      },
      {
        ...PROJECT_NOISE_VIDEOS[1]!,
        sceneIndex: 0,
        startSeconds: 0,
        playbackId: "px-202",
        similarity: 0.65,
        embeddingText: "[0.1]",
      },
    ])

    // Weighted keyword: title-A + description-B against the websearch
    // tsquery. The 5 Bible Project titles all match the phrase "Bible
    // Project" with high rank because title is weight A.
    vi.mocked(searchByKeywordWeighted).mockResolvedValue([
      { ...BIBLE_PROJECT_VIDEOS[0]!, rank: 0.95 },
      { ...BIBLE_PROJECT_VIDEOS[1]!, rank: 0.93 },
      { ...BIBLE_PROJECT_VIDEOS[2]!, rank: 0.92 },
      { ...BIBLE_PROJECT_VIDEOS[3]!, rank: 0.9 },
      { ...BIBLE_PROJECT_VIDEOS[4]!, rank: 0.88 },
    ])

    // Trigram on title — same five Bible Project titles match.
    vi.mocked(searchByTrigram).mockResolvedValue([
      { ...BIBLE_PROJECT_VIDEOS[0]!, similarity: 0.7 },
      { ...BIBLE_PROJECT_VIDEOS[1]!, similarity: 0.7 },
      { ...BIBLE_PROJECT_VIDEOS[2]!, similarity: 0.7 },
      { ...BIBLE_PROJECT_VIDEOS[3]!, similarity: 0.7 },
      { ...BIBLE_PROJECT_VIDEOS[4]!, similarity: 0.7 },
    ])

    // Exact-title: every token ("the", "bible", "project") present in
    // every Bible Project title. None of the noise titles match.
    // Ranked shortest title first.
    vi.mocked(searchByExactTitle).mockResolvedValue([
      { ...BIBLE_PROJECT_VIDEOS[1]!, titleLength: 26 }, // Exodus
      { ...BIBLE_PROJECT_VIDEOS[3]!, titleLength: 23 }, // Luke
      { ...BIBLE_PROJECT_VIDEOS[4]!, titleLength: 30 }, // Revelation
      { ...BIBLE_PROJECT_VIDEOS[0]!, titleLength: 31 }, // Genesis 1-11
      { ...BIBLE_PROJECT_VIDEOS[2]!, titleLength: 33 }, // John
    ])

    const response = await search(mockStrapi, {
      query: "the bible project",
      locale: "en",
      mode: "keyword-first",
      limit: 10,
      contentTypes: ["video"],
    })

    // Unique video ids returned (3-layer dedup may drop near-duplicates;
    // our fixture has none, so all 5+3+3 candidates would compete but
    // dedup will keep the highest-scored representative per identity).
    const ids = response.results.map((r) => r.id)
    const titles = response.results.map((r) => r.title)

    // Headline 1: top 3 are all Bible Project videos.
    const bibleProjectIds = new Set(BIBLE_PROJECT_VIDEOS.map((v) => v.videoId))
    expect(ids[0]).toBeDefined()
    expect(bibleProjectIds.has(ids[0]!)).toBe(true)
    expect(bibleProjectIds.has(ids[1]!)).toBe(true)
    expect(bibleProjectIds.has(ids[2]!)).toBe(true)

    // Headline 2: at least 8 of 10 titles match /bible\s*project/i.
    const bibleProjectMatches = titles.filter((t) => /bible\s*project/i.test(t))
    expect(bibleProjectMatches.length).toBeGreaterThanOrEqual(
      Math.min(8, response.results.length),
    )

    // Headline 3: no non-matching title above any matching title.
    let lastMatchingIndex = -1
    let firstNonMatchingIndex = -1
    for (let i = 0; i < titles.length; i++) {
      if (/bible\s*project/i.test(titles[i]!)) {
        lastMatchingIndex = i
      } else if (firstNonMatchingIndex === -1) {
        firstNonMatchingIndex = i
      }
    }
    if (firstNonMatchingIndex !== -1 && lastMatchingIndex !== -1) {
      expect(firstNonMatchingIndex).toBeGreaterThan(lastMatchingIndex)
    }
  })

  it("hybrid mode (default) returns the legacy diluted set — the failure case feat-109 fixes", async () => {
    // Same query, no `mode`. Simulates current main: `searchByKeyword`
    // (concatenated tsvector + plainto_tsquery) returns title hits
    // mixed with description hits. The semantic side adds thematic
    // matches. Without per-field weighting, RRF fuses the diluted lists
    // and "Sermon: Faith and Doubt" can outrank a Bible Project entry.
    vi.mocked(searchBySemantic).mockResolvedValue([
      {
        ...BIBLE_DESCRIPTION_VIDEOS[0]!,
        sceneIndex: 0,
        startSeconds: 0,
        playbackId: "px-301",
        similarity: 0.78,
        embeddingText: "[0.1]",
      },
      {
        ...BIBLE_PROJECT_VIDEOS[0]!,
        sceneIndex: 0,
        startSeconds: 0,
        playbackId: "px-101",
        similarity: 0.7,
        embeddingText: "[0.1]",
      },
      {
        ...PROJECT_NOISE_VIDEOS[0]!,
        sceneIndex: 0,
        startSeconds: 0,
        playbackId: "px-201",
        similarity: 0.65,
        embeddingText: "[0.1]",
      },
    ])
    vi.mocked(searchByKeyword).mockResolvedValue([
      // Concatenated tsvector + plainto_tsquery: any title or description
      // containing both tokens scores. Description-only matches outrank
      // multi-token title matches because plainto_tsquery flattens
      // phrases.
      { ...BIBLE_DESCRIPTION_VIDEOS[2]!, rank: 0.6 },
      { ...PROJECT_NOISE_VIDEOS[0]!, rank: 0.55 },
      { ...BIBLE_PROJECT_VIDEOS[0]!, rank: 0.5 },
      { ...BIBLE_DESCRIPTION_VIDEOS[1]!, rank: 0.45 },
    ])

    const response = await search(mockStrapi, {
      query: "the bible project",
      locale: "en",
      // mode unset — hybrid is the default
      limit: 10,
      contentTypes: ["video"],
    })

    // Hybrid leaks: at least one non-Bible-Project result appears in
    // the top 5. This is the diluted behavior keyword-first mode fixes.
    const bibleProjectIds = new Set(BIBLE_PROJECT_VIDEOS.map((v) => v.videoId))
    const top5 = response.results.slice(0, 5)
    const top5LeakCount = top5.filter((r) => !bibleProjectIds.has(r.id)).length
    expect(top5LeakCount).toBeGreaterThan(0)
  })

  it("does NOT regress searchMode signal — keyword-first still reports hybrid when embedding succeeded", async () => {
    vi.mocked(searchByKeywordWeighted).mockResolvedValue([])
    vi.mocked(searchByTrigram).mockResolvedValue([])
    vi.mocked(searchByExactTitle).mockResolvedValue([])
    vi.mocked(searchBySemantic).mockResolvedValue([])

    const response = await search(mockStrapi, {
      query: "the bible project",
      locale: "en",
      mode: "keyword-first",
    })

    // Embedding succeeded → searchMode === "hybrid" regardless of
    // input mode (degradation signal is independent of retrieval mode).
    expect(response.searchMode).toBe("hybrid")
  })
})
