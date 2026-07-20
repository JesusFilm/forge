/**
 * Unit tests for the keyword-first lexical retrievers.
 *
 * Mirrors `hybrid-search-retrievers.test.ts` shape: mocks
 * `prisma.$queryRaw` and asserts the row-mapping + short-circuit
 * + DoS-cap contracts without touching Postgres. Real-DB EXPLAIN +
 * Bible Project headline tests are deferred to R0 readiness, same
 * posture as R4 + R5.
 */

import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  MAX_EXACT_TITLE_TOKENS,
  searchByExactTitle,
  searchByKeywordWeighted,
  searchKeywordFirstVideoLexical,
  searchByTrigram,
  tokenizeForExactTitle,
} from "./hybrid-search-keyword-first-retrievers"
import { SearchTimingRecorder } from "./hybrid-search-timing"

function mockPrisma() {
  const $queryRaw = vi.fn()
  const tx = { $queryRaw }
  const $transaction = vi.fn(async (run) => run(tx))
  return {
    $queryRaw,
    $transaction,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

describe("tokenizeForExactTitle", () => {
  it("splits on Unicode non-letter / non-digit boundaries", () => {
    expect(tokenizeForExactTitle("The Bible Project")).toEqual([
      "the",
      "bible",
      "project",
    ])
  })

  it("lowercases and drops punctuation runs", () => {
    expect(tokenizeForExactTitle("Jesus, the Christ!")).toEqual([
      "jesus",
      "the",
      "christ",
    ])
  })

  it("returns [] for empty / whitespace / pure-punctuation input", () => {
    expect(tokenizeForExactTitle("")).toEqual([])
    expect(tokenizeForExactTitle("   ")).toEqual([])
    expect(tokenizeForExactTitle("!!!,..??")).toEqual([])
  })

  it("caps at MAX_EXACT_TITLE_TOKENS = 16 (DoS guard)", () => {
    const long = Array.from({ length: 100 }, (_, i) => `word${i}`).join(" ")
    const tokens = tokenizeForExactTitle(long)
    expect(tokens).toHaveLength(MAX_EXACT_TITLE_TOKENS)
    expect(tokens[0]).toBe("word0")
    expect(tokens[15]).toBe("word15")
  })

  it("handles Unicode letters (non-ASCII)", () => {
    expect(tokenizeForExactTitle("Yésus Christós")).toEqual([
      "yésus",
      "christós",
    ])
  })

  it("handles digits as token characters and dedupes repeated tokens", () => {
    // "Genesis 1:1" tokenizes to ['genesis', '1', '1']; dedup collapses
    // the repeated '1' so the AND-chain doesn't carry redundant
    // predicates.
    expect(tokenizeForExactTitle("Genesis 1:1")).toEqual(["genesis", "1"])
  })

  it("dedupes repeated whole-word tokens before applying the cap", () => {
    // 100 repeats of the same word collapse to one — the cap is a
    // distinct-token cap, not a slice of the raw split.
    const repeated = Array.from({ length: 100 }, () => "jesus").join(" ")
    expect(tokenizeForExactTitle(repeated)).toEqual(["jesus"])
  })

  it("preserves order of first occurrence when deduping", () => {
    // Token 'jesus' first appears before 'christ' even though 'jesus'
    // appears multiple times.
    expect(tokenizeForExactTitle("jesus christ jesus")).toEqual([
      "jesus",
      "christ",
    ])
  })

  it("dedup happens before the 16-token cap (leading duplicates don't push later uniques out)", () => {
    // 17 leading 'a's followed by 'b'. Without dedup-before-cap, the
    // 'b' would never enter (slice(0,16) of 17 'a's). With the new
    // logic, dedup collapses 'a's first, so the result is ['a','b'].
    const input = "a a a a a a a a a a a a a a a a a b"
    expect(tokenizeForExactTitle(input)).toEqual(["a", "b"])
  })
})

describe("searchByKeywordWeighted", () => {
  let prisma: ReturnType<typeof mockPrisma>

  beforeEach(() => {
    prisma = mockPrisma()
  })

  it("returns a RankedItem-shaped row per DB row", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        video_id: "vid-1",
        video_core_id: "1_BibleProject",
        video_slug: "bible-project",
        video_title: "The Bible Project",
        description: "Animated bible overview",
        rank: 0.42,
      },
    ])

    const rows = await searchByKeywordWeighted(prisma, {
      query: "bible project",
      locale: "en",
      limit: 10,
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      resultType: "video",
      resultId: "vid-1",
      videoCoreId: "1_BibleProject",
      videoSlug: "bible-project",
      videoTitle: "The Bible Project",
      imageUrl: null,
      description: "Animated bible overview",
      rank: 0.42,
    })
  })

  it("records the weighted keyword DB timing when a recorder is passed", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([])
    const timing = new SearchTimingRecorder()

    await searchByKeywordWeighted(
      prisma,
      {
        query: "bible project",
        locale: "en",
        limit: 10,
      },
      timing,
    )

    expect(timing.snapshotDbTimings()).toEqual([
      expect.objectContaining({
        label: "keyword-weighted-video.query",
        status: "fulfilled",
        resultCount: 0,
        elapsedMs: expect.any(Number),
      }),
    ])
  })

  it("short-circuits to [] on empty / whitespace input without a DB call", async () => {
    expect(
      await searchByKeywordWeighted(prisma, {
        query: "",
        locale: "en",
        limit: 10,
      }),
    ).toEqual([])
    expect(
      await searchByKeywordWeighted(prisma, {
        query: "   ",
        locale: "en",
        limit: 10,
      }),
    ).toEqual([])
    expect(prisma.$queryRaw).not.toHaveBeenCalled()
  })

  it("tolerates null video_core_id and null description", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        video_id: "vid-2",
        video_core_id: null,
        video_slug: "x",
        video_title: "X",
        description: null,
        rank: 0.1,
      },
    ])

    const [row] = await searchByKeywordWeighted(prisma, {
      query: "x",
      locale: "en",
      limit: 10,
    })

    expect(row).toMatchObject({
      videoCoreId: null,
      description: null,
    })
  })

  it("interpolates websearch_to_tsquery + WEIGHTED_TSV_QUERY_EXPR into the SQL", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([])
    await searchByKeywordWeighted(prisma, {
      query: "bible",
      locale: "en",
      limit: 10,
    })
    // Tagged-template form — Prisma builds a `Sql` envelope, the first
    // arg is the cooked-string array. Smoke-check the SQL skeleton.
    const [strings] = prisma.$queryRaw.mock.calls[0] as [TemplateStringsArray]
    const joined = strings.join("?")
    expect(joined).toMatch(/websearch_to_tsquery\('simple',\s*\?\)/)
    expect(joined).toMatch(/ts_rank_cd/)
    expect(joined).toMatch(/vl\.locale\s*=\s*\?/)
    expect(joined).toMatch(/vl\.status\s*=\s*'published'/)
    expect(joined).toMatch(/v\.deleted_at IS NULL/)
    expect(joined).toMatch(/v\.no_index = false/)
  })
})

describe("searchByTrigram", () => {
  let prisma: ReturnType<typeof mockPrisma>

  beforeEach(() => {
    prisma = mockPrisma()
  })

  it("returns a RankedItem-shaped row per DB row", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        video_id: "vid-1",
        video_core_id: "1_BibleProject",
        video_slug: "bible-project",
        video_title: "Bible Project",
        description: "desc",
        similarity: 0.55,
      },
    ])

    const rows = await searchByTrigram(prisma, {
      query: "bibel project",
      locale: "en",
      limit: 10,
    })

    expect(rows[0]).toMatchObject({
      resultType: "video",
      resultId: "vid-1",
      videoTitle: "Bible Project",
      similarity: 0.55,
    })
  })

  it("short-circuits to [] on empty input", async () => {
    expect(
      await searchByTrigram(prisma, { query: "", locale: "en", limit: 10 }),
    ).toEqual([])
    expect(prisma.$queryRaw).not.toHaveBeenCalled()
  })

  it("uses %> operator on BOTH title and description (operator-class trigram GIN selection)", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([])
    await searchByTrigram(prisma, {
      query: "bible",
      locale: "en",
      limit: 10,
    })
    const [strings] = prisma.$queryRaw.mock.calls[0] as [TemplateStringsArray]
    const joined = strings.join("?")
    // Title-side match drives `video_locale_title_trgm_idx`; description-side
    // drives the new `video_locale_description_trgm_idx` from migration 0010.
    expect(joined).toMatch(/vl\.title\s*%>\s*\?/)
    expect(joined).toMatch(/vl\.description\s*%>\s*\?/)
    expect(joined).toMatch(/v\.no_index = false/)
  })

  it("ranks by GREATEST similarity across title and description", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([])
    await searchByTrigram(prisma, {
      query: "bible project",
      locale: "en",
      limit: 10,
    })
    const [strings] = prisma.$queryRaw.mock.calls[0] as [TemplateStringsArray]
    const joined = strings.join("?")
    // GREATEST keeps a strong title match from being diluted by a weak
    // description match (or vice versa) when the same row matches both.
    expect(joined).toMatch(/GREATEST\(\s*similarity\(vl\.title/)
    expect(joined).toMatch(/similarity\(coalesce\(vl\.description/)
  })

  it("returns rows whose match came via description-side trigram", async () => {
    // Simulates a video like "The Lord's Prayer" whose title doesn't
    // match the query but whose description contains "BibleProject"
    // attribution text — only reachable post-0010 description trigram
    // index.
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        video_id: "vid-2",
        video_core_id: "11_Sermon0710",
        video_slug: "lords-prayer",
        video_title: "The Lord's Prayer",
        description:
          "Line-by-line breakdown of the Lord's Prayer. Thanks to BibleProject for providing this series.",
        similarity: 0.42,
      },
    ])
    const rows = await searchByTrigram(prisma, {
      query: "bible project",
      locale: "en",
      limit: 10,
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      resultId: "vid-2",
      videoTitle: "The Lord's Prayer",
      similarity: 0.42,
    })
  })
})

describe("searchByExactTitle", () => {
  let prisma: ReturnType<typeof mockPrisma>

  beforeEach(() => {
    prisma = mockPrisma()
  })

  it("returns a RankedItem-shaped row per DB row", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        video_id: "vid-1",
        video_core_id: "1_BibleProject",
        video_slug: "bible-project",
        video_title: "The Bible Project",
        description: "desc",
        title_length: 17,
      },
    ])

    const rows = await searchByExactTitle(prisma, {
      query: "the bible project",
      locale: "en",
      limit: 10,
    })

    expect(rows[0]).toMatchObject({
      resultType: "video",
      resultId: "vid-1",
      videoTitle: "The Bible Project",
      titleLength: 17,
    })
  })

  it("short-circuits to [] on empty / pure-punctuation queries", async () => {
    expect(
      await searchByExactTitle(prisma, {
        query: "",
        locale: "en",
        limit: 10,
      }),
    ).toEqual([])
    expect(
      await searchByExactTitle(prisma, {
        query: "!!!",
        locale: "en",
        limit: 10,
      }),
    ).toEqual([])
    expect(prisma.$queryRaw).not.toHaveBeenCalled()
  })

  it("caps the AND-chain at 16 ILIKE clauses for pathological queries", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([])
    const longQuery = Array.from({ length: 1000 }, (_, i) => `word${i}`).join(
      " ",
    )
    await searchByExactTitle(prisma, {
      query: longQuery,
      locale: "en",
      limit: 10,
    })

    expect(prisma.$queryRaw).toHaveBeenCalledOnce()
    // Tagged-template `prisma.$queryRaw\`...\`` passes the cooked
    // strings as the 0th arg and bound values as positional args after.
    // Our query has three positional bindings:
    //   ${ilikeChain}  ${locale}  ${limit}
    // — `Prisma.join` collapses the 16 ILIKE clauses into one bound
    // expression. So the call should have 1 + 3 args total.
    const callArgs = prisma.$queryRaw.mock.calls[0]
    expect(callArgs.length - 1).toBe(3)
    // The first bound positional is the `Prisma.Sql` from `Prisma.join`,
    // which exposes the constituent values. Each of those is one wrapped
    // ILIKE pattern. Cap holds: exactly 16 entries.
    const ilikeChain = callArgs[1] as { values: string[] }
    expect(ilikeChain.values).toHaveLength(MAX_EXACT_TITLE_TOKENS)
    for (const value of ilikeChain.values) {
      expect(value.startsWith("%")).toBe(true)
      expect(value.endsWith("%")).toBe(true)
    }
    expect(ilikeChain.values[0]).toBe("%word0%")
    expect(ilikeChain.values[MAX_EXACT_TITLE_TOKENS - 1]).toBe("%word15%")
  })

  it("emits exactly N ILIKE clauses for an N-token query", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([])
    await searchByExactTitle(prisma, {
      query: "the bible",
      locale: "en",
      limit: 10,
    })
    const callArgs = prisma.$queryRaw.mock.calls[0]
    const ilikeChain = callArgs[1] as { values: string[] }
    expect(ilikeChain.values).toEqual(["%the%", "%bible%"])
    const [strings] = callArgs as [TemplateStringsArray]
    expect(strings.join("?")).toMatch(/v\.no_index = false/)
  })
})

describe("searchKeywordFirstVideoLexical", () => {
  let prisma: ReturnType<typeof mockPrisma>

  beforeEach(() => {
    prisma = mockPrisma()
  })

  it("runs all three lexical retrievers inside one transaction", async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([
        {
          video_id: "vid-kw",
          video_core_id: "core-kw",
          video_slug: "kw",
          video_title: "Keyword",
          description: "keyword result",
          rank: 0.7,
        },
      ])
      .mockResolvedValueOnce([
        {
          video_id: "vid-trgm",
          video_core_id: "core-trgm",
          video_slug: "trgm",
          video_title: "Trigram",
          description: "trigram result",
          similarity: 0.5,
        },
      ])
      .mockResolvedValueOnce([
        {
          video_id: "vid-exact",
          video_core_id: "core-exact",
          video_slug: "exact",
          video_title: "Exact",
          description: "exact result",
          title_length: 5,
        },
      ])
    const timing = new SearchTimingRecorder()

    const result = await searchKeywordFirstVideoLexical(
      prisma,
      {
        query: "the bible project",
        locale: "en",
        limit: 10,
      },
      timing,
    )

    expect(prisma.$transaction).toHaveBeenCalledOnce()
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      maxWait: 5_000,
      timeout: 20_000,
    })
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(3)
    expect(result.keywordWeighted[0]).toMatchObject({
      resultId: "vid-kw",
      rank: 0.7,
    })
    expect(result.trigram[0]).toMatchObject({
      resultId: "vid-trgm",
      similarity: 0.5,
    })
    expect(result.exactTitle[0]).toMatchObject({
      resultId: "vid-exact",
      titleLength: 5,
    })
    expect(timing.snapshotDbTimings().map((row) => row.label)).toEqual([
      "keyword-weighted-video.query",
      "trigram-video.query",
      "exact-title-video.query",
    ])
  })

  it("short-circuits whitespace-only input before opening a transaction", async () => {
    await expect(
      searchKeywordFirstVideoLexical(prisma, {
        query: "   ",
        locale: "en",
        limit: 10,
      }),
    ).resolves.toEqual({
      keywordWeighted: [],
      trigram: [],
      exactTitle: [],
    })
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(prisma.$queryRaw).not.toHaveBeenCalled()
  })
})
